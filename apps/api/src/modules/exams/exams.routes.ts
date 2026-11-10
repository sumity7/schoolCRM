import { z } from 'zod';
import { dayStringSchema, objectIdSchema, type Scope } from '@edunex/shared';
import type { Registrar } from '../../core/http/route';
import { forbidden, notFound } from '../../core/errors';
import { AuditService } from '../../core/audit/audit.service';
import { requireTenant } from '../../core/tenancy/context';
import { toObjectId } from '../../core/tenancy/repository';
import { AcademicsService } from '../academics/academics.service';
import { classRepo, sectionRepo, sessionRepo, subjectRepo } from '../academics/academics.repository';
import { enrollmentRepo, studentRepo } from '../students/students.repository';
import { getSchoolById } from '../schools/schools.service';
import { assertChild, isGuardian } from '../parent/parent-access';
import { ExamsService, resultDto } from './exams.service';
import { examRepo, examSubjectRepo, gradingScaleRepo, resultRepo } from './exams.repository';
import { renderReportCard } from './report-card.pdf';

const idParam = z.object({ id: objectIdSchema }).strict();
const marks = z.number().min(0).max(1000).nullable();
const examDto = (e: Awaited<ReturnType<typeof examRepo.getById>>) => ({
  id: String(e._id), sessionId: String(e.sessionId), name: e.name, type: e.type, classIds: e.classIds.map(String), gradingScaleId: String(e.gradingScaleId),
  absentIsFail: e.absentIsFail, status: e.status, publishedAt: e.publishedAt ?? null,
});

/** Section-level visibility of results for staff: school scope all; teachers their assigned sections. */
async function assertResultSection(scope: Scope | undefined, sectionId: unknown) {
  if (scope === 'school') return;
  await AcademicsService.assertSectionAccess(scope, sectionId);
}

async function reportCardFor(resultId: string, schoolId: Parameters<typeof getSchoolById>[0]) {
  const r = await resultRepo.getById(resultId, 'Result');
  const [exam, school, s, sec, cls] = await Promise.all([examRepo.getById(r.examId), getSchoolById(schoolId), studentRepo.getById(r.studentId), sectionRepo.findById(r.sectionId), classRepo.findById(r.classId)]);
  const session = await sessionRepo.findById(exam.sessionId);
  const enr = await enrollmentRepo.findById(r.enrollmentId);
  const dto = await resultDto(r);
  const a = school.address ?? {};
  return {
    result: r,
    pdf: await renderReportCard({
      school: { name: school.name, address: [a.line1, a.city, a.state].filter(Boolean).join(', ') || undefined },
      exam: { name: exam.name, session: session?.name ?? '' },
      student: { name: [s.firstName, s.lastName].filter(Boolean).join(' '), admissionNo: s.admissionNo, className: `${cls?.name ?? ''} ${sec?.name ?? ''}`.trim(), rollNo: enr?.rollNo ?? null },
      subjects: dto.subjects, totalObtained: r.totalObtained, totalMax: r.totalMax, percentage: r.percentage, grade: r.grade, resultStatus: r.resultStatus, rank: r.rank,
      version: r.version, correction: r.correction ?? null, bands: r.gradingScaleSnapshot.bands,
    }),
  };
}

export function registerExamRoutes(r: Registrar) {
  // ---------------------------------------------------------------- grading scales
  r.define({
    method: 'get', path: '/exams/grading-scales', summary: 'Grading scales', tenancy: 'school', auth: 'session', permission: 'exams:read',
    async handler() {
      return { data: (await gradingScaleRepo.find({}, { sort: { familyKey: 1, version: -1 } })).map((s) => ({ id: String(s._id), name: s.name, version: s.version, status: s.status, bands: s.bands })) };
    },
  });
  r.define({
    method: 'post', path: '/exams/grading-scales', summary: 'Create a grading scale (draft; new version if the name exists)', tenancy: 'school', auth: 'session', permission: 'exams:create',
    body: z.object({ name: z.string().trim().min(2).max(60), bands: z.array(z.object({ minPct: z.number().min(0).max(100), grade: z.string().trim().min(1).max(10), gradePoint: z.number().min(0).max(100).optional(), remark: z.string().trim().max(60).optional() }).strict()).min(1).max(15) }).strict(),
    audit: { exempt: 'ExamsService records exams.scale_created' },
    async handler({ body }) {
      const s = await ExamsService.createScale(body);
      return { status: 201, data: { id: String(s._id), name: s.name, version: s.version, status: s.status, bands: s.bands } };
    },
  });
  r.define({
    method: 'post', path: '/exams/grading-scales/:id/publish', summary: 'Publish a grading scale (immutable afterwards)', tenancy: 'school', auth: 'session', permission: 'exams:approve',
    params: idParam, idParams: { id: 'grading_scale' }, body: z.object({}).strict(), audit: { exempt: 'ExamsService records exams.scale_published' },
    async handler({ params }) { const s = await ExamsService.publishScale(params.id); return { data: { id: String(s._id), status: s.status } }; },
  });

  // ---------------------------------------------------------------- exams
  r.define({
    method: 'get', path: '/exams', summary: 'Exams of the active session', tenancy: 'school', auth: 'session', permission: 'exams:read',
    async handler() {
      const session = await sessionRepo.findActive();
      return { data: session ? (await examRepo.find({ sessionId: session._id }, { sort: { createdAt: -1 } })).map(examDto) : [] };
    },
  });
  r.define({
    method: 'post', path: '/exams', summary: 'Create an exam (draft)', tenancy: 'school', auth: 'session', permission: 'exams:create',
    body: z.object({ name: z.string().trim().min(2).max(80), type: z.enum(['unit', 'midterm', 'final', 'practical', 'internal']), classIds: z.array(objectIdSchema).min(1).max(20), gradingScaleId: objectIdSchema, absentIsFail: z.boolean().optional() }).strict(),
    audit: { exempt: 'ExamsService records exams.created' },
    async handler({ body }) { return { status: 201, data: examDto(await ExamsService.create(body)) }; },
  });
  r.define({
    method: 'get', path: '/exams/:id', summary: 'Exam with its subjects', tenancy: 'school', auth: 'session', permission: 'exams:read',
    params: idParam, idParams: { id: 'exam' },
    async handler({ params }) {
      const e = await examRepo.getById(params.id, 'Exam');
      const subs = await examSubjectRepo.find({ examId: e._id });
      const names = new Map((await subjectRepo.findByIds(subs.map((s) => s.subjectId))).map((s) => [String(s._id), s.name]));
      return { data: { ...examDto(e), subjects: subs.map((s) => ({ id: String(s._id), classId: String(s.classId), subjectId: String(s.subjectId), subject: names.get(String(s.subjectId)) ?? '—', maxMarks: s.maxMarks, passMarks: s.passMarks, date: s.date ?? null })) } };
    },
  });
  r.define({
    method: 'put', path: '/exams/:id/subjects', summary: 'Set subjects with max/pass marks per class (draft only)', tenancy: 'school', auth: 'session', permission: 'exams:update',
    params: idParam, idParams: { id: 'exam' },
    body: z.object({ subjects: z.array(z.object({ classId: objectIdSchema, subjectId: objectIdSchema, maxMarks: z.number().int().min(1).max(1000), passMarks: z.number().min(0).max(1000), date: dayStringSchema.nullable().optional() }).strict()).max(300) }).strict(),
    audit: { exempt: 'ExamsService records exams.subjects_set' },
    async handler({ params, body }) { await ExamsService.setSubjects(params.id, body.subjects); return { data: { saved: body.subjects.length } }; },
  });
  for (const [action, to] of [['open-marks', 'marks_open'], ['lock-marks', 'marks_locked']] as const) {
    r.define({
      method: 'post', path: `/exams/:id/${action}`, summary: action === 'open-marks' ? 'Open marks entry' : 'Lock marks (before computing results)', tenancy: 'school', auth: 'session', permission: 'exams:approve',
      params: idParam, idParams: { id: 'exam' }, body: z.object({}).strict(), audit: { exempt: 'ExamsService records the transition' },
      async handler({ params }) { return { data: examDto(await ExamsService.transition(params.id, to)) }; },
    });
  }

  // ---------------------------------------------------------------- marks
  r.define({
    method: 'get', path: '/exams/:id/marks', summary: 'Marks sheet for a section + subject (teachers: assigned only)', tenancy: 'school', auth: 'session', permission: 'marks:read',
    params: idParam, idParams: { id: 'exam' }, query: z.object({ sectionId: objectIdSchema, subjectId: objectIdSchema }).strict(),
    async handler({ params, query, scope }) { return { data: await ExamsService.sheet(scope, params.id, query.sectionId, query.subjectId) }; },
  });
  r.define({
    method: 'put', path: '/exams/:id/marks', summary: 'Save marks for a section + subject (all-or-nothing)', tenancy: 'school', auth: 'session', permission: 'marks:create',
    params: idParam, idParams: { id: 'exam' },
    body: z.object({ sectionId: objectIdSchema, subjectId: objectIdSchema, entries: z.array(z.object({ studentId: objectIdSchema, obtained: marks, status: z.enum(['entered', 'absent', 'exempt']) }).strict()).min(1).max(300) }).strict(),
    audit: { exempt: 'ExamsService records exams.marks_saved' },
    async handler({ params, body, scope }) { return { data: await ExamsService.saveMarks(scope, params.id, body) }; },
  });

  // ---------------------------------------------------------------- results
  r.define({
    method: 'post', path: '/exams/:id/results/compute', summary: 'Compute results from locked marks (deterministic)', tenancy: 'school', auth: 'session', permission: 'exams:approve',
    params: idParam, idParams: { id: 'exam' }, body: z.object({}).strict(), audit: { exempt: 'ExamsService records exams.results_computed' },
    async handler({ params }) { return { data: await ExamsService.compute(params.id) }; },
  });
  r.define({
    method: 'post', path: '/exams/:id/results/publish', summary: 'Publish results (immutable; parents can see them)', tenancy: 'school', auth: 'session', permission: 'results:publish',
    rateClass: 'sensitive', params: idParam, idParams: { id: 'exam' }, body: z.object({}).strict(), audit: { exempt: 'ExamsService records exams.results_published' },
    async handler({ params }) { return { data: examDto(await ExamsService.publish(params.id)) }; },
  });
  r.define({
    method: 'get', path: '/exams/:id/results', summary: 'Results of a section (teachers: assigned sections)', tenancy: 'school', auth: 'session', permission: 'results:read',
    params: idParam, idParams: { id: 'exam' }, query: z.object({ sectionId: objectIdSchema, history: z.enum(['true']).optional() }).strict(),
    async handler({ params, query, scope }) {
      const e = await examRepo.getById(params.id, 'Exam');
      await assertResultSection(scope, query.sectionId);
      const rows = await resultRepo.find({ examId: e._id, sectionId: toObjectId(query.sectionId), ...(query.history ? {} : { current: true }) }, { sort: { rank: 1 } });
      const names = new Map((await subjectRepo.find({})).map((s) => [String(s._id), s.name]));
      const studs = new Map((await studentRepo.findByIds(rows.map((x) => x.studentId), { select: 'firstName lastName admissionNo' })).map((s) => [String(s._id), s]));
      const out = await Promise.all(rows.map(async (x) => ({ ...(await resultDto(x, names)), student: { name: [studs.get(String(x.studentId))?.firstName, studs.get(String(x.studentId))?.lastName].filter(Boolean).join(' '), admissionNo: studs.get(String(x.studentId))?.admissionNo ?? '' } })));
      return { data: out.sort((a, b) => (a.rank ?? 9999) - (b.rank ?? 9999) || a.student.name.localeCompare(b.student.name)) };
    },
  });
  r.define({
    method: 'post', path: '/exams/:id/results/students/:studentId/correct', summary: 'Correct a PUBLISHED result (creates a new version with reason)', tenancy: 'school', auth: 'session', permission: 'results:approve',
    rateClass: 'sensitive', params: z.object({ id: objectIdSchema, studentId: objectIdSchema }).strict(), idParams: { id: 'exam', studentId: 'student' },
    body: z.object({ reason: z.string().trim().min(5).max(300), marks: z.array(z.object({ subjectId: objectIdSchema, obtained: marks, status: z.enum(['entered', 'absent', 'exempt']) }).strict()).min(1).max(20) }).strict(),
    audit: { exempt: 'ExamsService records exams.result_corrected with before/after' },
    async handler({ params, body }) {
      await studentRepo.getById(params.studentId, 'Student');
      return { data: await resultDto(await ExamsService.correct(params.id, params.studentId, body)) };
    },
  });
  r.define({
    method: 'get', path: '/results/:id/report-card.pdf', summary: 'Report card PDF (published results; teachers: assigned sections)', tenancy: 'school', auth: 'session', permission: 'results:print',
    rateClass: 'export', params: idParam, idParams: { id: 'result' },
    async handler({ params, scope, res, tenant }) {
      const r0 = await resultRepo.getById(params.id, 'Result');
      if (!r0.publishedAt) throw notFound('Result');
      await assertResultSection(scope, r0.sectionId);
      const { pdf } = await reportCardFor(params.id, tenant.schoolId);
      await AuditService.record({ action: 'exams.report_card_printed', entityType: 'result', entityId: r0._id });
      res.status(200).setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `inline; filename="report-card-${params.id}.pdf"`);
      res.send(pdf);
    },
  });

  // ---------------------------------------------------------------- parent view (published only)
  r.define({
    method: 'get', path: '/parent/children/:id/results', summary: 'A linked child\'s PUBLISHED results', tenancy: 'school', auth: 'session', allowOwnScope: true, permission: 'results:read',
    params: idParam, idParams: { id: 'student' },
    async handler({ params }) {
      if (!isGuardian()) throw forbidden('This area is for parents and guardians');
      const link = await assertChild(params.id);
      const rows = await resultRepo.find({ studentId: link.studentId, current: true, publishedAt: { $ne: null } }, { sort: { publishedAt: -1 } });
      const exams = new Map((await examRepo.findByIds(rows.map((x) => x.examId))).map((e) => [String(e._id), e]));
      return { data: await Promise.all(rows.map(async (x) => ({ ...(await resultDto(x)), examName: exams.get(String(x.examId))?.name ?? '' }))) };
    },
  });
  r.define({
    method: 'get', path: '/parent/children/:id/results/:resultId/report-card.pdf', summary: 'Report card PDF of a linked child', tenancy: 'school', auth: 'session', allowOwnScope: true, permission: 'results:print',
    rateClass: 'export', params: z.object({ id: objectIdSchema, resultId: objectIdSchema }).strict(), idParams: { id: 'student', resultId: 'result' },
    async handler({ params, res }) {
      if (!isGuardian()) throw forbidden('This area is for parents and guardians');
      const link = await assertChild(params.id);
      const r0 = await resultRepo.findById(params.resultId);
      if (!r0 || !r0.studentId.equals(link.studentId) || !r0.publishedAt) throw notFound('Result');
      const { pdf } = await reportCardFor(params.resultId, requireTenant('parent.reportcard').schoolId);
      await AuditService.record({ action: 'parents.report_card_downloaded', entityType: 'result', entityId: r0._id });
      res.status(200).setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', 'inline; filename="report-card.pdf"');
      res.send(pdf);
    },
  });
}
