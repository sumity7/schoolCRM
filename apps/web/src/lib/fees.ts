import { formatINR } from '@edunex/shared';
import { ApiError } from './api';

export const inr = (paise: number | null | undefined) => (paise === null || paise === undefined ? '—' : formatINR(paise));

export interface FeeCategory { id: string; key: string; name: string; kind: string; isRefundable: boolean; active: boolean }
export interface Installment { label: string; dueDate: string; amountPaise: number }
export interface FeeStructure {
  id: string; sessionId: string; classId: string; name: string; version: number; status: 'draft' | 'published' | 'superseded';
  items: Array<{ categoryId: string; amountPaise: number; installments: Installment[] }>; totalPaise: number; installmentLabels: string[];
}
export interface Invoice {
  id: string; invoiceNo: string; studentId: string; classId: string; sectionId: string; installmentLabel: string; dueDate: string;
  lines: Array<{ categoryId: string; description: string; amountPaise: number }>; concessionLines: Array<{ description: string; amountPaise: number }>;
  totalPaise: number; paidPaise: number; balancePaise: number; status: 'open' | 'partially_paid' | 'paid' | 'void'; voidReason: string | null;
  student?: { name: string; admissionNo: string } | null;
}
export interface Payment {
  id: string; receiptNo: string; studentId: string; amountPaise: number; mode: string; reference: string | null; paidOn: string; status: 'recorded' | 'reversed';
  unallocatedPaise: number; receivedByName: string; note: string | null; receiptLines: Array<{ invoiceNo: string | null; description: string; amountPaise: number }>;
  student?: { name: string; admissionNo: string } | null;
}
export interface StudentFeeSummary {
  student: { id: string; name: string; admissionNo: string; status: string };
  className: string | null;
  totals: { billedPaise: number; paidPaise: number; balancePaise: number; overduePaise: number; advanceCreditPaise: number };
  invoices: Invoice[];
  payments: Payment[];
}
export interface FinanceRequest {
  id: string; kind: 'reversal' | 'refund'; studentId: string; paymentId: string | null; amountPaise: number; reason: string; status: string;
  requestedBy: string; decidedBy: string | null; decisionNote: string | null; paidOn: string | null; createdAt: string;
  student?: { name: string; admissionNo: string } | null; receiptNo?: string | null;
}

export const invoiceTone = (s: Invoice['status']) => (s === 'paid' ? 'success' : s === 'partially_paid' ? 'warning' : s === 'void' ? 'muted' : 'danger') as 'success' | 'warning' | 'muted' | 'danger';
export const MODE_LABEL: Record<string, string> = { cash: 'Cash', upi: 'UPI', bank_transfer: 'Bank transfer', cheque: 'Cheque', card: 'Card' };

/** Opens a receipt PDF in a new tab via a blob (the API sends no HTML, so the PDF viewer is not affected by page CSP). */
export async function openReceipt(paymentId: string, path = `/fees/payments/${paymentId}/receipt.pdf`): Promise<void> {
  const win = window.open('', '_blank');
  const res = await fetch(`/api/v1${path}`, { credentials: 'same-origin', headers: { 'X-Requested-With': 'edunex' } });
  if (!res.ok) {
    win?.close();
    throw new ApiError(res.status, 'INTERNAL', res.status === 403 ? 'You do not have permission to print receipts' : 'Could not load the receipt');
  }
  const url = URL.createObjectURL(await res.blob());
  if (win) win.location.href = url;
  else window.location.href = url;
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
