import type { ErrorCode } from '@edunex/shared';

export class AppError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: ErrorCode,
    message: string,
    public readonly details?: Array<{ path: string; message: string }>,
  ) {
    super(message);
    this.name = 'AppError';
  }
}

export const unauthenticated = (msg = 'Authentication required') => new AppError(401, 'UNAUTHENTICATED', msg);
export const forbidden = (msg = 'You do not have permission to do that') => new AppError(403, 'FORBIDDEN', msg);
/** Cross-tenant and missing records are deliberately indistinguishable (doc 06). */
export const notFound = (what = 'Resource') => new AppError(404, 'NOT_FOUND', `${what} not found`);
export const conflict = (msg: string) => new AppError(409, 'CONFLICT', msg);
export const validationFailed = (msg: string, details?: Array<{ path: string; message: string }>) =>
  new AppError(400, 'VALIDATION_FAILED', msg, details);
export const entitlementRequired = (msg: string) => new AppError(403, 'ENTITLEMENT_REQUIRED', msg);

/** Programming/safety errors in the tenancy layer — never shown with detail to clients. */
export class TenantViolationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TenantViolationError';
  }
}
export class TenantContextMissingError extends TenantViolationError {
  constructor(op: string) {
    super(`Tenant context missing for ${op} — refusing to run an unscoped query (fail closed)`);
    this.name = 'TenantContextMissingError';
  }
}
