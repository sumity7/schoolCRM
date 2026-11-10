import { Types } from 'mongoose';
import { computeResult, rankResults, validateBands, type GradeBand, type Scope, type SubjectInput } from '@edunex/shared';
import { conflict, forbidden, notFound, validationFailed } from '../../core/errors';
import { AuditService } from '../../core/audit/audit.service';
import { withTransaction } from '../../core/db/connection';
import { requireTenant } from '../../core/tenancy/context';
import { toObjectId } from '../../core/tenancy/repository';
import { assignmentRepo, classRepo, sectionRepo, sessionRepo, subjectRepo } from '../academics/academics.repository';
import { enrollmentRepo, studentRepo } from '../students/students.repository';
import { examRepo, examSubjectRepo, gradingScaleRepo, markRepo, resultRepo } from './exams.repository';

type Exam = Awaited<ReturnType<typeof examRepo.getById>>;
const twoDecimals = (x: number) => Math.round(x * 100) === x * 100;

/** May the caller enter marks for this section + subject? School scope: yes. Teachers: an assignment for that section
 * with that subject (or a general class assignment), or being the section's class teacher. */
async function assertMarksAccess(scope: Scope | undefined, sectionId: Types.ObjectId, subjectId: Types.ObjectId) {
  if (scope === 'school') return;
  const t = requireTenant('exams.marksAccess');
  if (scope !== 'assigned' || t.personType !== 'staff' || !t.personId) throw forbidden('You cannot enter marks');
  const section = await sectionRepo.getById(sectionId, 'Section');
  if (section.classTeacherId?.equals(t.personId)) return;
  const ok = await assignmentRepo.exists({ staffId: t.personId, sectionId, $or: [{ subjectId }, { subjectId: null }] });
  if (!ok) throw forbidden('You are not assigned to this class and subject');
}

export const ExamsService = {
  // ---------------------------------------------------------------- grading scales
  async createScale(input: { name: string; bands: GradeBand[] }) {
    const err = validateBands(input.bands);
    if (err) throw validationFailed(err);
    const familyKey = input.name.trim().toLowerCase();
    const latest = await gradingScaleRepo.find({ familyKey }, { sort: { version: -1 }, limit: 1 });
    if (latest[0]?.status === 'draft') throw conflict('A draft of this grading scale already exists');
    const s = await gradingScaleRepo.create({ name: input.name.trim(), familyKey, version: (latest[0]?.version ?? 0) + 1, bands: [...input.bands].sort((a, b) => b.minPct - a.minPct), status: 'draft' });
    await AuditService.record({ action: 'exams.scale_created', entityType: 'grading_scale', entityId: s._id, after: { name: s.name, version: s.version } });
    return s;
  },
  async publishScale(id: string) {
    const s = await gradingScaleRepo.getById(id, 'Grading scale');
    if (s.status !== 'draft') throw conflict('Already published');
    const u = await gradingScaleRepo.updateById(s._id, { status: 'published' });
    await AuditService.record({ action: 'exams.scale_published', entityType: 'grading_scale', entityId: s._id });
    return u;
  },

  // ---------------------------------------------------------------- exams
  async create(input: { name: string; type: 'unit' | 'midterm' | 'final' | 'practical' | 'internal'; classIds: string[]; gradingScaleId: string; absentIsFail?: boolean }) {
    const session = await sessionRepo.findActive();
    if (!session) throw conflict('No active academic session');
    const scale = await gradingScaleRepo.getById(input.gradingScaleId, 'Grading scale');
    if (scale.status !== 'published') throw validationFailed('Publish the grading scale first');
    const classes = await classRepo.findByIds(input.classIds);
    if (classes.length !== new Set(input.classIds).size || classes.some((c) => !c.sessionId.equals(session._id))) throw notFound('Class');
    if (await examRepo.exists({ sessionId: session._id, name: input.name.trim() })) throw conflict('An exam with this name already exists this session');
    const e = await examRepo.create({ sessionId: session._id, name: input.name.trim(), type: input.type, classIds: classes.map((c) => c._id), gradingScaleId: scale._id, absentIsFail: input.absentIsFail ?? true, status: 'draft' });
    await AuditService.record({ action: 'exams.created', entityType: 'exam', entityId: e._id, after: { name: e.name, classes: classes.length } });
    return e;
  },

  async setSubjects(examId: string, rows: Array<{ classId: string; subjectId: string; maxMarks: number; passMarks: number; date?: string | null }>) {
    const exam = await examRepo.getById(examId, 'Exam');
    if (exam.status !== 'draft') throw conflict('Subjects can only be changed while the exam is a draft');
    const subjects = new Map((await subjectRepo.findByIds(rows.map((r) => r.subjectId))).map((s) => [String(s._id), s]));
    const seen = new Set<string>();
    for (const r of rows) {
      if (!exam.classIds.some((c) => String(c) === r.classId)) throw validationFailed('A subject row uses a class that is not part of this exam');
      if (!subjects.has(r.subjectId)) throw notFound('Subject');
      if (r.passMarks > r.maxMarks) throw validationFailed('Pass marks cannot exceed maximum marks');
      const k = `${r.classId}:${r.subjectId}`;
      if (seen.has(k)) throw validationFailed('A subject appears twice for the same class');
      seen.add(k);
    }
    await withTransaction(async () => {
      await examSubjectRepo.bulkWrite([{ deleteMany: { filter: { examId: exam._id } } }]);
      if (rows.length) await examSubjectRepo.createMany(rows.map((r) => ({ examId: exam._id, classId: new Types.ObjectId(r.classId), subjectId: new Types.ObjectId(r.subjectId), maxMarks: r.maxMarks, passMarks: r.passMarks, date: r.date ?? null })));
    });
    await AuditService.record({ action: 'exams.subjects_set', entityType: 'exam', entityId: exam._id, after: { rows: rows.length } });
    return examSubjectRepo.find({ examId: exam._id });
  },

  async transition(examId: string, to: 'marks_open' | 'marks_locked') {
    const exam = await examRepo.getById(examId, 'Exam');
    const allowed: Record<string, string[]> = { marks_open: ['draft', 'marks_locked'], marks_locked: ['marks_open'] };
    if (!allowed[to]!.includes(exam.status)) throw conflict(`Cannot move from ${exam.status.replace('_', ' ')} to ${to.replace('_', ' ')}`);
    if (to === 'marks_open' && !(await examSubjectRepo.exists({ examId: exam._id }))) throw validationFailed('Add subjects (max/pass marks) first');
    if (to === 'marks_open' && exam.status === 'marks_locked') await resultRepo.bulkWrite([{ deleteMany: { filter: { examId: exam._id, publishedAt: null } } }]); // re-opening discards unpublished computed results
    const u = await examRepo.updateById(exam._id, { status: to });
    await AuditService.record({ action: `exams.${to}`, entityType: 'exam', entityId: exam._id, before: { status: exam.status } });
    return u;
  },

  // ---------------------------------------------------------------- marks
  async sheet(scope: Scope | undefined, examId: string, sectionId: string, subjectId: string) {
    const exam = await examRepo.getById(examId, 'Exam');
    const section = await sectionRepo.getById(sectionId, 'Section');
    const sid = toObjectId(subjectId);
    if (!sid) throw notFound('Subject');
    await assertMarksAccess(scope, section._id, sid);
    const es = await examSubjectRepo.findOne({ examId: exam._id, classId: section.classId, subjectId: sid });
    if (!es) throw notFound('Exam subject');
    const enr = await enrollmentRepo.find({ sectionId: section._id, sessionId: exam.sessionId, status: 'active' }, { sort: { rollNo: 1 } });
    const students = new Map((await studentRepo.findByIds(enr.map((e) => e.studentId), { select: 'firstName lastName admissionNo' })).map((s) => [String(s._id), s]));
    const marks = new Map((await markRepo.find({ examSubjectId: es._id, studentId: { $in: enr.map((e) => e.studentId) } })).map((m) => [String(m.studentId), m]));
    return {
      exam: { id: String(exam._id), name: exam.name, status: exam.status },
      subject: { id: String(es._id), maxMarks: es.maxMarks, passMarks: es.passMarks },
      students: enr.map((e) => {
        const s = students.get(String(e.studentId));
        const m = marks.get(String(e.studentId));
        return { studentId: String(e.studentId), rollNo: e.rollNo ?? null, name: s ? [s.firstName, s.lastName].filter(Boolean).join(' ') : '', admissionNo: s?.admissionNo ?? '', obtained: m?.obtained ?? null, status: m?.status ?? null };
      }),
    };
  },

  async saveMarks(scope: Scope | undefined, examId: string, input: { sectionId: string; subjectId: string; entries: Array<{ studentId: string; obtained: number | null; status: 'entered' | 'absent' | 'exempt' }> }) {
    const exam = await examRepo.getById(examId, 'Exam');
    if (exam.status !== 'marks_open') throw conflict(exam.status === 'published' ? 'Results are published — use a correction' : 'Marks entry is not open for this exam');
    const section = await sectionRepo.getById(input.sectionId, 'Section');
    const sid = toObjectId(input.subjectId)!;
    await assertMarksAccess(scope, section._id, sid);
    const es = await examSubjectRepo.findOne({ examId: exam._id, classId: section.classId, subjectId: sid });
    if (!es) throw notFound('Exam subject');
    const enr = new Map((await enrollmentRepo.find({ sectionId: section._id, sessionId: exam.sessionId, status: 'active' })).map((e) => [String(e.studentId), e]));
    const problems: Array<{ path: string; message: string }> = [];
    for (const e of input.entries) {
      if (!enr.has(e.studentId)) problems.push({ path: e.studentId, message: 'not in this section' });
      if (e.status === 'entered' && e.obtained !== null && (e.obtained < 0 || e.obtained > es.maxMarks || !twoDecimals(e.obtained))) problems.push({ path: e.studentId, message: `marks must be 0–${es.maxMarks} (max 2 decimals)` });
      if (e.status !== 'entered' && e.obtained !== null) problems.push({ path: e.studentId, message: 'absent/exempt cannot have marks' });
    }
    if (new Set(input.entries.map((e) => e.studentId)).size !== input.entries.length) problems.push({ path: 'entries', message: 'duplicate students' });
    if (problems.length) throw validationFailed('Some marks are invalid — nothing was saved', problems);
    await withTransaction(async () => {
      await markRepo.bulkWrite(input.entries.map((e) => ({
        updateOne: {
          filter: { examSubjectId: es._id, studentId: new Types.ObjectId(e.studentId) },
          update: { $set: { examId: exam._id, enrollmentId: enr.get(e.studentId)!._id, sectionId: section._id, obtained: e.status === 'entered' ? e.obtained : null, status: e.status } },
          upsert: true,
        },
      })) as never);
    });
    await AuditService.record({ action: 'exams.marks_saved', entityType: 'exam', entityId: exam._id, after: { sectionId: input.sectionId, subjectId: input.subjectId, entries: input.entries.length } });
    return { saved: input.entries.length };
  },

  // ---------------------------------------------------------------- results
  async inputsFor(exam: Exam, studentIds?: Types.ObjectId[]) {
    const subjects = await examSubjectRepo.find({ examId: exam._id });
    const ef: Record<string, unknown> = { sessionId: exam.sessionId, classId: { $in: exam.classIds }, status: 'active' };
    if (studentIds) ef.studentId = { $in: studentIds };
    const enr = await enrollmentRepo.find(ef);
    const marks = await markRepo.find({ examId: exam._id, studentId: { $in: enr.map((e) => e.studentId) } });
    const mBy = new Map(marks.map((m) => [`${m.examSubjectId}:${m.studentId}`, m]));
    return enr.map((e) => ({
      e,
      inputs: subjects.filter((s) => s.classId.equals(e.classId)).map((s): SubjectInput => {
        const m = mBy.get(`${s._id}:${e.studentId}`);
        return { subjectId: String(s.subjectId), maxMarks: s.maxMarks, passMarks: s.passMarks, obtained: m?.obtained ?? null, status: m ? m.status : 'not_entered' };
      }),
    }));
  },

  /** Deterministic: same marks + same scale → identical results. Replaces any UNPUBLISHED computed results. */
  async compute(examId: string) {
    const exam = await examRepo.getById(examId, 'Exam');
    if (exam.status !== 'marks_locked') throw conflict('Lock marks before computing results');
    const scale = await gradingScaleRepo.getById(exam.gradingScaleId, 'Grading scale');
    const rows = (await this.inputsFor(exam)).map(({ e, inputs }) => ({ e, ...computeResult(inputs, scale.bands, { absentIsFail: exam.absentIsFail }) }));
    const bySection = new Map<string, typeof rows>();
    for (const r of rows) bySection.set(String(r.e.sectionId), [...(bySection.get(String(r.e.sectionId)) ?? []), r]);
    const ranked = [...bySection.values()].flatMap((g) => rankResults(g));
    await withTransaction(async () => {
      await resultRepo.bulkWrite([{ deleteMany: { filter: { examId: exam._id, publishedAt: null } } }]);
      if (ranked.length) {
        await resultRepo.createMany(ranked.map((r) => ({
          examId: exam._id, studentId: r.e.studentId, enrollmentId: r.e._id, classId: r.e.classId, sectionId: r.e.sectionId, version: 1, current: true,
          subjectResults: r.subjectResults.map((s) => ({ ...s, subjectId: new Types.ObjectId(s.subjectId) })), totalObtained: r.totalObtained, totalMax: r.totalMax,
          percentage: r.percentage, grade: r.grade, resultStatus: r.resultStatus, rank: r.rank,
          gradingScaleSnapshot: { id: scale._id, version: scale.version, bands: scale.bands }, publishedAt: null, correction: null,
        })));
      }
    });
    const summary = { students: ranked.length, pass: ranked.filter((r) => r.resultStatus === 'pass').length, fail: ranked.filter((r) => r.resultStatus === 'fail').length, incomplete: ranked.filter((r) => r.resultStatus === 'incomplete').length };
    await AuditService.record({ action: 'exams.results_computed', entityType: 'exam', entityId: exam._id, after: summary });
    return summary;
  },

  async publish(examId: string) {
    const exam = await examRepo.getById(examId, 'Exam');
    if (exam.status !== 'marks_locked') throw conflict(exam.status === 'published' ? 'Already published' : 'Lock marks and compute results first');
    if (!(await resultRepo.exists({ examId: exam._id, current: true }))) throw conflict('Compute results first');
    if (await resultRepo.exists({ examId: exam._id, current: true, resultStatus: 'incomplete' })) throw conflict('Some results are incomplete (marks missing) — complete them before publishing');
    const now = new Date();
    await withTransaction(async () => {
      await resultRepo.bulkWrite([{ updateMany: { filter: { examId: exam._id, current: true, publishedAt: null }, update: { $set: { publishedAt: now } } } }]);
      await examRepo.updateById(exam._id, { status: 'published', publishedAt: now });
    });
    await AuditService.record({ action: 'exams.results_published', entityType: 'exam', entityId: exam._id });
    return examRepo.getById(exam._id);
  },

  /** Post-publication correction: new marks for ONE student → result version n+1 (published), old version kept. */
  async correct(examId: string, studentId: string, input: { reason: string; marks: Array<{ subjectId: string; obtained: number | null; status: 'entered' | 'absent' | 'exempt' }> }) {
    const exam = await examRepo.getById(examId, 'Exam');
    if (exam.status !== 'published') throw conflict('Corrections apply to published results; before publishing just edit the marks');
    const current = await resultRepo.findOne({ examId: exam._id, studentId: toObjectId(studentId) ?? new Types.ObjectId(), current: true });
    if (!current) throw notFound('Result');
    const subjects = await examSubjectRepo.find({ examId: exam._id, classId: current.classId });
    const before = current.subjectResults.map((s) => ({ subjectId: String(s.subjectId), obtained: s.obtained, status: s.status }));
    for (const m of input.marks) {
      const es = subjects.find((s) => String(s.subjectId) === m.subjectId);
      if (!es) throw notFound('Exam subject');
      if (m.status === 'entered' && (m.obtained === null || m.obtained < 0 || m.obtained > es.maxMarks || !twoDecimals(m.obtained))) throw validationFailed(`Marks must be 0–${es.maxMarks}`);
    }
    const scale = { bands: current.gradingScaleSnapshot.bands }; // the scale the result was published with — later scale changes never alter it
    const updated = await withTransaction(async () => {
      for (const m of input.marks) {
        const es = subjects.find((s) => String(s.subjectId) === m.subjectId)!;
        await markRepo.bulkWrite([{ updateOne: { filter: { examSubjectId: es._id, studentId: current.studentId }, update: { $set: { examId: exam._id, enrollmentId: current.enrollmentId, sectionId: current.sectionId, obtained: m.status === 'entered' ? m.obtained : null, status: m.status } }, upsert: true } }] as never);
      }
      const one = (await this.inputsFor(exam, [current.studentId]))[0];
      if (!one) throw conflict('The student is no longer actively enrolled for this exam');
      const r = computeResult(one.inputs, scale.bands, { absentIsFail: exam.absentIsFail });
      const peers = await resultRepo.find({ examId: exam._id, sectionId: current.sectionId, current: true, studentId: { $ne: current.studentId } }, { select: 'percentage resultStatus' });
      const rank = r.resultStatus === 'incomplete' || r.percentage === null ? null : 1 + peers.filter((p) => p.resultStatus !== 'incomplete' && (p.percentage ?? -1) > r.percentage!).length;
      await resultRepo.updateById(current._id, { current: false });
      return resultRepo.create({
        examId: exam._id, studentId: current.studentId, enrollmentId: current.enrollmentId, classId: current.classId, sectionId: current.sectionId, version: current.version + 1, current: true,
        subjectResults: r.subjectResults.map((s) => ({ ...s, subjectId: new Types.ObjectId(s.subjectId) })), totalObtained: r.totalObtained, totalMax: r.totalMax,
        percentage: r.percentage, grade: r.grade, resultStatus: r.resultStatus, rank, gradingScaleSnapshot: current.gradingScaleSnapshot, publishedAt: new Date(),
        correction: { reason: input.reason, previousVersion: current.version },
      });
    });
    await AuditService.record({ action: 'exams.result_corrected', entityType: 'result', entityId: updated._id, before: { version: current.version, marks: before, percentage: current.percentage }, after: { version: updated.version, marks: input.marks, percentage: updated.percentage, reason: input.reason } });
    return updated;
  },
};

export async function resultDto(r: Awaited<ReturnType<typeof resultRepo.getById>>, subjectNames?: Map<string, string>) {
  const names = subjectNames ?? new Map((await subjectRepo.findByIds(r.subjectResults.map((s) => s.subjectId))).map((s) => [String(s._id), s.name]));
  return {
    id: String(r._id), examId: String(r.examId), studentId: String(r.studentId), sectionId: String(r.sectionId), version: r.version, current: r.current,
    subjects: r.subjectResults.map((s) => ({ subjectId: String(s.subjectId), subject: names.get(String(s.subjectId)) ?? '—', obtained: s.obtained, max: s.max, status: s.status, passed: s.passed, grade: s.grade })),
    totalObtained: r.totalObtained, totalMax: r.totalMax, percentage: r.percentage, grade: r.grade, resultStatus: r.resultStatus, rank: r.rank,
    publishedAt: r.publishedAt ?? null, correction: r.correction ?? null,
  };
}
