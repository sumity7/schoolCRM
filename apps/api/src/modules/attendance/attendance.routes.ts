import { z } from 'zod';
import { dayStringSchema, objectIdSchema, paginationQuerySchema } from '@edunex/shared';
import type { Registrar } from '../../core/http/route';
import { AttendanceService } from './attendance.service';

const status = z.enum(['present', 'absent', 'late', 'half_day', 'excused']);

export function registerAttendanceRoutes(r: Registrar) {
  r.define({
    method: 'get', path: '/attendance/sections/:sectionId', summary: 'Attendance sheet for a section and date', tenancy: 'school', auth: 'session', permission: 'attendance:read',
    params: z.object({ sectionId: objectIdSchema }).strict(), idParams: { sectionId: 'section' }, query: z.object({ date: dayStringSchema }).strict(),
    async handler({ params, query, scope }) {
      return { data: await AttendanceService.sheet(scope, params.sectionId, query.date) };
    },
  });

  r.define({
    method: 'put', path: '/attendance/sections/:sectionId', summary: 'Save attendance for a section and date (bulk, all-or-nothing)', tenancy: 'school', auth: 'session', permission: 'attendance:create',
    params: z.object({ sectionId: objectIdSchema }).strict(), idParams: { sectionId: 'section' },
    body: z.object({ date: dayStringSchema, entries: z.array(z.object({ studentId: objectIdSchema, status, remark: z.string().trim().max(200).optional() }).strict()).min(1).max(300) }).strict(),
    audit: { exempt: 'AttendanceService records attendance.sheet_saved / attendance.sheet_edited with per-student changes' },
    async handler({ params, body, scope }) {
      return { data: await AttendanceService.save(scope, params.sectionId, body.date, body.entries) };
    },
  });

  r.define({
    method: 'get', path: '/attendance/students/:studentId', summary: 'Attendance history and percentage for a student', tenancy: 'school', auth: 'session', permission: 'attendance:read',
    params: z.object({ studentId: objectIdSchema }).strict(), idParams: { studentId: 'student' }, query: z.object({ from: dayStringSchema, to: dayStringSchema }).strict(),
    async handler({ params, query, scope }) {
      return { data: await AttendanceService.studentHistory(scope, params.studentId, query.from, query.to) };
    },
  });

  r.define({
    method: 'post', path: '/attendance/corrections', summary: 'Request a correction to a past attendance mark', tenancy: 'school', auth: 'session', permission: 'attendance:update',
    body: z.object({ studentId: objectIdSchema, date: dayStringSchema, to: status, reason: z.string().trim().min(3).max(300) }).strict(),
    audit: { exempt: 'AttendanceService records attendance.correction_requested' },
    async handler({ body, scope }) {
      const c = await AttendanceService.requestCorrection(scope, body);
      return { status: 201, data: { id: String(c._id), status: c.status } };
    },
  });

  r.define({
    method: 'get', path: '/attendance/corrections', summary: 'List corrections (approvers see their sections)', tenancy: 'school', auth: 'session', permission: 'attendance:approve',
    query: paginationQuerySchema.extend({ status: z.enum(['pending', 'approved', 'rejected']).default('pending') }).strict(),
    async handler({ query, scope }) {
      const res = await AttendanceService.listCorrections(scope, query.status, query.page, query.limit);
      return { data: res.data.map((c) => ({ id: String(c._id), studentId: String(c.studentId), sectionId: String(c.sectionId), date: c.date, from: c.from, to: c.to, reason: c.reason, status: c.status, requestedBy: String(c.requestedBy) })), meta: res.meta };
    },
  });

  for (const decision of ['approved', 'rejected'] as const) {
    r.define({
      method: 'post', path: `/attendance/corrections/:id/${decision === 'approved' ? 'approve' : 'reject'}`, summary: `${decision === 'approved' ? 'Approve' : 'Reject'} a correction`, tenancy: 'school', auth: 'session', permission: 'attendance:approve',
      params: z.object({ id: objectIdSchema }).strict(), idParams: { id: 'correction' }, body: z.object({ note: z.string().trim().max(300).optional() }).strict(),
      audit: { exempt: 'AttendanceService records attendance.correction_approved / _rejected with before/after' },
      async handler({ params, body, scope }) {
        const c = await AttendanceService.decideCorrection(scope, params.id, decision, body.note);
        return { data: { id: String(c._id), status: c.status } };
      },
    });
  }

  r.define({
    method: 'get', path: '/attendance/reports/monthly', summary: 'Monthly attendance report for a section', tenancy: 'school', auth: 'session', permission: 'attendance:read',
    query: z.object({ sectionId: objectIdSchema, month: z.string().regex(/^\d{4}-\d{2}$/) }).strict(),
    async handler({ query, scope }) {
      return { data: await AttendanceService.monthlyReport(scope, query.sectionId, query.month) };
    },
  });

  r.define({
    method: 'get', path: '/attendance/reports/low-attendance', summary: 'Students below the low-attendance threshold', tenancy: 'school', auth: 'session', permission: 'attendance:read',
    query: z.object({ sectionId: objectIdSchema.optional() }).strict(),
    async handler({ query, scope }) {
      return { data: await AttendanceService.lowAttendance(scope, query.sectionId) };
    },
  });
}
