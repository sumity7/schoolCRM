import { z } from 'zod';

// ---------------------------------------------------------------------------
// Error codes shared by API and UI (doc 07 §0)
// ---------------------------------------------------------------------------
export const ERROR_CODES = [
  'UNAUTHENTICATED',
  'FORBIDDEN',
  'NOT_FOUND',
  'CONFLICT',
  'VALIDATION_FAILED',
  'RATE_LIMITED',
  'ENTITLEMENT_REQUIRED',
  'IDEMPOTENCY_MISMATCH',
  'TENANT_CONTEXT_CHANGED',
  'CSRF_REJECTED',
  'ACCOUNT_LOCKED',
  'INTERNAL',
] as const;
export type ErrorCode = (typeof ERROR_CODES)[number];

export interface ApiErrorBody {
  error: {
    code: ErrorCode;
    message: string;
    requestId?: string;
    details?: Array<{ path: string; message: string }>;
  };
}

export interface PageMeta {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

// ---------------------------------------------------------------------------
// Primitive schemas
// ---------------------------------------------------------------------------
export const objectIdSchema = z.string().regex(/^[a-f\d]{24}$/i, 'Invalid id');

/** Calendar day as YYYY-MM-DD, validated as a real date. */
export const dayStringSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected YYYY-MM-DD')
  .refine((s) => isValidDay(s), 'Not a valid calendar date');

export function isValidDay(s: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const dt = new Date(Date.UTC(y, mo - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === mo - 1 && dt.getUTCDate() === d;
}

/** Today's calendar day in a given IANA timezone. */
export function todayInTz(tz: string, now: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
  return parts; // en-CA => YYYY-MM-DD
}

/** ISO weekday (1=Mon … 7=Sun) of a calendar day. */
export function isoWeekday(day: string): number {
  const [y, m, d] = day.split('-').map(Number) as [number, number, number];
  const wd = new Date(Date.UTC(y, m - 1, d)).getUTCDay(); // 0=Sun
  return wd === 0 ? 7 : wd;
}

export function addDays(day: string, n: number): string {
  const [y, m, d] = day.split('-').map(Number) as [number, number, number];
  const dt = new Date(Date.UTC(y, m - 1, d + n));
  return dt.toISOString().slice(0, 10);
}

export const paginationQuerySchema = z
  .object({
    page: z.coerce.number().int().min(1).default(1),
    limit: z.coerce.number().int().min(1).max(100).default(25),
  })
  .strict();

// ---------------------------------------------------------------------------
// Identifier handling (D-03: email OR phone; model stays flexible)
// ---------------------------------------------------------------------------
export type IdentifierKind = 'email' | 'phone';

export function normalizeEmail(s: string): string {
  return s.trim().toLowerCase();
}

/** Normalises Indian-style phone input to E.164-ish (+91XXXXXXXXXX) when possible. */
export function normalizePhone(s: string): string | null {
  const digits = s.replace(/[^\d+]/g, '');
  if (/^\+\d{8,15}$/.test(digits)) return digits;
  const only = digits.replace(/\D/g, '');
  if (/^\d{10}$/.test(only)) return `+91${only}`;
  if (/^0\d{10}$/.test(only)) return `+91${only.slice(1)}`;
  if (/^91\d{10}$/.test(only)) return `+${only}`;
  return null;
}

export function classifyIdentifier(raw: string): { kind: IdentifierKind; value: string } | null {
  const t = raw.trim();
  if (t.includes('@')) {
    const e = normalizeEmail(t);
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e) ? { kind: 'email', value: e } : null;
  }
  const p = normalizePhone(t);
  return p ? { kind: 'phone', value: p } : null;
}

// ---------------------------------------------------------------------------
// Money — integer paise only
// ---------------------------------------------------------------------------
export const paiseSchema = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);

export function rupeesToPaise(rupees: number): number {
  return Math.round(rupees * 100);
}
export function formatInr(paise: number): string {
  return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' }).format(paise / 100);
}
