import { z } from 'zod';
import { addDays, dayStringSchema, objectIdSchema, summariseAttendance, todayInTz, type AttendanceStatusValue } from '@edunex/shared';
import type { Registrar } from '../../core/http/route';
import { forbidden, notFound, validationFailed } from '../../core/errors';
import { AuditService } from '../../core/audit/audit.service';
import { classRepo, sectionRepo, sessionRepo } from '../academics/academics.repository';
import { attendanceRepo } from '../attendance/attendance.repository';
import { enrollmentRepo, studentRepo } from '../students/students.repository';
import { getSchoolById } from '../schools/schools.service';
import { BillingService } from '../fees/billing.service';
import { paymentRepo } from '../fees/fees.repository';
import { renderReceipt } from '../fees/receipt.pdf';
import { assertChild, isGuardian, linkedChildren } from './parent-access';

const childParam = z.object({ id: objectIdSchema }).strict();

/**
 * Parent portal API (R3). Read-only. Every route re-checks the verified guardian link (parent-access.ts), so a child
 * that is not linked — another family's, or one whose link was just ended — is a plain 404.
 */
export function registerParentRoutes(r: Registrar) {
  const guard = () => { if (!isGuardian()) throw forbidden('This area is for parents and guardians'); };

  r.define({
    method: 'get', path: '/parent/children', summary: 'My linked children with class, attendance and dues', tenancy: 'school', auth: 'session', allowOwnScope: true, permission: 'students:read',
    async handler({ tenant }) {
      guard();
      const kids = await linkedChildren();
      const school = await getSchoolById(tenant.schoolId);
      const today = todayInTz(school.settings.timezone);
      const session = await sessionRepo.findActive();
      const out = [];
      for (const k of kids) {
        const s = await studentRepo.findById(k.studentId);
        if (!s) continue;
        const enr = session ? await enrollmentRepo.findOne({ studentId: s._id, sessionId: session._id }) : null;
        const [cls, sec] = enr ? await Promise.all([classRepo.findById(enr.classId), sectionRepo.findById(enr.sectionId)]) : [null, null];
        const recs = session ? await attendanceRepo.find({ studentId: s._id, sessionId: session._id, date: { $lte: today } }, { select: 'status date' }) : [];
        const sum = summariseAttendance(recs.map((x) => x.status as AttendanceStatusValue), school.settings.attendancePolicy);
        const todayRec = recs.find((x) => x.date === today);
        const fees = k.canViewFees ? (await BillingService.studentSummary(String(s._id))).totals : null;
        out.push({
          id: String(s._id), name: [s.firstName, s.lastName].filter(Boolean).join(' '), admissionNo: s.admissionNo, relationship: k.relationship,
          className: cls ? `${cls.name} ${sec?.name ?? ''}`.trim() : null, rollNo: enr?.rollNo ?? null,
          attendance: { percentage: sum.percentage, markedDays: sum.markedDays, today: todayRec?.status ?? null },
          fees: fees ? { balancePaise: fees.balancePaise, overduePaise: fees.overduePaise, advanceCreditPaise: fees.advanceCreditPaise } : null,
        });
      }
      return { data: out };
    },
  });

  r.define({
    method: 'get', path: '/parent/children/:id/attendance', summary: 'A linked child\'s attendance in a date range', tenancy: 'school', auth: 'session', allowOwnScope: true, permission: 'attendance:read',
    params: childParam, idParams: { id: 'student' }, query: z.object({ from: dayStringSchema, to: dayStringSchema }).strict(),
    async handler({ params, query, tenant }) {
      guard();
      await assertChild(params.id);
      if (query.from > query.to || addDays(query.from, 400) < query.to) throw validationFailed('Invalid date range');
      const school = await getSchoolById(tenant.schoolId);
      const recs = await attendanceRepo.find({ studentId: (await studentRepo.getById(params.id))._id, date: { $gte: query.from, $lte: query.to } }, { sort: { date: 1 }, select: 'date status remark' });
      return { data: { records: recs.map((x) => ({ date: x.date, status: x.status, remark: x.remark ?? null })), summary: summariseAttendance(recs.map((x) => x.status as AttendanceStatusValue), school.settings.attendancePolicy) } };
    },
  });

  r.define({
    method: 'get', path: '/parent/children/:id/fees', summary: 'A linked child\'s invoices and payments (if the school allows this guardian to see fees)', tenancy: 'school', auth: 'session', allowOwnScope: true, permission: 'invoices:read',
    params: childParam, idParams: { id: 'student' },
    async handler({ params }) {
      guard();
      const link = await assertChild(params.id);
      if (!link.canViewFees) throw forbidden('The school has not enabled fee details for your account');
      const s = await BillingService.studentSummary(params.id);
      return {
        data: {
          totals: s.totals,
          invoices: s.invoices.filter((i) => i.status !== 'void').map((i) => ({ id: i.id, invoiceNo: i.invoiceNo, installmentLabel: i.installmentLabel, dueDate: i.dueDate, totalPaise: i.totalPaise, paidPaise: i.paidPaise, balancePaise: i.balancePaise, status: i.status, lines: i.lines.map((l) => ({ description: l.description, amountPaise: l.amountPaise })), concessionLines: i.concessionLines })),
          payments: s.payments.map((p) => ({ id: p.id, receiptNo: p.receiptNo, paidOn: p.paidOn, amountPaise: p.amountPaise, mode: p.mode, status: p.status })),
        },
      };
    },
  });

  r.define({
    method: 'get', path: '/parent/children/:id/payments/:paymentId/receipt.pdf', summary: 'Receipt PDF for a linked child\'s payment', tenancy: 'school', auth: 'session', allowOwnScope: true, permission: 'payments:print',
    rateClass: 'export', params: z.object({ id: objectIdSchema, paymentId: objectIdSchema }).strict(), idParams: { id: 'student', paymentId: 'payment' },
    async handler({ params, res, tenant }) {
      guard();
      const link = await assertChild(params.id);
      if (!link.canViewFees) throw forbidden('The school has not enabled fee details for your account');
      const p = await paymentRepo.findById(params.paymentId);
      if (!p || !p.studentId.equals(link.studentId)) throw notFound('Payment');
      const school = await getSchoolById(tenant.schoolId);
      const s = await studentRepo.getById(p.studentId);
      const a = school.address ?? {};
      const pdf = await renderReceipt({
        school: { name: school.name, address: [a.line1, a.city, a.state, a.postalCode].filter(Boolean).join(', ') || undefined, phone: school.phone },
        receiptNo: p.receiptNo, paidOn: p.paidOn, student: { name: [s.firstName, s.lastName].filter(Boolean).join(' '), admissionNo: s.admissionNo },
        lines: p.receiptLines, amountPaise: p.amountPaise, mode: p.mode, reference: p.reference, receivedByName: p.receivedByName, status: p.status,
      });
      await AuditService.record({ action: 'parents.receipt_downloaded', entityType: 'payment', entityId: p._id });
      res.status(200).setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `inline; filename="receipt-${p.receiptNo.replace(/[^A-Za-z0-9-]/g, '_')}.pdf"`);
      res.send(pdf);
    },
  });
}
