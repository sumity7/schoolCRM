import { Types } from 'mongoose';
import {
  IMPORT_MAX_ROWS, STUDENT_IMPORT_FIELDS, mappingProblems, suggestStudentMapping, todayInTz,
  type ImportDateFormat, type ImportMapping,
} from '@edunex/shared';
import { conflict, validationFailed } from '../../core/errors';
import { AuditService } from '../../core/audit/audit.service';
import { withTransaction } from '../../core/db/connection';
import { requireTenant } from '../../core/tenancy/context';
import { CsvParseError, parseCsv } from '../../core/csv/csv';
import { classRepo, sectionRepo, sessionRepo } from '../academics/academics.repository';
import { attendanceRepo } from '../attendance/attendance.repository';
import { getSchoolById } from '../schools/schools.service';
import { enrollmentRepo, guardianRepo, studentGuardianRepo, studentRepo } from '../students/students.repository';
import { normalizeName } from '../students/students.service';
import { importBatchRepo } from './imports.repository';
import type { IImportBatch, ImportRowResult } from './imports.model';
import { normClassName, normSectionName, validateStudentRows, type ClassInfo, type StudentRowContext, type StudentRowResult, type StudentRowValues } from './student-rows';

type Batch = Awaited<ReturnType<typeof importBatchRepo.getById>>;

const CHUNK = 100;
const PREVIEW_ROWS = 20;

const emptyCounts = (): IImportBatch['counts'] => ({ total: 0, ok: 0, duplicate: 0, error: 0, created: 0, rolledBack: 0, kept: 0 });

export function toBatchSummary(b: Batch) {
  return {
    id: String(b._id), entity: b.entity, filename: b.filename, status: b.status, counts: b.counts, rowCount: b.counts.total,
    createdAt: b.createdAt, validatedAt: b.validatedAt, committedAt: b.committedAt, rolledBackAt: b.rolledBackAt, failureReason: b.failureReason ?? null,
  };
}

export function toBatchDetail(b: Batch) {
  return {
    ...toBatchSummary(b),
    headers: b.headers,
    mapping: b.mapping,
    options: b.options,
    sample: b.rows.slice(0, 5),
    fields: STUDENT_IMPORT_FIELDS,
    mappingProblems: mappingProblems(b.mapping, b.headers.length),
    preview: b.preview,
    problems: b.results.filter((r) => r.status === 'error' || r.status === 'duplicate').slice(0, 200).map((r) => ({ line: r.line, status: r.status, messages: r.messages })),
  };
}

async function loadContext(rows: string[][], mapping: ImportMapping): Promise<StudentRowContext> {
  const tenant = requireTenant('imports.context');
  const school = await getSchoolById(tenant.schoolId);
  const today = todayInTz(school.settings.timezone);
  const session = await sessionRepo.findActive();
  const classes = new Map<string, ClassInfo>();
  const usedRollNos = new Map<string, Set<number>>();
  if (session) {
    const [cls, secs, load] = await Promise.all([
      classRepo.find({ sessionId: session._id }),
      sectionRepo.find({ sessionId: session._id }),
      enrollmentRepo.aggregate<{ _id: Types.ObjectId; n: number; rolls: Array<number | null> }>([
        { $match: { sessionId: session._id, status: 'active' } },
        { $group: { _id: '$sectionId', n: { $sum: 1 }, rolls: { $push: '$rollNo' } } },
      ]),
    ]);
    const loadBy = new Map(load.map((l) => [String(l._id), l]));
    for (const c of cls) {
      const key = normClassName(c.name);
      const sections = new Map(
        secs.filter((s) => s.classId.equals(c._id)).map((s) => [normSectionName(s.name), { id: s._id, classId: c._id, name: s.name, capacity: s.capacity, activeCount: loadBy.get(String(s._id))?.n ?? 0 }]),
      );
      if (classes.has(key)) classes.set(key, { ...classes.get(key)!, ambiguous: true });
      else classes.set(key, { id: c._id, name: c.name, sections });
    }
    for (const l of load) usedRollNos.set(String(l._id), new Set(l.rolls.filter((r): r is number => typeof r === 'number')));
  }
  const admIdx = mapping.admissionNo;
  const fileAdmissionNos = admIdx === undefined || admIdx === null ? [] : [...new Set(rows.map((r) => (r[admIdx] ?? '').trim()).filter(Boolean))];
  const existing = fileAdmissionNos.length ? await studentRepo.find({ admissionNo: { $in: fileAdmissionNos } }, { select: 'admissionNo' }) : [];
  const active = await studentRepo.count({ status: 'active' });
  return { today, classes, existingAdmissionNos: new Set(existing.map((s) => s.admissionNo)), usedRollNos, remainingStudentSlots: Math.max(0, school.limits.students - active) };
}

function previewOf(results: StudentRowResult[]) {
  return results.filter((r) => r.status === 'ok').slice(0, PREVIEW_ROWS).map((r) => {
    const v = r.values!;
    return {
      line: r.line, admissionNo: v.admissionNo, name: [v.firstName, v.lastName].filter(Boolean).join(' '), dob: v.dob, gender: v.gender ?? null,
      class: v.section ? `${v.section.className} ${v.section.sectionName}` : null, rollNo: v.section?.rollNo ?? null,
      guardian: v.guardian ? `${v.guardian.name} (${v.guardian.relationship}) ${v.guardian.phone}` : null,
    };
  });
}

function countsOf(results: Array<{ status: string }>, total: number): IImportBatch['counts'] {
  const c = emptyCounts();
  c.total = total;
  for (const r of results) {
    if (r.status === 'ok') c.ok++;
    else if (r.status === 'duplicate') c.duplicate++;
    else if (r.status === 'error') c.error++;
    else if (r.status === 'created') c.created++;
  }
  return c;
}

const friendlyWriteError = (err: unknown) =>
  (err as { code?: number }).code === 11000 ? 'Conflicts with an existing record (admission number or roll number already used)' : 'Could not be saved — try importing this row again';

export const ImportsService = {
  async upload(input: { filename: string; csv: string }) {
    let parsed;
    try {
      parsed = parseCsv(input.csv, { maxRows: IMPORT_MAX_ROWS });
    } catch (err) {
      if (err instanceof CsvParseError) throw validationFailed(err.message === `The file has more than ${IMPORT_MAX_ROWS} rows` ? `${err.message}. Split it into smaller files.` : err.message);
      throw err;
    }
    if (parsed.rows.length === 0) throw validationFailed('The file has headings but no data rows');
    if (parsed.rows.length > IMPORT_MAX_ROWS) throw validationFailed(`The file has more than ${IMPORT_MAX_ROWS} rows. Split it into smaller files.`);
    if (parsed.headers.length > 60) throw validationFailed('The file has more than 60 columns — remove unused columns first');
    const mapping = suggestStudentMapping(parsed.headers);
    const batch = await importBatchRepo.create({
      entity: 'students', filename: input.filename, headers: parsed.headers, rows: parsed.rows, mapping, options: { dateFormat: 'DMY' },
      status: 'uploaded', counts: { ...emptyCounts(), total: parsed.rows.length }, results: [], preview: [],
    });
    await AuditService.record({ action: 'imports.uploaded', entityType: 'import_batch', entityId: batch._id, after: { filename: input.filename, rows: parsed.rows.length } });
    return batch;
  },

  async list(page: number, limit: number) {
    return importBatchRepo.paginate({}, page, limit, { createdAt: -1 }, '-rows -results -preview');
  },

  async get(id: string) {
    return importBatchRepo.getById(id, 'Import');
  },

  async setMapping(id: string, input: { mapping: ImportMapping; dateFormat?: ImportDateFormat }) {
    const b = await importBatchRepo.getById(id, 'Import');
    if (!['uploaded', 'validated'].includes(b.status)) throw conflict('This import has already been committed');
    const problems = mappingProblems(input.mapping, b.headers.length).filter((p) => /does not exist|mapped to both/.test(p));
    if (problems.length) throw validationFailed('Invalid column mapping', problems.map((m) => ({ path: 'mapping', message: m })));
    const updated = await importBatchRepo.updateById(b._id, {
      mapping: input.mapping, options: { dateFormat: input.dateFormat ?? b.options.dateFormat }, status: 'uploaded', results: [], preview: [],
      counts: { ...emptyCounts(), total: b.rows.length }, validatedAt: null,
    });
    return updated;
  },

  async validate(id: string) {
    const b = await importBatchRepo.getById(id, 'Import');
    if (!['uploaded', 'validated'].includes(b.status)) throw conflict('This import has already been committed');
    const problems = mappingProblems(b.mapping, b.headers.length);
    if (problems.length) throw validationFailed('Fix the column mapping first', problems.map((m) => ({ path: 'mapping', message: m })));
    const ctx = await loadContext(b.rows, b.mapping);
    const results = validateStudentRows(b.rows, b.mapping, b.options.dateFormat, ctx);
    return importBatchRepo.updateById(b._id, {
      status: 'validated', validatedAt: new Date(),
      results: results.map((r) => ({ line: r.line, status: r.status, messages: r.messages })),
      preview: previewOf(results), counts: countsOf(results, b.rows.length),
    });
  },

  /**
   * Commits the valid rows (D-24). Validation is re-run against the CURRENT data, so anything that changed since the
   * preview is caught. Rows are written in chunked transactions; a failing chunk is retried row by row so one bad row
   * cannot block its neighbours, and every failure is reported against its line.
   */
  async commit(id: string) {
    const tenant = requireTenant('imports.commit');
    const b = await importBatchRepo.getById(id, 'Import');
    if (b.status !== 'validated') throw conflict(b.status === 'uploaded' ? 'Validate the file before importing' : 'This import has already been committed');
    // Claim atomically: two concurrent commits cannot both pass this point.
    await importBatchRepo.updateById(b._id, { status: 'committing', committedBy: tenant.membershipId }, { expectedVersion: b.__v, what: 'Import' });

    try {
      const problems = mappingProblems(b.mapping, b.headers.length);
      if (problems.length) throw validationFailed('Fix the column mapping first');
      const ctx = await loadContext(b.rows, b.mapping);
      const results = validateStudentRows(b.rows, b.mapping, b.options.dateFormat, ctx);
      const final = new Map<number, ImportRowResult>(results.map((r) => [r.line, { line: r.line, status: r.status, messages: r.messages }]));
      const okRows = results.filter((r) => r.status === 'ok');
      const session = okRows.some((r) => r.values?.section) ? await sessionRepo.findActive() : null;

      // Re-use guardians already on file (same phone + same name, case-insensitive) — siblings share guardians.
      const phones = [...new Set(okRows.map((r) => r.values?.guardian?.phone).filter(Boolean) as string[])];
      const known = new Map<string, Types.ObjectId>();
      const gKey = (g: NonNullable<StudentRowValues['guardian']>) => `${g.phone}|${g.name.toLowerCase().replace(/\s+/g, ' ')}`;
      if (phones.length) {
        for (const g of await guardianRepo.find({ phone: { $in: phones } })) known.set(`${g.phone}|${g.name.toLowerCase().replace(/\s+/g, ' ')}`, g._id);
      }
      const today = ctx.today;

      const insert = async (chunk: StudentRowResult[]) => {
        const created = new Map<string, Types.ObjectId>();
        await withTransaction(async () => {
          const students = await studentRepo.createMany(chunk.map((r) => {
            const v = r.values!;
            return {
              admissionNo: v.admissionNo, firstName: v.firstName, lastName: v.lastName, normalizedName: normalizeName(v.firstName, v.lastName),
              dob: v.dob, gender: v.gender, contact: v.phone || v.email ? { phone: v.phone, email: v.email } : undefined, address: v.address,
              emergencyContacts: [], status: 'active' as const, admissionDate: v.admissionDate ?? today, importBatchId: b._id,
            };
          }));
          const withSection = chunk.map((r, i) => ({ r, s: students[i]! })).filter((x) => x.r.values!.section);
          if (withSection.length) {
            if (!session) throw conflict('No active academic session');
            const enrolls = await enrollmentRepo.createMany(withSection.map(({ r, s }) => ({
              studentId: s._id, sessionId: session._id, classId: r.values!.section!.classId, sectionId: r.values!.section!.sectionId,
              rollNo: r.values!.section!.rollNo, status: 'active' as const, joinedOn: r.values!.admissionDate ?? today, importBatchId: b._id,
            })));
            await studentRepo.bulkWrite(enrolls.map((e) => ({ updateOne: { filter: { _id: e.studentId }, update: { $set: { currentEnrollmentId: e._id } } } })));
          }
          const links: Array<Record<string, unknown>> = [];
          for (let i = 0; i < chunk.length; i++) {
            const g = chunk[i]!.values!.guardian;
            if (!g) continue;
            const k = gKey(g);
            let gid = known.get(k) ?? created.get(k);
            if (!gid) {
              gid = (await guardianRepo.create({ name: g.name, phone: g.phone, email: g.email, importBatchId: b._id }))._id;
              created.set(k, gid);
            }
            links.push({ studentId: students[i]!._id, guardianId: gid, relationship: g.relationship, isPrimary: true, canViewFees: true, canPickup: true, portalAccess: false, verifiedAt: null, importBatchId: b._id });
          }
          if (links.length) await studentGuardianRepo.createMany(links);
          chunk.forEach((r, i) => final.set(r.line, { line: r.line, status: 'created', messages: [], studentId: students[i]!._id }));
        });
        for (const [k, v] of created) known.set(k, v); // only after the transaction committed
      };

      for (let i = 0; i < okRows.length; i += CHUNK) {
        const chunk = okRows.slice(i, i + CHUNK);
        try {
          await insert(chunk);
        } catch {
          for (const row of chunk) {
            try {
              await insert([row]);
            } catch (err) {
              final.set(row.line, { line: row.line, status: 'error', messages: [friendlyWriteError(err)] });
            }
          }
        }
      }

      const finalResults = [...final.values()].sort((a, c) => a.line - c.line);
      const counts = countsOf(finalResults, b.rows.length);
      const done = await importBatchRepo.updateById(b._id, { status: 'committed', committedAt: new Date(), results: finalResults, counts, preview: previewOf(results) });
      await AuditService.record({ action: 'imports.committed', entityType: 'import_batch', entityId: b._id, after: { created: counts.created, duplicate: counts.duplicate, error: counts.error } });
      return done;
    } catch (err) {
      // Whatever was written stays tagged with the batch id and can be rolled back.
      await importBatchRepo.updateById(b._id, { status: 'failed', committedAt: new Date(), failureReason: err instanceof Error ? err.message.slice(0, 300) : 'Unknown error' }).catch(() => undefined);
      await AuditService.record({ action: 'imports.failed', entityType: 'import_batch', entityId: b._id }).catch(() => undefined);
      throw err;
    }
  },

  /**
   * Removes what the batch created, EXCEPT records someone has touched since (edited, status-changed, attendance
   * marked, re-enrolled, guardian links edited/added). Imported records that were never used are mistakes, so they are
   * deleted outright (the normal "students are never hard-deleted" rule protects history; untouched rows have none).
   * R2+: fee invoices/payments must be added to the "touched" checks before fees go live.
   */
  async rollback(id: string) {
    const b = await importBatchRepo.getById(id, 'Import');
    if (!['committed', 'failed'].includes(b.status)) throw conflict(b.status === 'rolled_back' ? 'This import was already rolled back' : 'Only committed imports can be rolled back');
    const since = b.committedAt ?? b.updatedAt;
    const students = await studentRepo.find({ importBatchId: b._id });
    const ids = students.map((s) => s._id);
    const touched = new Set<string>();
    for (const s of students) if (s.status !== 'active' || s.updatedAt > since) touched.add(String(s._id));
    if (ids.length) {
      for (const a of await attendanceRepo.find({ studentId: { $in: ids } }, { select: 'studentId' })) touched.add(String(a.studentId));
      for (const e of await enrollmentRepo.find({ studentId: { $in: ids } })) {
        if (!e.importBatchId?.equals(b._id) || e.updatedAt > since) touched.add(String(e.studentId));
      }
      for (const l of await studentGuardianRepo.find({ studentId: { $in: ids } })) {
        if (!l.importBatchId?.equals(b._id) || l.updatedAt > since) touched.add(String(l.studentId));
      }
    }
    const remove = ids.filter((i) => !touched.has(String(i)));

    await withTransaction(async () => {
      if (remove.length) {
        await studentGuardianRepo.bulkWrite([{ deleteMany: { filter: { importBatchId: b._id, studentId: { $in: remove } } } }]);
        await enrollmentRepo.bulkWrite([{ deleteMany: { filter: { importBatchId: b._id, studentId: { $in: remove } } } }]);
        await studentRepo.bulkWrite([{ deleteMany: { filter: { importBatchId: b._id, _id: { $in: remove } } } }]);
      }
      // Guardians the batch created that no longer link to anyone.
      const gs = await guardianRepo.find({ importBatchId: b._id }, { select: '_id' });
      if (gs.length) {
        const stillLinked = new Set((await studentGuardianRepo.find({ guardianId: { $in: gs.map((g) => g._id) } }, { select: 'guardianId' })).map((l) => String(l.guardianId)));
        const orphan = gs.map((g) => g._id).filter((g) => !stillLinked.has(String(g)));
        if (orphan.length) await guardianRepo.bulkWrite([{ deleteMany: { filter: { importBatchId: b._id, _id: { $in: orphan } } } }]);
      }
    });

    const removedSet = new Set(remove.map(String));
    const results = b.results.map((r) =>
      r.status === 'created' && r.studentId
        ? removedSet.has(String(r.studentId))
          ? { ...r, messages: ['Rolled back'] }
          : { ...r, messages: ['Kept: the record was used or changed after the import'] }
        : r,
    );
    const counts = { ...b.counts, rolledBack: remove.length, kept: ids.length - remove.length };
    const done = await importBatchRepo.updateById(b._id, { status: 'rolled_back', rolledBackAt: new Date(), results, counts });
    await AuditService.record({ action: 'imports.rolled_back', entityType: 'import_batch', entityId: b._id, after: { rolledBack: counts.rolledBack, kept: counts.kept } });
    return done;
  },

  /** Error report: every rejected/duplicate/kept row with its reasons and the ORIGINAL cells (so it can be fixed and re-uploaded). */
  errorReport(b: Batch) {
    const byLine = new Map(b.results.map((r) => [r.line, r]));
    const rows: unknown[][] = [];
    b.rows.forEach((cells, i) => {
      const r = byLine.get(i + 2);
      if (!r || r.status === 'ok' || (r.status === 'created' && !r.messages.some((m) => m.startsWith('Kept')))) return;
      rows.push([i + 2, r.status, r.messages.join('; '), ...cells]);
    });
    return { headers: ['Line', 'Status', 'Problems', ...b.headers], rows };
  },
};
