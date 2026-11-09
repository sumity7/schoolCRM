import type { Request, RequestHandler } from 'express';
import { parse as parseCookie } from 'cookie';
import type { Env } from '../../config/env';
import { AppError } from '../../core/errors';
import { runWithTenant } from '../../core/tenancy/context';
import type { AuthContext } from '../../core/http/types';
import { users } from './auth.repository';
import { resolveTenantContext } from './context.service';
import type { SessionService } from './session.service';
import type { IUser } from '../users/user.model';

export function cookieName(env: Env): string {
  // `__Host-` prefix (Secure, Path=/, no Domain) in production; plain name on http://localhost dev.
  return env.COOKIE_SECURE ? '__Host-edunex_sid' : 'edunex_sid';
}

export function readSessionToken(req: Request, env: Env): string | undefined {
  const header = req.headers.cookie;
  if (!header) return undefined;
  return parseCookie(header)[cookieName(env)];
}

/**
 * Loads session → user → active membership → tenant context on every request (nothing cached in the cookie).
 * Runs the rest of the chain INSIDE the tenant AsyncLocalStorage context, so repositories are scoped by construction.
 * `X-Active-Membership` is a consistency ASSERTION only (stale-tab protection) — never an authority.
 */
export function attachAuth(env: Env, sessionService: SessionService): RequestHandler {
  return async (req, _res, next) => {
    try {
      const token = readSessionToken(req, env);
      const session = await sessionService.resolve(token);
      if (!session) return next();
      const user = (await users.findById(session.userId, 'auth: load session user')) as (IUser & { _id: import('mongoose').Types.ObjectId }) | null;
      if (!user || user.status !== 'active') return next();

      const resolved = await resolveTenantContext(user, session.activeMembershipId);
      const auth: AuthContext = {
        user: { _id: user._id, name: user.name, email: user.email, phone: user.phone, passwordHash: user.passwordHash, platformRole: user.platformRole, status: user.status },
        session: { _id: session._id, userId: session.userId, activeMembershipId: session.activeMembershipId, rememberMe: session.rememberMe },
        tenant: resolved?.tenant,
        school: resolved ? { _id: resolved.school._id, name: resolved.school.name, code: resolved.school.code, status: resolved.school.status, settings: resolved.school.settings as never, limits: resolved.school.limits } : undefined,
      };
      req.auth = auth;

      const asserted = req.headers['x-active-membership'];
      if (typeof asserted === 'string' && asserted.length > 0) {
        const actual = resolved ? String(resolved.tenant.membershipId) : '';
        if (asserted !== actual) {
          return next(new AppError(409, 'TENANT_CONTEXT_CHANGED', 'Your active school changed in another tab. Reloading is required.'));
        }
      }

      if (resolved) return runWithTenant(resolved.tenant, () => next());
      next();
    } catch (err) {
      next(err);
    }
  };
}
