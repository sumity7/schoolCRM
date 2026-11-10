import { z } from 'zod';
import { CONCESSION_KINDS, FEE_CATEGORY_KINDS, PAYMENT_MODES, dayStringSchema, objectIdSchema, paginationQuerySchema, todayInTz, type PermissionKey } from '@edunex/shared';
import type { Registrar } from '../../core/http/route';
import { sendCsv } from '../../core/csv/csv';
import { AuditService } from '../../core/audit/audit.service';
import { runIdempotent } from '../../core/idempotency/idempotency.service';
import { toObjectId } from '../../core/tenancy/repository';
import { enrollmentRepo, studentRepo } from '../students/students.repository';
import { classRepo, sectionRepo } from '../academics/academics.repository';
import { getSchoolById, updateSchoolProfile } from '../schools/schools.service';
import { FeeConfigService, getFeePolicy } from './fees-config.service';
import { BillingService, toInvoiceDto, toPaymentDto } from './billing.service';
import { FeeReports } from './fees-reports.service';
import { renderReceipt } from './receipt.pdf';
import { allocationRepo, concessionRepo, dayClosingRepo, feeCategoryRepo, feeStructureRepo, financeRequestRepo, invoiceRepo, ledgerRepo, paymentRepo } from './fees.repository';

const FIN: PermissionKey[] = ['financial:view'];
const idParam = z.object({ id: objectIdSchema }).strict();
const paise = z.number().int().safe();
const money = paise.positive();
const installments = z.array(z.object({ label: z.string().trim().min(1).max(40), dueDate: dayStringSchema, amountPaise: paise.min(0) }).strict()).min(1).max(12);
const items = z.array(z.object({ categoryId: objectIdSchema, installments }).strict()).min(1).max(30);

const structureDto = (s: Awaited<ReturnType<typeof feeStructureRepo.getById>>) => ({
  id: String(s._id), sessionId: String(s.sessionId), classId: String(s.classId), name: s.name, version: s.version, status: s.status, publishedAt: s.publishedAt,
  items: s.items.map((i) => ({ categoryId: String(i.categoryId), amountPaise: i.amountPaise, installments: i.installments })),
  totalPaise: s.items.reduce((a, i) => a + i.amountPaise, 0),
  installmentLabels: [...new Set(s.items.flatMap((i) => i.installments.map((x) => x.label)))],
});
const concessionDto = (c: Awaited<ReturnType<typeof concessionRepo.getById>>) => ({
  id: String(c._id), studentId: String(c.studentId), kind: c.kind, valueType: c.valueType, value: c.value, categoryId: c.categoryId ? String(c.categoryId) : null,
  reason: c.reason, status: c.status, requestedBy: String(c.requestedBy), decidedBy: c.decidedBy ? String(c.decidedBy) : null, createdAt: c.createdAt,
});
const requestDto = (r: Awaited<ReturnType<typeof financeRequestRepo.getById>>) => ({
  id: String(r._id), kind: r.kind, studentId: String(r.studentId), paymentId: r.paymentId ? String(r.paymentId) : null, amountPaise: r.amountPaise, reason: r.reason,
  status: r.status, requestedBy: String(r.requestedBy), decidedBy: r.decidedBy ? String(r.decidedBy) : null, decisionNote: r.decisionNote ?? null, paidOn: r.paidOn ?? null, createdAt: r.createdAt,
});

async function studentNames(ids: unknown[]) {
  const ss = await studentRepo.findByIds(ids, { select: 'firstName lastName admissionNo' });
  return new Map(ss.map((s) => [String(s._id), { name: [s.firstName, s.lastName].filter(Boolean).join(' '), admissionNo: s.admissionNo }]));
}

export function registerFeeRoutes(r: Registrar) {
  // ---------------------------------------------------------------- policy
  r.define({
    method: 'get', path: '/fees/policy', summary: 'Fee policy (receipt prefix, concession limits, advance)', tenancy: 'school', auth: 'session', permission: 'fees.config:read', alsoRequire: FIN,
    async handler() { return { data: await getFeePolicy() }; },
  });
  r.define({
    method: 'patch', path: '/fees/policy', summary: 'Change the fee policy', tenancy: 'school', auth: 'session', permission: 'fees.config:approve', alsoRequire: FIN,
    body: z.object({
      receiptPrefix: z.string().trim().regex(/^[A-Z0-9-]{1,10}$/, 'Use 1–10 capital letters, digits or -').optional(),
      invoicePrefix: z.string().trim().regex(/^[A-Z0-9-]{1,10}$/).optional(),
      concessionAutoApprove: z.object({ maxPercentBps: z.number().int().min(0).max(10_000), maxFlatPaise: paise.min(0) }).strict().optional(),
      allowAdvance: z.boolean().optional(),
    }).strict(),
    audit: true,
    async handler({ body, tenant }) {
      const before = await getFeePolicy();
      const next = { ...before, ...body };
      await updateSchoolProfile(tenant.schoolId, { 'settings.feePolicy': next });
      return { data: next, audit: { action: 'fees.policy_updated', entityType: 'school', entityId: tenant.schoolId, before, after: body } };
    },
  });

  // ---------------------------------------------------------------- categories
  r.define({
    method: 'get', path: '/fees/categories', summary: 'Fee heads', tenancy: 'school', auth: 'session', permission: 'fees.config:read', alsoRequire: FIN,
    async handler() {
      return { data: (await feeCategoryRepo.find({}, { sort: { name: 1 } })).map((c) => ({ id: String(c._id), key: c.key, name: c.name, kind: c.kind, isRefundable: c.isRefundable, active: c.active, version: c.__v })) };
    },
  });
  r.define({
    method: 'post', path: '/fees/categories', summary: 'Create a fee head', tenancy: 'school', auth: 'session', permission: 'fees.config:create', alsoRequire: FIN,
    body: z.object({ key: z.string().trim().regex(/^[a-z0-9_-]{2,40}$/i, 'Use 2–40 letters, digits, - or _'), name: z.string().trim().min(1).max(80), kind: z.enum(FEE_CATEGORY_KINDS), isRefundable: z.boolean().optional() }).strict(),
    audit: { exempt: 'FeeConfigService records fees.category_created' },
    async handler({ body }) {
      const c = await FeeConfigService.createCategory(body);
      return { status: 201, data: { id: String(c._id), key: c.key, name: c.name } };
    },
  });
  r.define({
    method: 'patch', path: '/fees/categories/:id', summary: 'Rename / (de)activate a fee head', tenancy: 'school', auth: 'session', permission: 'fees.config:update', alsoRequire: FIN,
    params: idParam, idParams: { id: 'fee_category' },
    body: z.object({ name: z.string().trim().min(1).max(80).optional(), isRefundable: z.boolean().optional(), active: z.boolean().optional() }).strict(),
    audit: { exempt: 'FeeConfigService records fees.category_updated' },
    async handler({ params, body }) {
      const c = await FeeConfigService.updateCategory(params.id, body);
      return { data: { id: String(c._id), name: c.name, active: c.active } };
    },
  });

  // ---------------------------------------------------------------- structures
  r.define({
    method: 'get', path: '/fees/structures', summary: 'Fee structures (all versions)', tenancy: 'school', auth: 'session', permission: 'fees.config:read', alsoRequire: FIN,
    query: z.object({ sessionId: objectIdSchema.optional(), classId: objectIdSchema.optional(), status: z.enum(['draft', 'published', 'superseded']).optional() }).strict(),
    async handler({ query }) {
      const f: Record<string, unknown> = {};
      if (query.sessionId) f.sessionId = toObjectId(query.sessionId);
      if (query.classId) f.classId = toObjectId(query.classId);
      if (query.status) f.status = query.status;
      return { data: (await feeStructureRepo.find(f, { sort: { familyKey: 1, version: -1 } })).map(structureDto) };
    },
  });
  r.define({
    method: 'post', path: '/fees/structures', summary: 'Create a fee structure (draft)', tenancy: 'school', auth: 'session', permission: 'fees.config:create', alsoRequire: FIN,
    body: z.object({ sessionId: objectIdSchema, classId: objectIdSchema, name: z.string().trim().min(1).max(80), items }).strict(),
    audit: { exempt: 'FeeConfigService records fees.structure_created' },
    async handler({ body }) { return { status: 201, data: structureDto(await FeeConfigService.createStructure(body)) }; },
  });
  r.define({
    method: 'get', path: '/fees/structures/:id', summary: 'One fee structure', tenancy: 'school', auth: 'session', permission: 'fees.config:read', alsoRequire: FIN,
    params: idParam, idParams: { id: 'fee_structure' },
    async handler({ params }) { return { data: structureDto(await feeStructureRepo.getById(params.id, 'Fee structure')) }; },
  });
  r.define({
    method: 'patch', path: '/fees/structures/:id', summary: 'Edit a draft structure', tenancy: 'school', auth: 'session', permission: 'fees.config:update', alsoRequire: FIN,
    params: idParam, idParams: { id: 'fee_structure' },
    body: z.object({ name: z.string().trim().min(1).max(80).optional(), items: items.optional() }).strict(),
    audit: { exempt: 'FeeConfigService records fees.structure_updated' },
    async handler({ params, body }) { return { data: structureDto(await FeeConfigService.updateDraft(params.id, body)) }; },
  });
  r.define({
    method: 'delete', path: '/fees/structures/:id', summary: 'Delete a draft structure', tenancy: 'school', auth: 'session', permission: 'fees.config:update', alsoRequire: FIN,
    params: idParam, idParams: { id: 'fee_structure' },
    audit: { exempt: 'FeeConfigService records fees.structure_draft_deleted' },
    async handler({ params }) { await FeeConfigService.deleteDraft(params.id); return { status: 204 }; },
  });
  r.define({
    method: 'post', path: '/fees/structures/:id/publish', summary: 'Publish (immutable afterwards)', tenancy: 'school', auth: 'session', permission: 'fees.config:approve', alsoRequire: FIN,
    params: idParam, idParams: { id: 'fee_structure' }, body: z.object({}).strict(),
    audit: { exempt: 'FeeConfigService records fees.structure_published' },
    async handler({ params }) { return { data: structureDto(await FeeConfigService.publish(params.id)) }; },
  });
  r.define({
    method: 'post', path: '/fees/structures/:id/revise', summary: 'Start a new draft version of a published structure', tenancy: 'school', auth: 'session', permission: 'fees.config:create', alsoRequire: FIN,
    params: idParam, idParams: { id: 'fee_structure' }, body: z.object({}).strict(),
    audit: { exempt: 'FeeConfigService records fees.structure_revised' },
    async handler({ params }) { return { status: 201, data: structureDto(await FeeConfigService.revise(params.id)) }; },
  });

  // ---------------------------------------------------------------- concessions
  r.define({
    method: 'get', path: '/fees/concessions', summary: 'Concessions', tenancy: 'school', auth: 'session', permission: 'discounts:apply', alsoRequire: FIN,
    query: z.object({ status: z.enum(['pending_approval', 'approved', 'rejected', 'revoked']).optional(), studentId: objectIdSchema.optional() }).strict(),
    async handler({ query }) {
      const f: Record<string, unknown> = {};
      if (query.status) f.status = query.status;
      if (query.studentId) f.studentId = toObjectId(query.studentId);
      const rows = await concessionRepo.find(f, { sort: { createdAt: -1 }, limit: 500 });
      const names = await studentNames(rows.map((c) => c.studentId));
      return { data: rows.map((c) => ({ ...concessionDto(c), student: names.get(String(c.studentId)) ?? null })) };
    },
  });
  r.define({
    method: 'post', path: '/fees/concessions', summary: 'Grant / request a concession (above the limit → needs approval)', tenancy: 'school', auth: 'session', permission: 'discounts:apply', alsoRequire: FIN,
    body: z.object({ studentId: objectIdSchema, kind: z.enum(CONCESSION_KINDS), valueType: z.enum(['percent', 'flat']), value: z.number().int().positive(), categoryId: objectIdSchema.nullable().optional(), reason: z.string().trim().min(3).max(300) }).strict(),
    audit: { exempt: 'FeeConfigService records fees.concession_granted / _requested' },
    async handler({ body, scope, tenant }) {
      const c = await FeeConfigService.requestConcession(scope, tenant.grants.has('discounts:approve'), body);
      return { status: 201, data: concessionDto(c) };
    },
  });
  for (const action of ['approve', 'reject'] as const) {
    r.define({
      method: 'post', path: `/fees/concessions/:id/${action}`, summary: `${action === 'approve' ? 'Approve' : 'Reject'} a pending concession (not your own)`, tenancy: 'school', auth: 'session', permission: 'discounts:approve', alsoRequire: FIN,
      params: idParam, idParams: { id: 'concession' }, body: z.object({ note: z.string().trim().max(300).optional() }).strict(),
      audit: { exempt: 'FeeConfigService records the decision' },
      async handler({ params, body }) { return { data: concessionDto(await FeeConfigService.decideConcession(params.id, action === 'approve', body.note)) }; },
    });
  }
  r.define({
    method: 'post', path: '/fees/concessions/:id/revoke', summary: 'Revoke an approved concession (future invoices only)', tenancy: 'school', auth: 'session', permission: 'discounts:approve', alsoRequire: FIN,
    params: idParam, idParams: { id: 'concession' }, body: z.object({ reason: z.string().trim().min(3).max(300) }).strict(),
    audit: { exempt: 'FeeConfigService records fees.concession_revoked' },
    async handler({ params, body }) { return { data: concessionDto(await FeeConfigService.revokeConcession(params.id, body.reason)) }; },
  });

  // ---------------------------------------------------------------- invoices
  r.define({
    method: 'post', path: '/fees/invoices/generate', summary: 'Bill an instalment to a class/section (Idempotency-Key; re-runs never double-bill)', tenancy: 'school', auth: 'session', permission: 'invoices:create', alsoRequire: FIN,
    rateClass: 'sensitive',
    body: z.object({ structureId: objectIdSchema, installmentLabel: z.string().trim().min(1).max(40), sectionId: objectIdSchema.optional(), studentIds: z.array(objectIdSchema).max(500).optional() }).strict(),
    audit: { exempt: 'BillingService records fees.invoices_generated' },
    async handler({ body, req }) {
      await feeStructureRepo.getById(body.structureId, 'Fee structure');
      const out = await runIdempotent(req.get('Idempotency-Key'), 'fees.generate', body, async () => ({ status: 200, body: await BillingService.generate(body) }));
      return { status: out.status, data: out.body };
    },
  });
  r.define({
    method: 'get', path: '/fees/invoices', summary: 'Invoices (filters: status, class, section, student, overdue)', tenancy: 'school', auth: 'session', permission: 'invoices:read', alsoRequire: FIN,
    query: paginationQuerySchema.extend({
      status: z.enum(['open', 'partially_paid', 'paid', 'void']).optional(), classId: objectIdSchema.optional(), sectionId: objectIdSchema.optional(),
      studentId: objectIdSchema.optional(), overdue: z.enum(['true']).optional(),
    }).strict(),
    async handler({ query, tenant }) {
      const f: Record<string, unknown> = {};
      if (query.status) f.status = query.status;
      for (const k of ['classId', 'sectionId', 'studentId'] as const) if (query[k]) f[k] = toObjectId(query[k]);
      if (query.overdue) {
        f.dueDate = { $lt: todayInTz((await getSchoolById(tenant.schoolId)).settings.timezone) };
        f.status = { $in: ['open', 'partially_paid'] };
      }
      const res = await invoiceRepo.paginate(f, query.page, query.limit, { dueDate: 1, invoiceNo: 1 });
      const names = await studentNames(res.data.map((i) => i.studentId));
      return { data: res.data.map((i) => ({ ...toInvoiceDto(i), student: names.get(String(i.studentId)) ?? null })), meta: res.meta };
    },
  });
  r.define({
    method: 'get', path: '/fees/invoices/:id', summary: 'Invoice with allocations and ledger', tenancy: 'school', auth: 'session', permission: 'invoices:read', alsoRequire: FIN,
    params: idParam, idParams: { id: 'invoice' },
    async handler({ params }) {
      const i = await invoiceRepo.getById(params.id, 'Invoice');
      const [allocs, rows] = await Promise.all([allocationRepo.find({ invoiceId: i._id }), ledgerRepo.find({ invoiceId: i._id }, { sort: { createdAt: 1 } })]);
      const pays = new Map((await paymentRepo.findByIds(allocs.map((a) => a.paymentId))).map((p) => [String(p._id), p]));
      return {
        data: {
          ...toInvoiceDto(i), student: (await studentNames([i.studentId])).get(String(i.studentId)) ?? null,
          allocations: allocs.map((a) => ({ paymentId: String(a.paymentId), receiptNo: pays.get(String(a.paymentId))?.receiptNo, amountPaise: a.amountPaise, active: a.active })),
          ledger: rows.map((l) => ({ type: l.type, amountPaise: l.amountPaise, occurredOn: l.occurredOn, memo: l.memo ?? null })),
        },
      };
    },
  });
  r.define({
    method: 'post', path: '/fees/invoices/:id/void', summary: 'Void an unpaid invoice (owner)', tenancy: 'school', auth: 'session', permission: 'fees.config:approve', alsoRequire: FIN,
    params: idParam, idParams: { id: 'invoice' }, body: z.object({ reason: z.string().trim().min(3).max(300) }).strict(),
    audit: { exempt: 'BillingService records fees.invoice_voided' },
    async handler({ params, body }) { return { data: toInvoiceDto(await BillingService.voidInvoice(params.id, body.reason)) }; },
  });
  r.define({
    method: 'post', path: '/fees/invoices/:id/late-fee', summary: 'Apply a late fee (manual, with reason — D-08)', tenancy: 'school', auth: 'session', permission: 'invoices:create', alsoRequire: FIN,
    params: idParam, idParams: { id: 'invoice' }, body: z.object({ amountPaise: money.max(10_000_000), reason: z.string().trim().min(3).max(300) }).strict(),
    audit: { exempt: 'BillingService records fees.late_fee_applied' },
    async handler({ params, body }) { return { data: toInvoiceDto(await BillingService.adjust(params.id, { ...body, type: 'late_fee' })) }; },
  });
  r.define({
    method: 'post', path: '/fees/invoices/:id/adjust', summary: 'Signed correction to an invoice (owner, reason required)', tenancy: 'school', auth: 'session', permission: 'fees.config:approve', alsoRequire: FIN,
    params: idParam, idParams: { id: 'invoice' }, body: z.object({ amountPaise: paise.refine((v) => v !== 0, 'Cannot be zero'), reason: z.string().trim().min(3).max(300) }).strict(),
    audit: { exempt: 'BillingService records fees.invoice_adjusted' },
    async handler({ params, body }) { return { data: toInvoiceDto(await BillingService.adjust(params.id, { ...body, type: 'adjustment' })) }; },
  });
  r.define({
    method: 'get', path: '/fees/students/:id/summary', summary: 'A student\'s dues, payments and advance credit', tenancy: 'school', auth: 'session', permission: 'invoices:read', alsoRequire: FIN,
    params: idParam, idParams: { id: 'student' },
    async handler({ params }) {
      const s = await BillingService.studentSummary(params.id);
      const student = await studentRepo.getById(params.id);
      const enr = student.currentEnrollmentId ? await enrollmentRepo.findById(student.currentEnrollmentId) : null;
      const [cls, sec] = enr ? await Promise.all([classRepo.findById(enr.classId), sectionRepo.findById(enr.sectionId)]) : [null, null];
      return { data: { ...s, className: cls ? `${cls.name} ${sec?.name ?? ''}`.trim() : null } };
    },
  });

  // ---------------------------------------------------------------- payments
  r.define({
    method: 'post', path: '/fees/payments', summary: 'Record a payment (Idempotency-Key; oldest dues first unless allocations given)', tenancy: 'school', auth: 'session', permission: 'payments:create', alsoRequire: FIN,
    rateClass: 'sensitive',
    body: z.object({
      studentId: objectIdSchema, amountPaise: money.max(100_000_000), mode: z.enum(PAYMENT_MODES), paidOn: dayStringSchema, reference: z.string().trim().max(80).optional(),
      note: z.string().trim().max(300).optional(), keepAdvance: z.boolean().optional(),
      allocations: z.array(z.object({ invoiceId: objectIdSchema, amountPaise: money }).strict()).max(30).optional(),
    }).strict(),
    audit: { exempt: 'BillingService records fees.payment_recorded' },
    async handler({ body, req, auth }) {
      await studentRepo.getById(body.studentId, 'Student'); // 404 for other schools' students before anything else
      const out = await runIdempotent(req.get('Idempotency-Key'), 'fees.payment', body, async () => {
        const r2 = await BillingService.recordPayment({ ...body, cashierName: auth.user.name });
        return { status: 201, body: { payment: toPaymentDto(r2.payment), allocations: r2.allocations } };
      });
      return { status: out.status, data: out.body };
    },
  });
  r.define({
    method: 'get', path: '/fees/payments', summary: 'Payments (date range / student)', tenancy: 'school', auth: 'session', permission: 'payments:read', alsoRequire: FIN,
    query: paginationQuerySchema.extend({ from: dayStringSchema.optional(), to: dayStringSchema.optional(), studentId: objectIdSchema.optional(), status: z.enum(['recorded', 'reversed']).optional() }).strict(),
    async handler({ query }) {
      const f: Record<string, unknown> = {};
      if (query.from || query.to) f.paidOn = { ...(query.from ? { $gte: query.from } : {}), ...(query.to ? { $lte: query.to } : {}) };
      if (query.studentId) f.studentId = toObjectId(query.studentId);
      if (query.status) f.status = query.status;
      const res = await paymentRepo.paginate(f, query.page, query.limit, { paidOn: -1, receiptNo: -1 });
      const names = await studentNames(res.data.map((p) => p.studentId));
      return { data: res.data.map((p) => ({ ...toPaymentDto(p), student: names.get(String(p.studentId)) ?? null })), meta: res.meta };
    },
  });
  r.define({
    method: 'get', path: '/fees/payments/:id', summary: 'One payment', tenancy: 'school', auth: 'session', permission: 'payments:read', alsoRequire: FIN,
    params: idParam, idParams: { id: 'payment' },
    async handler({ params }) {
      const p = await paymentRepo.getById(params.id, 'Payment');
      return { data: { ...toPaymentDto(p), student: (await studentNames([p.studentId])).get(String(p.studentId)) ?? null } };
    },
  });
  r.define({
    method: 'get', path: '/fees/payments/:id/receipt.pdf', summary: 'Receipt PDF (reprint; cancelled receipts are marked)', tenancy: 'school', auth: 'session', permission: 'payments:print', alsoRequire: FIN,
    rateClass: 'export', params: idParam, idParams: { id: 'payment' },
    async handler({ params, res, tenant }) {
      const p = await paymentRepo.getById(params.id, 'Payment');
      const school = await getSchoolById(tenant.schoolId);
      const s = await studentRepo.getById(p.studentId);
      const enr = s.currentEnrollmentId ? await enrollmentRepo.findById(s.currentEnrollmentId) : null;
      const [cls, sec] = enr ? await Promise.all([classRepo.findById(enr.classId), sectionRepo.findById(enr.sectionId)]) : [null, null];
      const a = school.address ?? {};
      const pdf = await renderReceipt({
        school: { name: school.name, address: [a.line1, a.city, a.state, a.postalCode].filter(Boolean).join(', ') || undefined, phone: school.phone },
        receiptNo: p.receiptNo, paidOn: p.paidOn, student: { name: [s.firstName, s.lastName].filter(Boolean).join(' '), admissionNo: s.admissionNo, className: cls ? `${cls.name} ${sec?.name ?? ''}`.trim() : undefined },
        lines: p.receiptLines, amountPaise: p.amountPaise, mode: p.mode, reference: p.reference, receivedByName: p.receivedByName, status: p.status,
      });
      await AuditService.record({ action: 'fees.receipt_printed', entityType: 'payment', entityId: p._id, meta: { receiptNo: p.receiptNo } });
      res.status(200).setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `inline; filename="receipt-${p.receiptNo.replace(/[^A-Za-z0-9-]/g, '_')}.pdf"`);
      res.send(pdf);
    },
  });
  r.define({
    method: 'post', path: '/fees/payments/:id/reversal-requests', summary: 'Ask for a payment to be reversed (bounced cheque, wrong entry)', tenancy: 'school', auth: 'session', permission: 'refunds:request', alsoRequire: FIN,
    params: idParam, idParams: { id: 'payment' }, body: z.object({ reason: z.string().trim().min(3).max(300) }).strict(),
    audit: { exempt: 'BillingService records fees.reversal_requested' },
    async handler({ params, body }) { return { status: 201, data: requestDto(await BillingService.requestReversal(params.id, body.reason)) }; },
  });

  // ---------------------------------------------------------------- refunds & approvals
  r.define({
    method: 'post', path: '/fees/refunds', summary: 'Ask to refund advance credit to a student', tenancy: 'school', auth: 'session', permission: 'refunds:request', alsoRequire: FIN,
    body: z.object({ studentId: objectIdSchema, amountPaise: money, reason: z.string().trim().min(3).max(300) }).strict(),
    audit: { exempt: 'BillingService records fees.refund_requested' },
    async handler({ body }) { return { status: 201, data: requestDto(await BillingService.requestRefund(body.studentId, body.amountPaise, body.reason)) }; },
  });
  r.define({
    method: 'get', path: '/fees/requests', summary: 'Reversal and refund requests', tenancy: 'school', auth: 'session', permission: 'refunds:request', alsoRequire: FIN,
    query: z.object({ status: z.enum(['requested', 'approved', 'rejected', 'paid']).optional() }).strict(),
    async handler({ query }) {
      const rows = await financeRequestRepo.find(query.status ? { status: query.status } : {}, { sort: { createdAt: -1 }, limit: 300 });
      const names = await studentNames(rows.map((x) => x.studentId));
      const pays = new Map((await paymentRepo.findByIds(rows.map((x) => x.paymentId).filter(Boolean))).map((p) => [String(p._id), p.receiptNo]));
      return { data: rows.map((x) => ({ ...requestDto(x), student: names.get(String(x.studentId)) ?? null, receiptNo: x.paymentId ? pays.get(String(x.paymentId)) ?? null : null })) };
    },
  });
  for (const action of ['approve', 'reject'] as const) {
    r.define({
      method: 'post', path: `/fees/requests/:id/${action}`, summary: `${action === 'approve' ? 'Approve' : 'Reject'} a reversal/refund (not your own request)`, tenancy: 'school', auth: 'session', permission: 'refunds:approve', alsoRequire: FIN,
      rateClass: 'sensitive', params: idParam, idParams: { id: 'finance_request' }, body: z.object({ note: z.string().trim().max(300).optional() }).strict(),
      audit: { exempt: 'BillingService records the decision and its money effect' },
      async handler({ params, body }) { return { data: requestDto(await BillingService.decide(params.id, action === 'approve', body.note)) }; },
    });
  }
  r.define({
    method: 'post', path: '/fees/requests/:id/mark-paid', summary: 'Record that an approved refund was paid out', tenancy: 'school', auth: 'session', permission: 'payments:create', alsoRequire: FIN,
    params: idParam, idParams: { id: 'finance_request' },
    body: z.object({ paidOn: dayStringSchema, mode: z.enum(PAYMENT_MODES), reference: z.string().trim().max(80).optional() }).strict(),
    audit: { exempt: 'BillingService records fees.refund_paid' },
    async handler({ params, body }) { return { data: requestDto(await BillingService.markRefundPaid(params.id, body)) }; },
  });

  // ---------------------------------------------------------------- day close
  r.define({
    method: 'get', path: '/fees/day-closings', summary: 'Closed days', tenancy: 'school', auth: 'session', permission: 'payments:read', alsoRequire: FIN,
    async handler() {
      return { data: (await dayClosingRepo.find({}, { sort: { date: -1 }, limit: 120 })).map((c) => ({ id: String(c._id), date: c.date, cashTotalPaise: c.cashTotalPaise, nonCashTotalPaise: c.nonCashTotalPaise, countedCashPaise: c.countedCashPaise ?? null, note: c.note ?? null, reopened: Boolean(c.reopenedAt) })) };
    },
  });
  r.define({
    method: 'post', path: '/fees/day-closings', summary: 'Close a day (no more payments dated that day)', tenancy: 'school', auth: 'session', permission: 'payments:create', alsoRequire: FIN,
    body: z.object({ date: dayStringSchema, countedCashPaise: paise.min(0).optional(), note: z.string().trim().max(300).optional() }).strict(),
    audit: { exempt: 'BillingService records fees.day_closed' },
    async handler({ body }) {
      const c = await BillingService.closeDay(body);
      return { status: 201, data: { id: String(c._id), date: c.date, cashTotalPaise: c.cashTotalPaise, nonCashTotalPaise: c.nonCashTotalPaise, countedCashPaise: c.countedCashPaise ?? null } };
    },
  });
  r.define({
    method: 'post', path: '/fees/day-closings/reopen', summary: 'Re-open a closed day (owner, reason required)', tenancy: 'school', auth: 'session', permission: 'fees.config:approve', alsoRequire: FIN,
    body: z.object({ date: dayStringSchema, reason: z.string().trim().min(3).max(300) }).strict(),
    audit: { exempt: 'BillingService records fees.day_reopened' },
    async handler({ body }) { await BillingService.reopenDay(body.date, body.reason); return { data: { date: body.date, reopened: true } }; },
  });

  // ---------------------------------------------------------------- reports
  r.define({
    method: 'get', path: '/fees/reports/collection', summary: 'Collection register / day-book', tenancy: 'school', auth: 'session', permission: 'reports:read', alsoRequire: FIN,
    query: z.object({ from: dayStringSchema, to: dayStringSchema }).strict(),
    async handler({ query }) { return { data: await FeeReports.collection(query.from, query.to) }; },
  });
  r.define({
    method: 'get', path: '/fees/reports/outstanding', summary: 'Outstanding dues by student', tenancy: 'school', auth: 'session', permission: 'reports:read', alsoRequire: FIN,
    query: z.object({ classId: objectIdSchema.optional(), sectionId: objectIdSchema.optional() }).strict(),
    async handler({ query }) { return { data: await FeeReports.outstanding(query) }; },
  });
  r.define({
    method: 'get', path: '/fees/reports/collection.csv', summary: 'Collection register (CSV)', tenancy: 'school', auth: 'session', permission: 'reports:export', alsoRequire: FIN,
    rateClass: 'export', query: z.object({ from: dayStringSchema, to: dayStringSchema }).strict(),
    async handler({ query, res }) {
      const rep = await FeeReports.collection(query.from, query.to);
      await AuditService.record({ action: 'fees.report_exported', meta: { report: 'collection', ...query, rows: rep.rows.length } });
      sendCsv(res, `collection-${query.from}-to-${query.to}.csv`, ['Date', 'Receipt No', 'Student', 'Admission No', 'Amount (Rs)', 'Mode', 'Reference', 'Received By', 'Status'],
        rep.rows.map((x) => [x.paidOn, x.receiptNo, x.student, x.admissionNo, (x.amountPaise / 100).toFixed(2), x.mode, x.reference, x.receivedByName, x.status]));
    },
  });
  r.define({
    method: 'get', path: '/fees/reports/outstanding.csv', summary: 'Outstanding dues (CSV)', tenancy: 'school', auth: 'session', permission: 'reports:export', alsoRequire: FIN,
    rateClass: 'export', query: z.object({ classId: objectIdSchema.optional(), sectionId: objectIdSchema.optional() }).strict(),
    async handler({ query, res }) {
      const rep = await FeeReports.outstanding(query);
      await AuditService.record({ action: 'fees.report_exported', meta: { report: 'outstanding', rows: rep.rows.length } });
      sendCsv(res, `outstanding-${rep.asOf}.csv`, ['Student', 'Admission No', 'Class', 'Balance (Rs)', 'Overdue (Rs)', 'Oldest Due', 'Invoices'],
        rep.rows.map((x) => [x.name, x.admissionNo, x.className, (x.balancePaise / 100).toFixed(2), (x.overduePaise / 100).toFixed(2), x.oldestDue, x.invoices]));
    },
  });
}
