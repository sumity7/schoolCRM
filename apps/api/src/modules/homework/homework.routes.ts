import { z } from 'zod';
import { objectIdSchema, paginationQuerySchema } from '@edunex/shared';
import type { Registrar } from '../../core/http/route';
import { forbidden } from '../../core/errors';
import { isGuardian } from '../parent/parent-access';
import { fileDto, submissionDto, type HomeworkService } from './homework.service';

const idParam = z.object({ id: objectIdSchema }).strict();
const upload = z.object({ filename: z.string().trim().min(1).max(200), contentBase64: z.string().min(4) }).strict();
const fileIds = z.array(objectIdSchema).max(5).optional();

/**
 * Homework API (Phase C). Teachers act only on classes they teach (scope `assigned`), administrators on all.
 * Students see and submit only their own class's published homework, with no id in the URL beyond the assignment;
 * parents get a read-only view per linked child. Files are only ever delivered through the authorised download route.
 */
export function registerHomeworkRoutes(r: Registrar, svc: HomeworkService) {
  // -------------------------------------------------------------------------------- files
  r.define({
    method: 'post', path: '/homework/files', summary: 'Upload an attachment for homework (validated; not yet attached)', tenancy: 'school', auth: 'session', permission: 'homework:create',
    body: upload, audit: { exempt: 'HomeworkService records homework.file_uploaded' },
    async handler({ body }) { return { status: 201, data: await svc.upload('assignment', body.filename, body.contentBase64) }; },
  });
  r.define({
    method: 'post', path: '/student/me/homework/files', summary: 'Upload a file for my submission (validated; not yet attached)', tenancy: 'school', auth: 'session', permission: 'homework:submit', allowOwnScope: true,
    body: upload, audit: { exempt: 'HomeworkService records homework.file_uploaded' },
    async handler({ body }) {
      const { currentStudent } = await import('../parent/parent-access');
      await currentStudent(); // students only (and only while active)
      return { status: 201, data: await svc.upload('submission', body.filename, body.contentBase64) };
    },
  });
  r.define({
    method: 'get', path: '/homework/files/:id', summary: 'Download a homework file (authorised per file; always as an attachment)', tenancy: 'school', auth: 'session', permission: 'homework:read', allowOwnScope: true,
    params: idParam, idParams: { id: 'file' },
    async handler({ params, scope, res }) {
      const { file, bytes } = await svc.download(params.id, scope);
      res.status(200);
      res.setHeader('Content-Type', file.mime);
      res.setHeader('Content-Disposition', `attachment; filename="${file.name.replace(/[^A-Za-z0-9._ -]/g, '_')}"`);
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox");
      res.send(bytes);
    },
  });

  // -------------------------------------------------------------------------------- staff
  r.define({
    method: 'get', path: '/homework', summary: 'Homework I can manage (teachers: own classes)', tenancy: 'school', auth: 'session', permission: 'homework:read',
    query: paginationQuerySchema.extend({ sectionId: objectIdSchema.optional(), status: z.enum(['published', 'withdrawn']).optional() }).strict(),
    async handler({ query, scope }) { const res = await svc.listForStaff(scope, query); return { data: res.data, meta: res.meta }; },
  });
  r.define({
    method: 'post', path: '/homework', summary: 'Set homework for a class (teachers: own classes only)', tenancy: 'school', auth: 'session', permission: 'homework:create',
    body: z.object({
      sectionId: objectIdSchema, subjectId: objectIdSchema, title: z.string().trim().min(3).max(150), description: z.string().trim().min(1).max(5000), instructions: z.string().trim().max(5000).optional(),
      dueAt: z.coerce.date(), maxMarks: z.number().min(0).max(1000).nullable().optional(), allowLate: z.boolean().optional(), fileIds,
    }).strict(),
    audit: { exempt: 'HomeworkService records homework.assignment_created' },
    async handler({ body, scope, auth }) { const a = await svc.create(scope, body, auth.user.name); return { status: 201, data: await svc.getForStaff(scope, String(a._id)) }; },
  });
  r.define({
    method: 'get', path: '/homework/:id', summary: 'One homework item', tenancy: 'school', auth: 'session', permission: 'homework:read',
    params: idParam, idParams: { id: 'homework' },
    async handler({ params, scope }) { return { data: await svc.getForStaff(scope, params.id) }; },
  });
  r.define({
    method: 'post', path: '/homework/:id/withdraw', summary: 'Withdraw homework (the teacher who set it, or an administrator)', tenancy: 'school', auth: 'session', permission: 'homework:update',
    params: idParam, idParams: { id: 'homework' }, body: z.object({}).strict(), audit: { exempt: 'HomeworkService records homework.assignment_withdrawn' },
    async handler({ params, scope }) { await svc.withdraw(scope, params.id); return { data: await svc.getForStaff(scope, params.id) }; },
  });
  r.define({
    method: 'get', path: '/homework/:id/submissions', summary: 'Marking sheet: every student of the class and their submission state', tenancy: 'school', auth: 'session', permission: 'homework:read',
    params: idParam, idParams: { id: 'homework' },
    async handler({ params, scope }) { return { data: await svc.submissionsOf(scope, params.id) }; },
  });
  r.define({
    method: 'put', path: '/homework/:id/submissions/:studentId/review', summary: 'Give marks and/or feedback on a submission', tenancy: 'school', auth: 'session', permission: 'homework:update',
    params: z.object({ id: objectIdSchema, studentId: objectIdSchema }).strict(), idParams: { id: 'homework', studentId: 'student' },
    body: z.object({ marks: z.number().min(0).max(1000).nullable().optional(), feedback: z.string().trim().max(3000).nullable().optional() }).strict(),
    audit: { exempt: 'HomeworkService records homework.submission_reviewed' },
    async handler({ params, body, scope }) { return { data: submissionDto((await svc.review(scope, params.id, params.studentId, body)) as never) }; },
  });

  // -------------------------------------------------------------------------------- students
  r.define({
    method: 'get', path: '/student/me/homework', summary: 'My class homework with my submission state', tenancy: 'school', auth: 'session', permission: 'homework:read', allowOwnScope: true,
    async handler() { return { data: await svc.listMine() }; },
  });
  r.define({
    method: 'get', path: '/student/me/homework/:id', summary: 'One homework item with my submission', tenancy: 'school', auth: 'session', permission: 'homework:read', allowOwnScope: true,
    params: idParam, idParams: { id: 'homework' },
    async handler({ params }) { return { data: await svc.getMine(params.id) }; },
  });
  r.define({
    method: 'put', path: '/student/me/homework/:id/submission', summary: 'Submit (or re-submit before review) my answer', tenancy: 'school', auth: 'session', permission: 'homework:submit', allowOwnScope: true,
    params: idParam, idParams: { id: 'homework' }, body: z.object({ text: z.string().trim().max(10000).optional(), fileIds }).strict(),
    audit: { exempt: 'HomeworkService records homework.submitted / homework.submission_resubmitted' },
    async handler({ params, body }) { await svc.submit(params.id, body); return { data: await svc.getMine(params.id) }; },
  });

  // -------------------------------------------------------------------------------- parents
  r.define({
    method: 'get', path: '/parent/children/:id/homework', summary: 'A linked child homework and submission state (read-only)', tenancy: 'school', auth: 'session', permission: 'homework:read', allowOwnScope: true,
    params: idParam, idParams: { id: 'student' },
    async handler({ params }) { if (!isGuardian()) throw forbidden('This area is for parents and guardians'); return { data: await svc.listForChild(params.id) }; },
  });
}

void fileDto;
