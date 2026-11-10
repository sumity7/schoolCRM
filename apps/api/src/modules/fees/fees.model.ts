import { Schema, type Types } from 'mongoose';
import { defineTenantModel } from '../../core/tenancy/registry';

/**
 * Finance (doc 05 §6) — highest rigour. All money is integer PAISE.
 * Principles: payments, receipts, allocations and ledger entries are never edited or deleted (no such route exists);
 * corrections are NEW rows (reversals/adjustments). Invoice amounts are cached totals that must always equal the
 * sum of their ledger entries (tested as an invariant).
 */

const paise = { type: Number, required: true, validate: { validator: Number.isSafeInteger, message: 'amount must be whole paise' } };

// ------------------------------------------------------------------ configuration
export interface IFeeCategory { key: string; name: string; kind: string; isRefundable: boolean; active: boolean }
export const FeeCategoryModel = defineTenantModel<IFeeCategory>(
  'FeeCategory',
  {
    key: { type: String, required: true, lowercase: true, trim: true, maxlength: 40 },
    name: { type: String, required: true, trim: true, maxlength: 80 },
    kind: { type: String, enum: ['tuition', 'admission', 'exam', 'transport', 'library', 'activity', 'other'], required: true },
    isRefundable: { type: Boolean, default: false },
    active: { type: Boolean, default: true },
  },
  (s) => s.index({ schoolId: 1, key: 1 }, { unique: true }),
);

export interface IStructureInstallment { label: string; dueDate: string; amountPaise: number }
export interface IStructureItem { categoryId: Types.ObjectId; amountPaise: number; installments: IStructureInstallment[] }
export interface IFeeStructure {
  sessionId: Types.ObjectId;
  classId: Types.ObjectId;
  name: string;
  /** sessionId:classId:name — stable across versions; invoices are unique per (student, family, installment). */
  familyKey: string;
  version: number;
  status: 'draft' | 'published' | 'superseded';
  items: IStructureItem[];
  publishedAt?: Date | null;
  publishedBy?: Types.ObjectId | null;
}
export const FeeStructureModel = defineTenantModel<IFeeStructure>(
  'FeeStructure',
  {
    sessionId: { type: 'ObjectId', required: true },
    classId: { type: 'ObjectId', required: true },
    name: { type: String, required: true, trim: true, maxlength: 80 },
    familyKey: { type: String, required: true },
    version: { type: Number, required: true },
    status: { type: String, enum: ['draft', 'published', 'superseded'], required: true, default: 'draft' },
    items: {
      type: [new Schema({
        categoryId: { type: 'ObjectId', required: true },
        amountPaise: paise,
        installments: { type: [new Schema({ label: { type: String, required: true, maxlength: 40 }, dueDate: { type: String, required: true }, amountPaise: paise }, { _id: false })], default: [] },
      }, { _id: false })],
      default: [],
      validate: (v: unknown[]) => v.length <= 30,
    },
    publishedAt: { type: Date, default: null },
    publishedBy: { type: 'ObjectId', default: null },
  },
  (s) => {
    s.index({ schoolId: 1, familyKey: 1, version: 1 }, { unique: true });
    // at most one PUBLISHED version per family
    s.index({ schoolId: 1, familyKey: 1 }, { unique: true, partialFilterExpression: { status: 'published' }, name: 'one_published_version' });
    s.index({ schoolId: 1, sessionId: 1, classId: 1 });
  },
);

export interface IConcession {
  studentId: Types.ObjectId;
  sessionId: Types.ObjectId;
  kind: string;
  valueType: 'percent' | 'flat';
  /** percent: basis points (1% = 100); flat: paise per invoice */
  value: number;
  categoryId?: Types.ObjectId | null;
  reason: string;
  status: 'pending_approval' | 'approved' | 'rejected' | 'revoked';
  requestedBy: Types.ObjectId;
  decidedBy?: Types.ObjectId | null;
  decidedAt?: Date | null;
}
export const ConcessionModel = defineTenantModel<IConcession>(
  'Concession',
  {
    studentId: { type: 'ObjectId', required: true },
    sessionId: { type: 'ObjectId', required: true },
    kind: { type: String, enum: ['scholarship', 'sibling', 'staff_ward', 'merit', 'other'], required: true },
    valueType: { type: String, enum: ['percent', 'flat'], required: true },
    value: { type: Number, required: true, min: 1 },
    categoryId: { type: 'ObjectId', default: null },
    reason: { type: String, required: true, maxlength: 300 },
    status: { type: String, enum: ['pending_approval', 'approved', 'rejected', 'revoked'], required: true },
    requestedBy: { type: 'ObjectId', required: true },
    decidedBy: { type: 'ObjectId', default: null },
    decidedAt: { type: Date, default: null },
  },
  (s) => {
    s.index({ schoolId: 1, studentId: 1, sessionId: 1 });
    s.index({ schoolId: 1, status: 1, createdAt: -1 });
  },
);

// ------------------------------------------------------------------ billing
export interface IInvoiceLine { categoryId: Types.ObjectId; description: string; amountPaise: number }
export interface IInvoice {
  invoiceNo: string;
  studentId: Types.ObjectId;
  enrollmentId: Types.ObjectId;
  sessionId: Types.ObjectId;
  classId: Types.ObjectId;
  sectionId: Types.ObjectId;
  structureId: Types.ObjectId;
  structureVersion: number;
  familyKey: string;
  installmentLabel: string;
  /** `${familyKey}|${installmentLabel}` while the invoice counts; null once voided (so the instalment can be billed again) */
  billingKey: string | null;
  dueDate: string;
  lines: IInvoiceLine[];
  concessionLines: Array<{ concessionId: Types.ObjectId; description: string; amountPaise: number }>;
  /** cached: gross lines − concessions + late fees + adjustments */
  totalPaise: number;
  paidPaise: number;
  balancePaise: number;
  status: 'open' | 'partially_paid' | 'paid' | 'void';
  voidReason?: string | null;
}
export const InvoiceModel = defineTenantModel<IInvoice>(
  'Invoice',
  {
    invoiceNo: { type: String, required: true },
    studentId: { type: 'ObjectId', required: true },
    enrollmentId: { type: 'ObjectId', required: true },
    sessionId: { type: 'ObjectId', required: true },
    classId: { type: 'ObjectId', required: true },
    sectionId: { type: 'ObjectId', required: true },
    structureId: { type: 'ObjectId', required: true },
    structureVersion: { type: Number, required: true },
    familyKey: { type: String, required: true },
    installmentLabel: { type: String, required: true },
    billingKey: { type: String, default: null },
    dueDate: { type: String, required: true },
    lines: { type: [new Schema({ categoryId: { type: 'ObjectId', required: true }, description: String, amountPaise: paise }, { _id: false })], default: [] },
    concessionLines: { type: [new Schema({ concessionId: { type: 'ObjectId', required: true }, description: String, amountPaise: paise }, { _id: false })], default: [] },
    totalPaise: paise,
    paidPaise: paise,
    balancePaise: paise,
    status: { type: String, enum: ['open', 'partially_paid', 'paid', 'void'], required: true },
    voidReason: { type: String, default: null },
  },
  (s) => {
    s.index({ schoolId: 1, invoiceNo: 1 }, { unique: true });
    s.index({ schoolId: 1, studentId: 1, billingKey: 1 }, { unique: true, partialFilterExpression: { billingKey: { $type: 'string' } }, name: 'no_double_billing' });
    s.index({ schoolId: 1, status: 1, dueDate: 1 });
    s.index({ schoolId: 1, studentId: 1, sessionId: 1 });
    s.index({ schoolId: 1, sessionId: 1, sectionId: 1, status: 1 });
  },
);

export interface IPayment {
  studentId: Types.ObjectId;
  amountPaise: number;
  mode: string;
  reference?: string;
  paidOn: string;
  receivedBy: Types.ObjectId;
  status: 'recorded' | 'reversed';
  /** advance credit still available (cached; Σ ledger 'payment'/'advance_applied' rows without invoice) */
  unallocatedPaise: number;
  receiptNo: string;
  /** cashier's name at the time (receipts must show who collected even if the account is later renamed/removed) */
  receivedByName: string;
  /** immutable snapshot printed on the receipt (what the money was for AT payment time) */
  receiptLines: Array<{ invoiceNo: string | null; description: string; amountPaise: number }>;
  note?: string;
  reversalId?: Types.ObjectId | null;
}
export const PaymentModel = defineTenantModel<IPayment>(
  'Payment',
  {
    studentId: { type: 'ObjectId', required: true },
    amountPaise: { ...paise, min: 1 },
    mode: { type: String, enum: ['cash', 'upi', 'bank_transfer', 'cheque', 'card'], required: true },
    reference: { type: String, maxlength: 80 },
    paidOn: { type: String, required: true },
    receivedBy: { type: 'ObjectId', required: true },
    status: { type: String, enum: ['recorded', 'reversed'], required: true, default: 'recorded' },
    unallocatedPaise: { ...paise, min: 0 },
    receiptNo: { type: String, required: true },
    receivedByName: { type: String, required: true, maxlength: 120 },
    receiptLines: { type: [new Schema({ invoiceNo: { type: String, default: null }, description: String, amountPaise: paise }, { _id: false })], default: [] },
    note: { type: String, maxlength: 300 },
    reversalId: { type: 'ObjectId', default: null },
  },
  (s) => {
    s.index({ schoolId: 1, receiptNo: 1 }, { unique: true });
    s.index({ schoolId: 1, paidOn: 1 });
    s.index({ schoolId: 1, studentId: 1, paidOn: 1 });
    s.index({ schoolId: 1, receivedBy: 1, paidOn: 1 });
    s.index({ schoolId: 1, studentId: 1, unallocatedPaise: 1 });
  },
);

export interface IAllocation { paymentId: Types.ObjectId; invoiceId: Types.ObjectId; studentId: Types.ObjectId; amountPaise: number; active: boolean }
export const AllocationModel = defineTenantModel<IAllocation>(
  'PaymentAllocation',
  {
    paymentId: { type: 'ObjectId', required: true },
    invoiceId: { type: 'ObjectId', required: true },
    studentId: { type: 'ObjectId', required: true },
    amountPaise: { ...paise, min: 1 },
    /** false once the payment is reversed (the reversal ledger rows carry the money effect) */
    active: { type: Boolean, default: true },
  },
  (s) => {
    s.index({ schoolId: 1, paymentId: 1, invoiceId: 1 });
    s.index({ schoolId: 1, invoiceId: 1 });
  },
);

export type LedgerType = 'charge' | 'concession' | 'late_fee' | 'adjustment' | 'payment' | 'advance' | 'advance_applied' | 'reversal' | 'refund';
export interface ILedgerEntry {
  studentId: Types.ObjectId;
  invoiceId?: Types.ObjectId | null;
  paymentId?: Types.ObjectId | null;
  refundId?: Types.ObjectId | null;
  type: LedgerType;
  /** signed: + increases what the student owes (charges), − decreases it (payments, concessions) */
  amountPaise: number;
  occurredOn: string;
  memo?: string;
  reversesEntryId?: Types.ObjectId | null;
}
export const LedgerEntryModel = defineTenantModel<ILedgerEntry>(
  'LedgerEntry',
  {
    studentId: { type: 'ObjectId', required: true },
    invoiceId: { type: 'ObjectId', default: null },
    paymentId: { type: 'ObjectId', default: null },
    refundId: { type: 'ObjectId', default: null },
    type: { type: String, enum: ['charge', 'concession', 'late_fee', 'adjustment', 'payment', 'advance', 'advance_applied', 'reversal', 'refund'], required: true },
    amountPaise: paise,
    occurredOn: { type: String, required: true },
    memo: { type: String, maxlength: 300 },
    reversesEntryId: { type: 'ObjectId', default: null },
  },
  (s) => {
    s.index({ schoolId: 1, studentId: 1, occurredOn: 1 });
    s.index({ schoolId: 1, invoiceId: 1 });
    s.index({ schoolId: 1, paymentId: 1 });
    s.index({ schoolId: 1, type: 1, occurredOn: 1 });
  },
);

/** Separation of duties: a payment reversal or a refund is REQUESTED by one person and DECIDED by another. */
export interface IFinanceRequest {
  kind: 'reversal' | 'refund';
  studentId: Types.ObjectId;
  paymentId?: Types.ObjectId | null;
  amountPaise: number;
  reason: string;
  status: 'requested' | 'approved' | 'rejected' | 'paid';
  requestedBy: Types.ObjectId;
  decidedBy?: Types.ObjectId | null;
  decidedAt?: Date | null;
  decisionNote?: string;
  paidOn?: string | null;
  mode?: string | null;
  reference?: string | null;
}
export const FinanceRequestModel = defineTenantModel<IFinanceRequest>(
  'FinanceRequest',
  {
    kind: { type: String, enum: ['reversal', 'refund'], required: true },
    studentId: { type: 'ObjectId', required: true },
    paymentId: { type: 'ObjectId', default: null },
    amountPaise: { ...paise, min: 1 },
    reason: { type: String, required: true, maxlength: 300 },
    status: { type: String, enum: ['requested', 'approved', 'rejected', 'paid'], required: true },
    requestedBy: { type: 'ObjectId', required: true },
    decidedBy: { type: 'ObjectId', default: null },
    decidedAt: { type: Date, default: null },
    decisionNote: { type: String, maxlength: 300 },
    paidOn: { type: String, default: null },
    mode: { type: String, default: null },
    reference: { type: String, default: null },
  },
  (s) => {
    s.index({ schoolId: 1, status: 1, createdAt: -1 });
    // one open reversal request per payment
    s.index({ schoolId: 1, paymentId: 1 }, { unique: true, partialFilterExpression: { kind: 'reversal', status: 'requested' }, name: 'one_open_reversal' });
  },
);

export interface IDayClosing { date: string; closedBy: Types.ObjectId; cashTotalPaise: number; nonCashTotalPaise: number; countedCashPaise?: number | null; note?: string; reopenedAt?: Date | null; reopenedBy?: Types.ObjectId | null }
export const DayClosingModel = defineTenantModel<IDayClosing>(
  'DayClosing',
  {
    date: { type: String, required: true },
    closedBy: { type: 'ObjectId', required: true },
    cashTotalPaise: paise,
    nonCashTotalPaise: paise,
    countedCashPaise: { type: Number, default: null },
    note: { type: String, maxlength: 300 },
    reopenedAt: { type: Date, default: null },
    reopenedBy: { type: 'ObjectId', default: null },
  },
  (s) => s.index({ schoolId: 1, date: 1 }, { unique: true, partialFilterExpression: { reopenedAt: null }, name: 'one_active_closing' }),
);
