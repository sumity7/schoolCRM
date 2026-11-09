import type { ApiErrorBody, ErrorCode, PageMeta } from '@edunex/shared';

/**
 * Browser API client. Same-origin (`/api/v1/...`, proxied to Express — ADR-2).
 * Sends the CSRF custom header on every request. `X-Active-Membership` is a stale-tab ASSERTION only:
 * the server derives the tenant from the session and answers 409 TENANT_CONTEXT_CHANGED on mismatch.
 */
export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: ErrorCode | 'NETWORK',
    message: string,
    public readonly details?: Array<{ path: string; message: string }>,
    public readonly requestId?: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

let activeMembershipId: string | null = null;
export function setActiveMembershipHeader(id: string | null) {
  activeMembershipId = id;
}

type Json = Record<string, unknown> | unknown[] | null;

export interface ApiResponse<T> {
  data: T;
  meta?: PageMeta;
}

export async function api<T = unknown>(method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE', path: string, body?: Json | undefined, opts: { idempotencyKey?: string } = {}): Promise<ApiResponse<T>> {
  const headers: Record<string, string> = { 'X-Requested-With': 'edunex', Accept: 'application/json' };
  if (activeMembershipId) headers['X-Active-Membership'] = activeMembershipId;
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (opts.idempotencyKey) headers['Idempotency-Key'] = opts.idempotencyKey;

  let res: Response;
  try {
    res = await fetch(`/api/v1${path}`, { method, headers, credentials: 'same-origin', body: body === undefined ? undefined : JSON.stringify(body) });
  } catch {
    throw new ApiError(0, 'NETWORK', 'Cannot reach the server. Check your connection and try again.');
  }
  if (res.status === 204) return { data: undefined as T };
  const json = (await res.json().catch(() => null)) as (ApiResponse<T> & Partial<ApiErrorBody>) | null;
  if (!res.ok) {
    const e = json?.error;
    const err = new ApiError(res.status, e?.code ?? 'INTERNAL', e?.message ?? 'Something went wrong', e?.details, e?.requestId);
    if (err.code === 'TENANT_CONTEXT_CHANGED' && typeof window !== 'undefined') {
      window.location.reload(); // another tab switched school — never keep acting on a stale view
    }
    throw err;
  }
  return json as ApiResponse<T>;
}

export const get = <T,>(path: string) => api<T>('GET', path);
export const post = <T,>(path: string, body: Json = {}, opts?: { idempotencyKey?: string }) => api<T>('POST', path, body, opts);
export const patch = <T,>(path: string, body: Json) => api<T>('PATCH', path, body);
export const del = <T,>(path: string) => api<T>('DELETE', path);
export const put = <T,>(path: string, body: Json) => api<T>('PUT', path, body);

/** Human-readable message for any thrown value (API errors carry server text; details are appended). */
export function errorText(e: unknown, fallback = 'Something went wrong'): string {
  if (e instanceof ApiError) {
    const extra = e.details?.length ? ` — ${e.details.map((d) => d.message).join('; ')}` : '';
    return `${e.message}${extra}`;
  }
  return fallback;
}

/** Fetches a file (CSV) with the same headers as API calls and hands it to the browser as a download. */
export async function downloadFile(path: string, fallbackName = 'download.csv'): Promise<void> {
  const headers: Record<string, string> = { 'X-Requested-With': 'edunex' };
  if (activeMembershipId) headers['X-Active-Membership'] = activeMembershipId;
  let res: Response;
  try {
    res = await fetch(`/api/v1${path}`, { headers, credentials: 'same-origin' });
  } catch {
    throw new ApiError(0, 'NETWORK', 'Cannot reach the server. Check your connection and try again.');
  }
  if (!res.ok) {
    const json = (await res.json().catch(() => null)) as Partial<ApiErrorBody> | null;
    throw new ApiError(res.status, json?.error?.code ?? 'INTERNAL', json?.error?.message ?? 'Download failed', json?.error?.details);
  }
  const blob = await res.blob();
  const name = /filename="([^"]+)"/.exec(res.headers.get('Content-Disposition') ?? '')?.[1] ?? fallbackName;
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export const newIdempotencyKey = () => (typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`);
