import { Types } from 'mongoose';
import { conflict, notFound, validationFailed } from '../../core/errors';
import { AuditService } from '../../core/audit/audit.service';
import { withTransaction } from '../../core/db/connection';
import { classRepo, sectionRepo, sessionRepo } from '../academics/academics.repository';
import { enrollmentRepo, studentRepo } from '../students/students.repository';
import { feeStructureRepo } from '../fees/fees.repository';
import { examRepo, resultRepo } from '../exams/exams.repository';
import { promotionRepo } from './promotion.repository';

const CHUNK = 100;

async function sessions(targetSessionId: string) {
  const from = await sessionRepo.findActive();
  if (!from) throw conflict('There is no active session to promote from');
  const to = await sessionRepo.getById(targetSessionId, 'Session');
  if (to.status !== 'draft') throw conflict('Promote into a NEW (draft) session — create it under Academic sessions first');
  if (to.startDate <= from.startDate) throw validationFailed('The target session must start after the current one');
  return { from, to };
}

export const PromotionService = {
  /** Copies the class/section structure (and optionally fee structures as drafts) into the target session. Idempotent. */
  async prepare(targetSessionId: string, opts: { copyFeeStructures?: boolean } = {}) {
    const { from, to } = await sessions(targetSessionId);
    const srcClasses = await classRepo.find({ sessionId: from._id }, { sort: { order: 1 } });
    const existing = await classRepo.find({ sessionId: to._id });
    let classesCreated = 0;
    let sectionsCreated = 0;
    let feeStructuresCopied = 0;
    await withTransaction(async () => {
      for (const c of srcClasses) {
        let target = existing.find((x) => x.name === c.name);
        if (!target) {
          target = await classRepo.create({ sessionId: to._id, name: c.name, order: c.order, stream: c.stream });
          classesCreated++;
        }
        const have = new Set((await sectionRepo.find({ classId: target._id })).map((s) => s.name));
        for (const s of await sectionRepo.find({ classId: c._id })) {
          if (have.has(s.name)) continue;
          await sectionRepo.create({ sessionId: to._id, classId: target._id, name: s.name, capacity: s.capacity, classTeacherId: null });
          sectionsCreated++;
        }
        if (opts.copyFeeStructures) {
          for (const st of await feeStructureRepo.find({ sessionId: from._id, classId: c._id, status: 'published' })) {
            const familyKey = `${to._id}:${target._id}:${st.name.toLowerCase()}`;
            if (await feeStructureRepo.exists({ familyKey })) continue;
            // due dates move by one year; the school reviews amounts before publishing the draft
            const shift = (d: string) => `${Number(d.slice(0, 4)) + 1}${d.slice(4)}`;
            await feeStructureRepo.create({
              sessionId: to._id, classId: target._id, name: st.name, familyKey, version: 1, status: 'draft',
              items: st.items.map((it) => ({ ...it, installments: it.installments.map((i) => ({ ...i, dueDate: shift(i.dueDate) })) })),
            });
            feeStructuresCopied++;
          }
        }
      }
    });
    await AuditService.record({ action: 'promotion.prepared', entityType: 'session', entityId: to._id, after: { from: String(from._id), classesCreated, sectionsCreated, feeStructuresCopied } });
    return { classesCreated, sectionsCreated, feeStructuresCopied };
  },

  /** Per class: where its students go next year, with a suggested action per student. */
  async preview(targetSessionId: string) {
    const { from, to } = await sessions(targetSessionId);
    const [srcClasses, dstClasses] = await Promise.all([classRepo.find({ sessionId: from._id }, { sort: { order: 1, name: 1 } }), classRepo.find({ sessionId: to._id }, { sort: { order: 1, name: 1 } })]);
    if (!dstClasses.length) throw conflict('Prepare the new session first (copy classes and sections)');
    const [srcSections, dstSections] = await Promise.all([sectionRepo.find({ sessionId: from._id }), sectionRepo.find({ sessionId: to._id })]);
    const enr = await enrollmentRepo.find({ sessionId: from._id, status: 'active' }, { sort: { rollNo: 1 } });
    const students = new Map((await studentRepo.findByIds(enr.map((e) => e.studentId), { select: 'firstName lastName admissionNo' })).map((s) => [String(s._id), s]));
    const decided = new Map((await promotionRepo.find({ toSessionId: to._id })).map((p) => [String(p.studentId), p]));
    // latest published result of the session per student → suggest retaining after a fail
    const exams = await examRepo.find({ sessionId: from._id, status: 'published' }, { sort: { publishedAt: -1 } });
    const results = exams.length ? await resultRepo.find({ examId: { $in: exams.map((e) => e._id) }, current: true }, { select: 'studentId examId resultStatus percentage' }) : [];
    const examOrder = new Map(exams.map((e, i) => [String(e._id), i]));
    const latest = new Map<string, (typeof results)[number]>();
    for (const r of results) {
      const prev = latest.get(String(r.studentId));
      if (!prev || examOrder.get(String(r.examId))! < examOrder.get(String(prev.examId))!) latest.set(String(r.studentId), r);
    }
    const dstEnr = new Map((await enrollmentRepo.find({ sessionId: to._id })).map((e) => [String(e._id), e]));
    return srcClasses.map((c) => {
      const same = dstClasses.find((d) => d.name === c.name) ?? null;
      const next = dstClasses.find((d) => d.order > c.order) ?? null;
      const secName = new Map(srcSections.filter((s) => s.classId.equals(c._id)).map((s) => [String(s._id), s.name]));
      const sectionsIn = (cls: typeof next) => (cls ? dstSections.filter((s) => s.classId.equals(cls._id)).map((s) => ({ id: String(s._id), name: s.name })) : []);
      return {
        classId: String(c._id), className: c.name,
        nextClass: next ? { id: String(next._id), name: next.name, sections: sectionsIn(next) } : null,
        sameClass: same ? { id: String(same._id), name: same.name, sections: sectionsIn(same) } : null,
        students: enr.filter((e) => e.classId.equals(c._id)).map((e) => {
          const s = students.get(String(e.studentId));
          const lr = latest.get(String(e.studentId));
          const sName = secName.get(String(e.sectionId)) ?? '';
          const suggested: 'promote' | 'retain' | 'graduate' = lr?.resultStatus === 'fail' ? 'retain' : next ? 'promote' : 'graduate';
          const targetCls = suggested === 'retain' ? same : next;
          const targetSection = sectionsIn(targetCls).find((x) => x.name === sName) ?? sectionsIn(targetCls)[0] ?? null;
          const d = decided.get(String(e.studentId));
          return {
            studentId: String(e.studentId), name: s ? [s.firstName, s.lastName].filter(Boolean).join(' ') : '', admissionNo: s?.admissionNo ?? '', section: sName, rollNo: e.rollNo ?? null,
            lastResult: lr ? { status: lr.resultStatus, percentage: lr.percentage } : null,
            suggested, suggestedSectionId: targetSection?.id ?? null,
            decided: d ? { action: d.action, sectionId: d.toEnrollmentId ? String(dstEnr.get(String(d.toEnrollmentId))?.sectionId ?? '') : null } : null,
          };
        }),
      };
    });
  },

  /** Records decisions and creates next-session enrolments. Re-running with a changed decision replaces it (before activation). */
  async commit(targetSessionId: string, decisions: Array<{ studentId: string; action: 'promote' | 'retain' | 'graduate'; sectionId?: string | null }>) {
    const { from, to } = await sessions(targetSessionId);
    if (new Set(decisions.map((d) => d.studentId)).size !== decisions.length) throw validationFailed('A student appears twice');
    const fromEnr = new Map((await enrollmentRepo.find({ sessionId: from._id, status: 'active', studentId: { $in: decisions.map((d) => toOid(d.studentId)) } })).map((e) => [String(e.studentId), e]));
    const dstSections = new Map((await sectionRepo.find({ sessionId: to._id })).map((s) => [String(s._id), s]));
    const srcClasses = new Map((await classRepo.find({ sessionId: from._id })).map((c) => [String(c._id), c]));
    const dstClasses = new Map((await classRepo.find({ sessionId: to._id })).map((c) => [String(c._id), c]));
    const problems: Array<{ path: string; message: string }> = [];
    for (const d of decisions) {
      const e = fromEnr.get(d.studentId);
      if (!e) { problems.push({ path: d.studentId, message: 'not actively enrolled this session' }); continue; }
      if (d.action === 'graduate') continue;
      const sec = d.sectionId ? dstSections.get(d.sectionId) : undefined;
      if (!sec) { problems.push({ path: d.studentId, message: 'choose a section in the new session' }); continue; }
      const srcCls = srcClasses.get(String(e.classId))!;
      const dstCls = dstClasses.get(String(sec.classId))!;
      if (d.action === 'retain' && dstCls.name !== srcCls.name) problems.push({ path: d.studentId, message: 'a retained student stays in the same class' });
      if (d.action === 'promote' && dstCls.order <= srcCls.order) problems.push({ path: d.studentId, message: 'promotion must go to a higher class' });
    }
    if (problems.length) throw validationFailed('Some decisions are invalid — nothing was saved', problems);

    const counts = { promote: 0, retain: 0, graduate: 0 };
    for (let i = 0; i < decisions.length; i += CHUNK) {
      await withTransaction(async () => {
        for (const d of decisions.slice(i, i + CHUNK)) {
          const e = fromEnr.get(d.studentId)!;
          const prev = await promotionRepo.findOne({ toSessionId: to._id, studentId: e.studentId });
          if (prev?.toEnrollmentId) await enrollmentRepo.bulkWrite([{ deleteOne: { filter: { _id: prev.toEnrollmentId, sessionId: to._id } } }]); // never used: target session is not active
          let toEnrollmentId: Types.ObjectId | null = null;
          if (d.action !== 'graduate') {
            const sec = dstSections.get(d.sectionId!)!;
            toEnrollmentId = (await enrollmentRepo.create({ studentId: e.studentId, sessionId: to._id, classId: sec.classId, sectionId: sec._id, status: 'active', joinedOn: to.startDate })).
              _id;
          }
          if (prev) await promotionRepo.updateById(prev._id, { action: d.action, toEnrollmentId, fromEnrollmentId: e._id });
          else await promotionRepo.create({ studentId: e.studentId, fromSessionId: from._id, toSessionId: to._id, fromEnrollmentId: e._id, toEnrollmentId, action: d.action, finalizedAt: null });
          counts[d.action]++;
        }
      });
    }
    await AuditService.record({ action: 'promotion.decisions_saved', entityType: 'session', entityId: to._id, after: counts });
    return counts;
  },

  /** Runs when a session is ACTIVATED: closes the old enrolments as recorded and points students at their new class. */
  async finalize(sessionId: Types.ObjectId) {
    const recs = await promotionRepo.find({ toSessionId: sessionId, finalizedAt: null });
    if (!recs.length) return { finalized: 0 };
    const session = await sessionRepo.getById(sessionId);
    const fromSession = await sessionRepo.findById(recs[0]!.fromSessionId);
    const leftOn = fromSession?.endDate ?? session.startDate;
    const status = { promote: 'promoted', retain: 'retained', graduate: 'graduated' } as const;
    for (let i = 0; i < recs.length; i += CHUNK) {
      await withTransaction(async () => {
        for (const r of recs.slice(i, i + CHUNK)) {
          await enrollmentRepo.updateById(r.fromEnrollmentId, { status: status[r.action], leftOn });
          if (r.action === 'graduate') await studentRepo.updateById(r.studentId, { status: 'graduated', statusChangedOn: leftOn, statusReason: 'Graduated', currentEnrollmentId: null });
          else await studentRepo.updateById(r.studentId, { currentEnrollmentId: r.toEnrollmentId });
          await promotionRepo.updateById(r._id, { finalizedAt: new Date() });
        }
      });
    }
    await AuditService.record({ action: 'promotion.finalized', entityType: 'session', entityId: sessionId, after: { students: recs.length } });
    return { finalized: recs.length };
  },
};

function toOid(s: string): Types.ObjectId {
  if (!/^[a-f\d]{24}$/i.test(s)) throw notFound('Student');
  return new Types.ObjectId(s);
}
