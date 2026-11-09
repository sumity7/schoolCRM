import { randomUUID } from 'node:crypto';
import type { ErrorRequestHandler, RequestHandler } from 'express';
import { rateLimit } from 'express-rate-limit';
import { ZodError } from 'zod';
import { AppError, TenantViolationError } from '../errors';
import type { Logger } from '../logging/logger';
import { runWithRequestMeta } from './request-context';
import type { RateClass } from './route';

export const requestContextMiddleware: RequestHandler = (req, res, next) => {
  const requestId = randomUUID();
  req.requestId = requestId;
  res.setHeader('X-Request-Id', requestId);
  runWithRequestMeta({ requestId, ip: req.ip, userAgent: req.get('user-agent')?.slice(0, 300) }, () => next());
};

/** API responses are never cached (private, authenticated JSON). */
export const noStore: RequestHandler = (_req, res, next) => {
  res.setHeader('Cache-Control', 'no-store');
  next();
};

function hasOperatorKey(v: unknown, depth = 0): boolean {
  if (depth > 8 || v === null || typeof v !== 'object') return false;
  if (Array.isArray(v)) return v.some((x) => hasOperatorKey(x, depth + 1));
  for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
    if (k.startsWith('$') || k.includes('.') || k === '__proto__' || k === 'constructor' || k === 'prototype') return true;
    if (hasOperatorKey(val, depth + 1)) return true;
  }
  return false;
}

/** NoSQL-injection / prototype-pollution guard: reject Mongo operator-looking keys anywhere in body or query. */
export const rejectOperatorKeys: RequestHandler = (req, _res, next) => {
  if (hasOperatorKey(req.body) || hasOperatorKey(req.query)) {
    return next(new AppError(400, 'VALIDATION_FAILED', 'Request contains disallowed keys'));
  }
  next();
};

export function notFoundHandler(): RequestHandler {
  return (_req, _res, next) => next(new AppError(404, 'NOT_FOUND', 'Route not found'));
}

export function errorHandler(log: Logger): ErrorRequestHandler {
  return (err, req, res, _next) => {
    const requestId = req.requestId;
    const send = (status: number, code: string, message: string, details?: unknown) =>
      res.status(status).json({ error: { code, message, requestId, ...(details ? { details } : {}) } });

    if (err instanceof AppError) {
      if (err.status >= 500) log.error({ err, requestId }, 'application error');
      return send(err.status, err.code, err.message, err.details);
    }
    if (err instanceof ZodError) {
      return send(400, 'VALIDATION_FAILED', 'Invalid request', err.issues.map((i) => ({ path: i.path.join('.'), message: i.message })));
    }
    if (err instanceof TenantViolationError) {
      // A tenancy guard fired: this is a server bug or an attack. Log loudly, reveal nothing.
      log.error({ err, requestId, security: true, schoolId: req.auth?.tenant?.schoolId?.toString() }, 'TENANT VIOLATION blocked');
      return send(500, 'INTERNAL', 'Something went wrong');
    }
    const e = err as { type?: string; status?: number; code?: number; name?: string };
    if (e?.type === 'entity.parse.failed') return send(400, 'VALIDATION_FAILED', 'Malformed JSON body');
    if (e?.type === 'entity.too.large') return send(413, 'VALIDATION_FAILED', 'Request body too large');
    if (e?.code === 11000) return send(409, 'CONFLICT', 'A record with the same unique value already exists');
    if (e?.name === 'CastError') return send(404, 'NOT_FOUND', 'Resource not found');
    log.error({ err, requestId }, 'unhandled error');
    return send(500, 'INTERNAL', 'Something went wrong');
  };
}

export interface LimiterConfig {
  enabled: boolean;
  /** Override max per window by class (tests). */
  overrides?: Partial<Record<RateClass, { windowMs: number; limit: number }>>;
}

const DEFAULTS: Record<RateClass, { windowMs: number; limit: number }> = {
  auth: { windowMs: 15 * 60_000, limit: 30 }, // per IP; per-account lockout is separate
  sensitive: { windowMs: 60_000, limit: 20 },
  write: { windowMs: 60_000, limit: 120 },
  read: { windowMs: 60_000, limit: 300 },
  export: { windowMs: 60 * 60_000, limit: 5 },
};

export function makeLimiters(cfg: LimiterConfig): Record<RateClass, RequestHandler> {
  const out = {} as Record<RateClass, RequestHandler>;
  for (const cls of Object.keys(DEFAULTS) as RateClass[]) {
    if (!cfg.enabled) {
      out[cls] = (_req, _res, next) => next();
      continue;
    }
    const { windowMs, limit } = cfg.overrides?.[cls] ?? DEFAULTS[cls];
    out[cls] = rateLimit({
      windowMs,
      limit,
      standardHeaders: 'draft-7',
      legacyHeaders: false,
      handler: (_req, _res, next) => next(new AppError(429, 'RATE_LIMITED', 'Too many requests, please slow down')),
    });
  }
  return out;
}
