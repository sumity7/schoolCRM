/**
 * Money & fee rules shared by API and UI. ALL amounts are integer PAISE (₹1 = 100 paise) — never floats.
 * Pure functions only; every one is unit/property-tested (REQ-FEE).
 */

export type Paise = number;

export function assertPaise(v: number, what = 'amount'): Paise {
  if (!Number.isSafeInteger(v)) throw new Error(`${what} must be a whole number of paise`);
  return v;
}

/** ₹ formatting with Indian digit grouping: 1234567.5 → "₹12,34,567.50". */
export function formatINR(paise: Paise): string {
  const neg = paise < 0;
  const abs = Math.abs(paise);
  const rupees = Math.floor(abs / 100);
  const p = String(abs % 100).padStart(2, '0');
  const s = String(rupees);
  const last3 = s.slice(-3);
  const rest = s.slice(0, -3).replace(/\B(?=(\d{2})+(?!\d))/g, ',');
  return `${neg ? '-' : ''}₹${rest ? `${rest},` : ''}${last3}.${p}`;
}

/** Parses user input "12,500.5" / "12500" into paise. Returns null when invalid or more than 2 decimals. */
export function parseRupees(input: string): Paise | null {
  const s = input.replace(/[₹,\s]/g, '');
  if (!/^\d{1,9}(\.\d{1,2})?$/.test(s)) return null;
  const [r, d = ''] = s.split('.');
  return Number(r) * 100 + Number(d.padEnd(2, '0'));
}

/** Percentage given in BASIS POINTS (1% = 100 bps) of an amount, rounded half-up to the paisa. */
export function percentOf(paise: Paise, bps: number): Paise {
  if (!Number.isInteger(bps) || bps < 0 || bps > 10_000) throw new Error('percentage must be 0–100% in basis points');
  return Math.floor((paise * bps + 5_000) / 10_000);
}

export interface Due { id: string; dueDate: string; balancePaise: Paise }

/**
 * Oldest-due-first allocation. Returns allocations (each > 0, never above a balance) and the unallocated remainder.
 * Invariant (property-tested): Σ allocations + remainder === amount.
 */
export function allocateOldestFirst(dues: Due[], amount: Paise): { allocations: Array<{ id: string; amountPaise: Paise }>; remainderPaise: Paise } {
  assertPaise(amount);
  if (amount <= 0) throw new Error('amount must be positive');
  let left = amount;
  const allocations: Array<{ id: string; amountPaise: Paise }> = [];
  const sorted = [...dues].filter((d) => d.balancePaise > 0).sort((a, b) => a.dueDate.localeCompare(b.dueDate) || a.id.localeCompare(b.id));
  for (const d of sorted) {
    if (left === 0) break;
    const take = Math.min(left, d.balancePaise);
    allocations.push({ id: d.id, amountPaise: take });
    left -= take;
  }
  return { allocations, remainderPaise: left };
}

/** Indian financial year label of a calendar day: 2026-04-01 → "2026-27"; 2027-03-31 → "2026-27". */
export function financialYear(day: string, startMonth = 4): string {
  const [y, m] = day.split('-').map(Number) as [number, number];
  const start = m >= startMonth ? y : y - 1;
  return `${start}-${String((start + 1) % 100).padStart(2, '0')}`;
}

const ONES = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
const TENS = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];
function twoDigits(n: number): string {
  return n < 20 ? ONES[n]! : `${TENS[Math.floor(n / 10)]}${n % 10 ? ` ${ONES[n % 10]}` : ''}`;
}
function threeDigits(n: number): string {
  const h = Math.floor(n / 100);
  const r = n % 100;
  return [h ? `${ONES[h]} Hundred` : '', r ? twoDigits(r) : ''].filter(Boolean).join(' ');
}

/** Indian numbering words: 1250000 paise → "Rupees Twelve Thousand Five Hundred Only"; lakh/crore system. */
export function amountInWords(paise: Paise): string {
  assertPaise(paise);
  if (paise < 0) return `Minus ${amountInWords(-paise)}`;
  let r = Math.floor(paise / 100);
  const p = paise % 100;
  const parts: string[] = [];
  const crore = Math.floor(r / 10_000_000); r %= 10_000_000;
  const lakh = Math.floor(r / 100_000); r %= 100_000;
  const thousand = Math.floor(r / 1000); r %= 1000;
  if (crore) parts.push(`${crore >= 100 ? threeDigits(crore) : twoDigits(crore)} Crore`);
  if (lakh) parts.push(`${twoDigits(lakh)} Lakh`);
  if (thousand) parts.push(`${twoDigits(thousand)} Thousand`);
  if (r) parts.push(threeDigits(r));
  const rupees = parts.length ? parts.join(' ') : 'Zero';
  return `Rupees ${rupees}${p ? ` and ${twoDigits(p)} Paise` : ''} Only`;
}

// ------------------------------------------------------------------------------------------------ policy
export const FEE_CATEGORY_KINDS = ['tuition', 'admission', 'exam', 'transport', 'library', 'activity', 'other'] as const;
export type FeeCategoryKind = (typeof FEE_CATEGORY_KINDS)[number];
export const PAYMENT_MODES = ['cash', 'upi', 'bank_transfer', 'cheque', 'card'] as const;
export type PaymentMode = (typeof PAYMENT_MODES)[number];
export const CONCESSION_KINDS = ['scholarship', 'sibling', 'staff_ward', 'merit', 'other'] as const;

export interface FeePolicy {
  /** Receipt prefix (D-06 default: school code, upper-case). Numbering is per financial year, one series. */
  receiptPrefix: string;
  invoicePrefix: string;
  /** D-07 default: concessions up to these limits are auto-approved for `discounts:apply` holders without `discounts:approve`. */
  concessionAutoApprove: { maxPercentBps: number; maxFlatPaise: Paise };
  /** Overpayment is kept as advance credit only if the cashier ticks "keep as advance" (D-08/doc 11). */
  allowAdvance: boolean;
}

export const defaultFeePolicy = (schoolCode: string): FeePolicy => ({
  receiptPrefix: schoolCode.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 10) || 'RCPT',
  invoicePrefix: 'INV',
  concessionAutoApprove: { maxPercentBps: 500, maxFlatPaise: 50_000 },
  allowAdvance: true,
});
