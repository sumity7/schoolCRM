import type { Request } from 'express';
import { AppError } from '../errors';

/**
 * CSRF defence for cookie-authenticated APIs (ADR-1). All of the following must hold for state-changing requests:
 *  1. JSON bodies only (no form-encoded posts a cross-site <form> could send);
 *  2. custom header `X-Requested-With: edunex` (cannot be set cross-origin without a CORS preflight, which we deny);
 *  3. `Origin`, when present, must be an allowed origin; otherwise `Sec-Fetch-Site` must not be cross-site.
 * SameSite=Lax cookies are the additional first layer. GET never mutates.
 */
export function csrfGuard(allowedOrigins: string[]) {
  const allowed = new Set(allowedOrigins.map((o) => o.replace(/\/$/, '')));
  return (req: Request): void => {
    const hasBody = Number(req.headers['content-length'] ?? 0) > 0 || req.headers['transfer-encoding'] !== undefined;
    const ct = String(req.headers['content-type'] ?? '').toLowerCase();
    if (hasBody && !ct.startsWith('application/json')) {
      throw new AppError(415, 'CSRF_REJECTED', 'Only application/json request bodies are accepted');
    }
    if (req.headers['x-requested-with'] !== 'edunex') {
      throw new AppError(403, 'CSRF_REJECTED', 'Missing or invalid request header');
    }
    const origin = req.headers.origin;
    if (typeof origin === 'string') {
      if (!allowed.has(origin.replace(/\/$/, ''))) throw new AppError(403, 'CSRF_REJECTED', 'Request origin not allowed');
      return;
    }
    const site = req.headers['sec-fetch-site'];
    if (typeof site === 'string' && site !== 'same-origin' && site !== 'none') {
      throw new AppError(403, 'CSRF_REJECTED', 'Cross-site request rejected');
    }
  };
}
