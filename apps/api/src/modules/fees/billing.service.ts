import { Types } from 'mongoose';
import { allocateOldestFirst, financialYear, formatINR, isValidDay, percentOf, todayInTz, type PaymentMode } from '@edunex/shared';
import { AppError, conflict, forbidden, notFound, validationFailed } from '../../core/errors';
import { AuditService } from '../../core/audit/audit.service';
import { withTransaction } from '../../core/db/connection';
import { requireTenant } from '../../core/tenancy/context';
import { SequenceService, formatSequence } from '../../core/sequences/sequence.service';
import { toObjectId } from '../../core/tenancy/repository';
import { enrollmentRepo, studentRepo } from '../students/students.repository';
import { getSchoolById } from '../schools/schools.service';
import { getFeePolicy } from './fees-config.service';
import {
  allocationRepo, concessionRepo, dayClosingRepo, feeCategoryRepo, feeStructureRepo, financeRequestRepo, invoiceRepo, ledgerRepo, paymentRepo,
} from './fees.repository';
import type { ILedgerEntry, LedgerType } from './fees.model';

type Id = Types.ObjectId;
const CHARGE_TYPES: LedgerType[] = ['charge', 'concession', 'late_fee', 'adjustment'];
const PAID_TYPES: LedgerType[] = ['payment', 'reversal'];

async function today(): Promise<string> {
  const t = requireTenant('fees.today');
  const s = await getSchoolById(t.schoolId);
  return todayInTz(s.settings.timezone);
}

async function ledger(rows: Array<Omit<ILedgerEntry, 'reversesEntryId'> & { reversesEntryId?: Id | null }>) {
  if (rows.length) await ledgerRepo.createMany(rows.filter((r) => r.amountPaise !== 0) as never);
}

/**
 * Re-derives an invoice's cached totals FROM ITS LEDGER ROWS (never from the cached values themselves).
 * Invariant (tested): balancePaise === Σ ledger(invoice); paidPaise === −Σ ledger(payment|reversal).
 */
export async function recalcInvoice(invoiceId: Id) {
  const rows = await ledgerRepo.find({ invoiceId }, { select: 'type amountPaise' });
  const total = rows.filter((r) => CHARGE_TYPES.includes(r.type)).reduce((a, r) => a + r.amountPaise, 0);
  const paid = -rows.filter((r) => PAID_TYPES.includes(r.type)).reduce((a, r) => a + r.amountPaise, 0);
  const balance = total - paid;
  const inv = await invoiceRepo.getById(invoiceId, 'Invoice');
  const status = inv.status === 'void' ? 'void' : balance <= 0 && total > 0 ? 'paid' : paid > 0 ? 'partially_paid' : 'open';
  return invoiceRepo.updateById(invoiceId, { totalPaise: total, paidPaise: paid, balancePaise: balance, status });
}

async function assertDayOpen(day: string) {
  if (await dayClosingRepo.exists({ date: day, reopenedAt: null })) {
    throw conflict(`${day} has been closed (day-close). Ask an owner to re-open it before recording payments for that date.`);
  }
}

/** Uses available advance credit of the student on a newly created invoice (oldest payment first). */
async function applyAdvance(studentId: Id, invoiceId: Id, balance: number, on: string) {
  if (balance <= 0) return;
  const credits = await paymentRepo.find({ studentId, status: 'recorded', unallocatedPaise: { $gt: 0 } }, { sort: { paidOn: 1, _id: 1 } });
  let left = balance;
  for (const p of credits) {
    if (left === 0) break;
    const take = Math.min(left, p.unallocatedPaise);
    await allocationRepo.create({ paymentId: p._id, invoiceId, studentId, amountPaise: take, active: true });
    await ledger([
      { studentId, invoiceId: null, paymentId: p._id, type: 'advance_applied', amountPaise: take, occurredOn: on, memo: 'Advance applied to invoice' },
      { studentId, invoiceId, paymentId: p._id, type: 'payment', amountPaise: -take, occurredOn: on, memo: `From advance (receipt ${p.receiptNo})` },
    ]);
    await paymentRepo.updateById(p._id, { unallocatedPaise: p.unallocatedPaise - take });
    left -= take;
  }
}

export interface GenerateInput { structureId: string; installmentLabel: string; sectionId?: string; studentIds?: string[] }

export const BillingService = {
  // ------------------------------------------------------------------ invoices
  async generate(input: GenerateInput) {
    const structure = await feeStructureRepo.getById(input.structureId, 'Fee structure');
    if (structure.status !== 'published') throw conflict('Only a published fee structure can be billed');
    const lines = structure.items
      .map((it) => ({ it, ins: it.installments.find((i) => i.label === input.installmentLabel) }))
      .filter((x) => x.ins && x.ins.amountPaise > 0);
    if (lines.length === 0) throw validationFailed(`Instalment "${input.installmentLabel}" does not exist in this structure`);
    const dueDate = lines.map((x) => x.ins!.dueDate).sort()[0]!;
    const cats = new Map((await feeCategoryRepo.findByIds(lines.map((x) => x.it.categoryId))).map((c) => [String(c._id), c]));
    const ef: Record<string, unknown> = { sessionId: structure.sessionId, classId: structure.classId, status: 'active' };
    if (input.sectionId) ef.sectionId = toObjectId(input.sectionId) ?? new Types.ObjectId();
    if (input.studentIds?.length) ef.studentId = { $in: input.studentIds.map((s) => toObjectId(s)).filter(Boolean) };
    const enrollments = await enrollmentRepo.find(ef);
    const day = await today();
    const policy = await getFeePolicy();
    const fy = financialYear(day);
    const billingKey = `${structure.familyKey}|${input.installmentLabel}`;
    const already = new Set((await invoiceRepo.find({ billingKey, studentId: { $in: enrollments.map((e) => e.studentId) } }, { select: 'studentId' })).map((i) => String(i.studentId)));
    const concessions = await concessionRepo.find({ sessionId: structure.sessionId, status: 'approved', studentId: { $in: enrollments.map((e) => e.studentId) } });

    let created = 0;
    let skipped = 0;
    let totalBilled = 0;
    for (const e of enrollments) {
      if (already.has(String(e.studentId))) { skipped++; continue; }
      const invLines = lines.map((x) => ({ categoryId: x.it.categoryId, description: `${cats.get(String(x.it.categoryId))?.name ?? 'Fee'} — ${input.installmentLabel}`, amountPaise: x.ins!.amountPaise }));
      const gross = invLines.reduce((a, l) => a + l.amountPaise, 0);
      // Concessions: percent of the applicable lines, flat per invoice; never more than what they apply to.
      let remainingDiscountable = gross;
      const conLines: Array<{ concessionId: Id; description: string; amountPaise: number }> = [];
      for (const c of concessions.filter((c) => c.studentId.equals(e.studentId))) {
        const base = c.categoryId ? invLines.filter((l) => l.categoryId.equals(c.categoryId!)).reduce((a, l) => a + l.amountPaise, 0) : gross;
        let amt = c.valueType === 'percent' ? percentOf(base, c.value) : Math.min(c.value, base);
        amt = Math.min(amt, remainingDiscountable);
        if (amt <= 0) continue;
        remainingDiscountable -= amt;
        conLines.push({ concessionId: c._id, description: `Concession (${c.kind.replace('_', ' ')}${c.valueType === 'percent' ? ` ${c.value / 100}%` : ''})`, amountPaise: amt });
      }
      const conTotal = conLines.reduce((a, l) => a + l.amountPaise, 0);
      try {
        await withTransaction(async () => {
          const n = await SequenceService.next(`invoice:${fy}`);
          const inv = await invoiceRepo.create({
            invoiceNo: formatSequence(policy.invoicePrefix, fy, n), studentId: e.studentId, enrollmentId: e._id, sessionId: structure.sessionId,
            classId: e.classId, sectionId: e.sectionId, structureId: structure._id, structureVersion: structure.version, familyKey: structure.familyKey,
            installmentLabel: input.installmentLabel, billingKey, dueDate, lines: invLines, concessionLines: conLines,
            totalPaise: gross - conTotal, paidPaise: 0, balancePaise: gross - conTotal, status: 'open',
          });
          await ledger([
            { studentId: e.studentId, invoiceId: inv._id, type: 'charge', amountPaise: gross, occurredOn: day, memo: inv.invoiceNo },
            ...conLines.map((c) => ({ studentId: e.studentId, invoiceId: inv._id, type: 'concession' as const, amountPaise: -c.amountPaise, occurredOn: day, memo: c.description })),
          ]);
          await applyAdvance(e.studentId, inv._id, gross - conTotal, day);
          await recalcInvoice(inv._id);
        });
        created++;
        totalBilled += gross - conTotal;
      } catch (err) {
        if ((err as { code?: number }).code === 11000) { skipped++; continue; } // a concurrent run billed this student first
        throw err;
      }
    }
    await AuditService.record({ action: 'fees.invoices_generated', entityType: 'fee_structure', entityId: structure._id, after: { installmentLabel: input.installmentLabel, created, skipped, totalBilledPaise: totalBilled } });
    return { created, skipped, students: enrollments.length, totalBilledPaise: totalBilled };
  },

  async voidInvoice(id: string, reason: string) {
    const inv = await invoiceRepo.getById(id, 'Invoice');
    if (inv.status === 'void') throw conflict('Invoice is already void');
    if (await allocationRepo.exists({ invoiceId: inv._id, active: true })) throw conflict('Payments are allocated to this invoice — reverse them first');
    const day = await today();
    await withTransaction(async () => {
      const rows = await ledgerRepo.find({ invoiceId: inv._id });
      const net = rows.reduce((a, r) => a + r.amountPaise, 0);
      await ledger([{ studentId: inv.studentId, invoiceId: inv._id, type: 'adjustment', amountPaise: -net, occurredOn: day, memo: `Void: ${reason}` }]);
      await invoiceRepo.updateById(inv._id, { status: 'void', voidReason: reason, billingKey: null });
      await recalcInvoice(inv._id);
    });
    await AuditService.record({ action: 'fees.invoice_voided', entityType: 'invoice', entityId: id, before: { totalPaise: inv.totalPaise }, after: { reason } });
    return invoiceRepo.getById(id);
  },

  /** Late fee (D-08: manual, with reason) or a signed correction. Balance may never go below zero. */
  async adjust(id: string, input: { amountPaise: number; reason: string; type: 'late_fee' | 'adjustment' }) {
    const inv = await invoiceRepo.getById(id, 'Invoice');
    if (inv.status === 'void') throw conflict('Invoice is void');
    if (input.amountPaise === 0) throw validationFailed('Amount cannot be zero');
    if (input.type === 'late_fee' && input.amountPaise < 0) throw validationFailed('A late fee must be positive');
    if (inv.balancePaise + input.amountPaise < 0) throw validationFailed(`This would make the balance negative (balance ${formatINR(inv.balancePaise)}). Use a refund for money to return.`);
    const day = await today();
    const updated = await withTransaction(async () => {
      await ledger([{ studentId: inv.studentId, invoiceId: inv._id, type: input.type, amountPaise: input.amountPaise, occurredOn: day, memo: input.reason }]);
      return recalcInvoice(inv._id);
    });
    await AuditService.record({ action: input.type === 'late_fee' ? 'fees.late_fee_applied' : 'fees.invoice_adjusted', entityType: 'invoice', entityId: id, before: { balancePaise: inv.balancePaise }, after: { amountPaise: input.amountPaise, reason: input.reason } });
    return updated;
  },

  // ------------------------------------------------------------------ payments
  async recordPayment(input: {
    studentId: string; amountPaise: number; mode: PaymentMode; paidOn: string; reference?: string; note?: string;
    allocations?: Array<{ invoiceId: string; amountPaise: number }>; keepAdvance?: boolean; cashierName: string;
  }) {
    const tenant = requireTenant('fees.payment');
    const student = await studentRepo.getById(input.studentId, 'Student');
    if (!Number.isSafeInteger(input.amountPaise) || input.amountPaise <= 0) throw validationFailed('Amount must be a positive whole number of paise');
    if (!isValidDay(input.paidOn)) throw validationFailed('Invalid payment date');
    const day = await today();
    if (input.paidOn > day) throw validationFailed('Payment date cannot be in the future');
    if ((input.mode === 'cheque' || input.mode === 'bank_transfer') && !input.reference?.trim()) throw validationFailed(`A reference (${input.mode === 'cheque' ? 'cheque number' : 'UTR / transaction id'}) is required`);
    await assertDayOpen(input.paidOn);
    const policy = await getFeePolicy();
    const fy = financialYear(input.paidOn);

    const result = await withTransaction(async () => {
      const open = await invoiceRepo.find({ studentId: student._id, status: { $in: ['open', 'partially_paid'] } }, { sort: { dueDate: 1 } });
      let allocs: Array<{ id: string; amountPaise: number }>;
      let remainder: number;
      if (input.allocations?.length) {
        const by = new Map(open.map((i) => [String(i._id), i]));
        for (const a of input.allocations) {
          const inv = by.get(a.invoiceId);
          if (!inv) throw notFound('Open invoice of this student');
          if (!Number.isSafeInteger(a.amountPaise) || a.amountPaise <= 0 || a.amountPaise > inv.balancePaise) throw validationFailed(`Allocation to ${inv.invoiceNo} must be between ₹0.01 and its balance ${formatINR(inv.balancePaise)}`);
        }
        allocs = input.allocations.map((a) => ({ id: a.invoiceId, amountPaise: a.amountPaise }));
        remainder = input.amountPaise - allocs.reduce((a, b) => a + b.amountPaise, 0);
        if (remainder < 0) throw validationFailed('Allocations exceed the amount received');
      } else {
        const r = allocateOldestFirst(open.map((i) => ({ id: String(i._id), dueDate: i.dueDate, balancePaise: i.balancePaise })), input.amountPaise);
        allocs = r.allocations;
        remainder = r.remainderPaise;
      }
      if (remainder > 0 && !(input.keepAdvance && policy.allowAdvance)) {
        throw new AppError(422, 'VALIDATION_FAILED', `The amount is ${formatINR(remainder)} more than the dues. Reduce it, or keep the extra as advance.`);
      }
      const n = await SequenceService.next(`receipt:${fy}`);
      const receiptNo = formatSequence(policy.receiptPrefix, fy, n);
      const payment = await paymentRepo.create({
        studentId: student._id, amountPaise: input.amountPaise, mode: input.mode, reference: input.reference?.trim() || undefined, paidOn: input.paidOn,
        receivedBy: tenant.membershipId, receivedByName: input.cashierName, status: 'recorded', unallocatedPaise: remainder, receiptNo, note: input.note,
        receiptLines: [
          ...allocs.map((a) => { const inv = open.find((i) => String(i._id) === a.id)!; return { invoiceNo: inv.invoiceNo, description: `Fees — ${inv.installmentLabel}`, amountPaise: a.amountPaise }; }),
          ...(remainder > 0 ? [{ invoiceNo: null, description: 'Advance (credit for future fees)', amountPaise: remainder }] : []),
        ],
      });
      if (allocs.length) await allocationRepo.createMany(allocs.map((a) => ({ paymentId: payment._id, invoiceId: new Types.ObjectId(a.id), studentId: student._id, amountPaise: a.amountPaise, active: true })));
      await ledger([
        ...allocs.map((a) => ({ studentId: student._id, invoiceId: new Types.ObjectId(a.id), paymentId: payment._id, type: 'payment' as const, amountPaise: -a.amountPaise, occurredOn: input.paidOn, memo: receiptNo })),
        ...(remainder > 0 ? [{ studentId: student._id, invoiceId: null, paymentId: payment._id, type: 'advance' as const, amountPaise: -remainder, occurredOn: input.paidOn, memo: `${receiptNo} advance` }] : []),
      ]);
      for (const a of allocs) await recalcInvoice(new Types.ObjectId(a.id));
      return { payment, allocations: allocs };
    });
    await AuditService.record({ action: 'fees.payment_recorded', entityType: 'payment', entityId: result.payment._id, after: { receiptNo: result.payment.receiptNo, amountPaise: input.amountPaise, mode: input.mode, studentId: input.studentId } });
    return result;
  },

  // ------------------------------------------------------------------ reversal (two people)
  async requestReversal(paymentId: string, reason: string) {
    const tenant = requireTenant('fees.reversal.request');
    const p = await paymentRepo.getById(paymentId, 'Payment');
    if (p.status !== 'recorded') throw conflict('This payment is already reversed');
    if (await financeRequestRepo.exists({ kind: 'reversal', paymentId: p._id, status: 'requested' })) throw conflict('A reversal request for this payment is already pending');
    const r = await financeRequestRepo.create({ kind: 'reversal', studentId: p.studentId, paymentId: p._id, amountPaise: p.amountPaise, reason, status: 'requested', requestedBy: tenant.membershipId });
    await AuditService.record({ action: 'fees.reversal_requested', entityType: 'payment', entityId: p._id, after: { reason, receiptNo: p.receiptNo } });
    return r;
  },

  async requestRefund(studentId: string, amountPaise: number, reason: string) {
    const tenant = requireTenant('fees.refund.request');
    const s = await studentRepo.getById(studentId, 'Student');
    const credit = await this.availableCredit(s._id);
    if (!Number.isSafeInteger(amountPaise) || amountPaise <= 0) throw validationFailed('Invalid amount');
    if (amountPaise > credit) throw validationFailed(`Only ${formatINR(credit)} of advance credit is available to refund`);
    const r = await financeRequestRepo.create({ kind: 'refund', studentId: s._id, amountPaise, reason, status: 'requested', requestedBy: tenant.membershipId });
    await AuditService.record({ action: 'fees.refund_requested', entityType: 'student', entityId: s._id, after: { amountPaise, reason } });
    return r;
  },

  /** Advance credit not yet used, minus refunds already requested/approved but not paid. */
  async availableCredit(studentId: Id): Promise<number> {
    const pays = await paymentRepo.find({ studentId, status: 'recorded', unallocatedPaise: { $gt: 0 } }, { select: 'unallocatedPaise' });
    const pending = await financeRequestRepo.find({ studentId, kind: 'refund', status: { $in: ['requested', 'approved'] } }, { select: 'amountPaise' });
    return pays.reduce((a, p) => a + p.unallocatedPaise, 0) - pending.reduce((a, r) => a + r.amountPaise, 0);
  },

  async decide(requestId: string, approve: boolean, note?: string) {
    const tenant = requireTenant('fees.request.decide');
    const r = await financeRequestRepo.getById(requestId, 'Request');
    if (r.status !== 'requested') throw conflict('This request was already decided');
    if (r.requestedBy.equals(tenant.membershipId)) throw forbidden('Separation of duties: someone else must approve your request');
    if (!approve) {
      const u = await financeRequestRepo.updateById(requestId, { status: 'rejected', decidedBy: tenant.membershipId, decidedAt: new Date(), decisionNote: note });
      await AuditService.record({ action: `fees.${r.kind}_rejected`, entityType: 'finance_request', entityId: requestId, after: { note } });
      return u;
    }
    if (r.kind === 'refund') {
      const u = await financeRequestRepo.updateById(requestId, { status: 'approved', decidedBy: tenant.membershipId, decidedAt: new Date(), decisionNote: note });
      await AuditService.record({ action: 'fees.refund_approved', entityType: 'finance_request', entityId: requestId, after: { amountPaise: r.amountPaise } });
      return u;
    }
    // reversal: undo every active allocation (incl. advance applied later) and any remaining advance
    const day = await today();
    const u = await withTransaction(async () => {
      const p = await paymentRepo.getById(r.paymentId, 'Payment');
      if (p.status !== 'recorded') throw conflict('Payment is already reversed');
      const allocs = await allocationRepo.find({ paymentId: p._id, active: true });
      await ledger([
        ...allocs.map((a) => ({ studentId: p.studentId, invoiceId: a.invoiceId, paymentId: p._id, type: 'reversal' as const, amountPaise: a.amountPaise, occurredOn: day, memo: `Reversal of ${p.receiptNo}: ${r.reason}` })),
        ...(p.unallocatedPaise > 0 ? [{ studentId: p.studentId, invoiceId: null, paymentId: p._id, type: 'reversal' as const, amountPaise: p.unallocatedPaise, occurredOn: day, memo: `Reversal of ${p.receiptNo} (advance)` }] : []),
      ]);
      await allocationRepo.bulkWrite([{ updateMany: { filter: { paymentId: p._id, active: true }, update: { $set: { active: false } } } }]);
      await paymentRepo.updateById(p._id, { status: 'reversed', reversalId: r._id, unallocatedPaise: 0 });
      for (const a of allocs) await recalcInvoice(a.invoiceId);
      return financeRequestRepo.updateById(requestId, { status: 'approved', decidedBy: tenant.membershipId, decidedAt: new Date(), decisionNote: note });
    });
    await AuditService.record({ action: 'fees.payment_reversed', entityType: 'payment', entityId: r.paymentId, after: { requestId, reason: r.reason } });
    return u;
  },

  async markRefundPaid(requestId: string, input: { paidOn: string; mode: PaymentMode; reference?: string }) {
    const r = await financeRequestRepo.getById(requestId, 'Request');
    if (r.kind !== 'refund' || r.status !== 'approved') throw conflict('Only an approved refund can be paid out');
    if (!isValidDay(input.paidOn) || input.paidOn > (await today())) throw validationFailed('Invalid payout date');
    const u = await withTransaction(async () => {
      let left = r.amountPaise;
      const pays = await paymentRepo.find({ studentId: r.studentId, status: 'recorded', unallocatedPaise: { $gt: 0 } }, { sort: { paidOn: 1, _id: 1 } });
      for (const p of pays) {
        if (left === 0) break;
        const take = Math.min(left, p.unallocatedPaise);
        await paymentRepo.updateById(p._id, { unallocatedPaise: p.unallocatedPaise - take });
        await ledger([{ studentId: r.studentId, invoiceId: null, paymentId: p._id, refundId: r._id, type: 'refund', amountPaise: take, occurredOn: input.paidOn, memo: `Refund: ${r.reason}` }]);
        left -= take;
      }
      if (left > 0) throw conflict('Not enough advance credit left to pay this refund');
      return financeRequestRepo.updateById(requestId, { status: 'paid', paidOn: input.paidOn, mode: input.mode, reference: input.reference ?? null });
    });
    await AuditService.record({ action: 'fees.refund_paid', entityType: 'finance_request', entityId: requestId, after: { amountPaise: r.amountPaise, mode: input.mode } });
    return u;
  },

  // ------------------------------------------------------------------ day close
  async closeDay(input: { date: string; countedCashPaise?: number; note?: string }) {
    const tenant = requireTenant('fees.dayclose');
    if (!isValidDay(input.date) || input.date > (await today())) throw validationFailed('You can only close today or an earlier day');
    const pays = await paymentRepo.find({ paidOn: input.date, status: 'recorded' }, { select: 'mode amountPaise' });
    const cash = pays.filter((p) => p.mode === 'cash').reduce((a, p) => a + p.amountPaise, 0);
    const nonCash = pays.filter((p) => p.mode !== 'cash').reduce((a, p) => a + p.amountPaise, 0);
    try {
      const c = await dayClosingRepo.create({ date: input.date, closedBy: tenant.membershipId, cashTotalPaise: cash, nonCashTotalPaise: nonCash, countedCashPaise: input.countedCashPaise ?? null, note: input.note, reopenedAt: null });
      await AuditService.record({ action: 'fees.day_closed', entityType: 'day_closing', entityId: c._id, after: { date: input.date, cash, nonCash, countedCashPaise: input.countedCashPaise } });
      return c;
    } catch (err) {
      if ((err as { code?: number }).code === 11000) throw conflict(`${input.date} is already closed`);
      throw err;
    }
  },

  async reopenDay(date: string, reason: string) {
    const tenant = requireTenant('fees.dayreopen');
    const c = await dayClosingRepo.findOne({ date, reopenedAt: null });
    if (!c) throw notFound('Closed day');
    const u = await dayClosingRepo.updateById(c._id, { reopenedAt: new Date(), reopenedBy: tenant.membershipId });
    await AuditService.record({ action: 'fees.day_reopened', entityType: 'day_closing', entityId: c._id, after: { date, reason } });
    return u;
  },

  // ------------------------------------------------------------------ views
  async studentSummary(studentId: string) {
    const s = await studentRepo.getById(studentId, 'Student');
    const day = await today();
    const [invoices, payments, credit] = await Promise.all([
      invoiceRepo.find({ studentId: s._id }, { sort: { dueDate: 1 } }),
      paymentRepo.find({ studentId: s._id }, { sort: { paidOn: -1, _id: -1 } }),
      this.availableCredit(s._id),
    ]);
    const live = invoices.filter((i) => i.status !== 'void');
    return {
      student: { id: String(s._id), name: [s.firstName, s.lastName].filter(Boolean).join(' '), admissionNo: s.admissionNo, status: s.status },
      totals: {
        billedPaise: live.reduce((a, i) => a + i.totalPaise, 0),
        paidPaise: live.reduce((a, i) => a + i.paidPaise, 0),
        balancePaise: live.reduce((a, i) => a + i.balancePaise, 0),
        overduePaise: live.filter((i) => i.dueDate < day).reduce((a, i) => a + Math.max(0, i.balancePaise), 0),
        advanceCreditPaise: credit,
      },
      invoices: invoices.map(toInvoiceDto),
      payments: payments.map(toPaymentDto),
    };
  },
};

export function toInvoiceDto(i: Awaited<ReturnType<typeof invoiceRepo.getById>>) {
  return {
    id: String(i._id), invoiceNo: i.invoiceNo, studentId: String(i.studentId), classId: String(i.classId), sectionId: String(i.sectionId),
    installmentLabel: i.installmentLabel, dueDate: i.dueDate, lines: i.lines.map((l) => ({ categoryId: String(l.categoryId), description: l.description, amountPaise: l.amountPaise })),
    concessionLines: i.concessionLines.map((c) => ({ description: c.description, amountPaise: c.amountPaise })), totalPaise: i.totalPaise, paidPaise: i.paidPaise,
    balancePaise: i.balancePaise, status: i.status, voidReason: i.voidReason ?? null, structureVersion: i.structureVersion,
  };
}

export function toPaymentDto(p: Awaited<ReturnType<typeof paymentRepo.getById>>) {
  return {
    id: String(p._id), receiptNo: p.receiptNo, studentId: String(p.studentId), amountPaise: p.amountPaise, mode: p.mode, reference: p.reference ?? null,
    paidOn: p.paidOn, status: p.status, unallocatedPaise: p.unallocatedPaise, receivedByName: p.receivedByName, note: p.note ?? null, receiptLines: p.receiptLines,
  };
}
