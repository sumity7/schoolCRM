import type { Response } from 'express';
import { Types } from 'mongoose';
import { z } from 'zod';
import { acceptInviteSchema, changePasswordSchema, forgotPasswordSchema, loginSchema, objectIdSchema, resetPasswordSchema, selectSchoolSchema } from '@edunex/shared';
import type { Env } from '../../config/env';
import { notFound } from '../../core/errors';
import type { Registrar } from '../../core/http/route';
import type { AuthService } from './auth.service';
import type { SessionService } from './session.service';
import { cookieName, readSessionToken } from './auth.middleware';
import { sessions } from './auth.repository';
import { toObjectId } from '../../core/tenancy/repository';
import { users } from './auth.repository';
import type { IUser } from '../users/user.model';
import { registerMfaRoutes } from './mfa.routes';
import { DEMO_ACCOUNTS, DEMO_PASSWORD } from './demo-accounts';
import { verifyPassword } from './crypto';

type UserRow = IUser & { _id: Types.ObjectId };

export function registerAuthRoutes(r: Registrar, deps: { env: Env; auth: AuthService; sessions: SessionService }) {
  const { env, auth, sessions: sessionService } = deps;
  registerMfaRoutes(r, { env, sessions: sessionService });

  // Development-only: lists demo accounts that REALLY exist (and whose demo password really works). The route does not
  // exist at all unless the server flag is on, so production answers 404. It never logs anyone in.
  if (env.DEMO_LOGIN_ENABLED) {
    r.define({
      method: 'get', path: '/auth/demo-accounts', summary: 'DEV ONLY: demo accounts available on the login page', tenancy: 'none', auth: 'public',
      async handler() {
        const out = [];
        for (const d of DEMO_ACCOUNTS) {
          const u = (await users.findOne({ email: d.identifier }, 'demo: verify account exists')) as (UserRow & { passwordHash?: string }) | null;
          let ok = Boolean(u && u.status === 'active' && (await verifyPassword(u.passwordHash, DEMO_PASSWORD)));
          if (ok && u) ok = d.platform ? Boolean(u.platformRole) : (await auth.activeMemberships(u._id)).length > 0;
          out.push(ok ? { key: d.key, label: d.label, description: d.description, available: true, identifier: d.identifier, password: DEMO_PASSWORD } : { key: d.key, label: d.label, description: d.description, available: false });
        }
        return { data: out };
      },
    });
  }

  const cookieOpts = (maxAgeMs?: number) => ({
    httpOnly: true,
    secure: env.COOKIE_SECURE,
    sameSite: 'lax' as const,
    path: '/',
    ...(maxAgeMs ? { maxAge: maxAgeMs } : {}),
  });
  const clearCookie = (res: Response) => res.clearCookie(cookieName(env), cookieOpts());

  const currentUser = async (req: { auth?: { user: { _id: Types.ObjectId } } }): Promise<UserRow> => {
    const row = (await users.findById(req.auth!.user._id, 'auth: current user')) as UserRow | null;
    if (!row) throw notFound('User');
    return row;
  };

  r.define({
    method: 'post', path: '/auth/login', summary: 'Log in with email or phone + password', tenancy: 'none', auth: 'public', rateClass: 'auth',
    body: loginSchema, audit: { exempt: 'AuthService records auth.login / auth.login_failed itself' },
    async handler({ body, req, res }) {
      const prev = await sessionService.resolve(readSessionToken(req, env)); // rotate: a pre-existing session never survives login
      const result = await auth.login(body, { ip: req.ip, userAgent: req.get('user-agent') ?? undefined }, prev as never);
      res.cookie(cookieName(env), result.token, cookieOpts(result.maxAgeMs));
      return { data: result.me };
    },
  });

  r.define({
    method: 'post', path: '/auth/logout', summary: 'Log out (revokes this session)', tenancy: 'none', auth: 'session', allowMfaPending: true,
    body: z.object({}).strict(), audit: { exempt: 'AuthService records auth.logout' },
    async handler({ auth: a, res }) {
      await auth.logout(null, { _id: a!.session._id } as never);
      clearCookie(res);
      return { status: 204 };
    },
  });

  r.define({
    method: 'post', path: '/auth/logout-all', summary: 'Revoke every session of this user', tenancy: 'none', auth: 'session',
    body: z.object({}).strict(), audit: { exempt: 'AuthService records auth.logout_all' },
    async handler({ req, res }) {
      await auth.logoutAll(await currentUser(req));
      clearCookie(res);
      return { status: 204 };
    },
  });

  r.define({
    method: 'get', path: '/auth/me', summary: 'Current user, active school, permissions (UI hints only), memberships', tenancy: 'none', auth: 'session', allowMfaPending: true,
    async handler({ req }) {
      const user = await currentUser(req);
      const sessionRow = (await sessions.findById(req.auth!.session._id, 'auth: me session')) as never;
      return { data: await auth.buildMe(user as never, sessionRow) };
    },
  });

  r.define({
    method: 'post', path: '/auth/select-school', summary: 'Choose / switch the active school (membership)', tenancy: 'none', auth: 'session',
    body: selectSchoolSchema, audit: { exempt: 'AuthService records auth.switch_school' },
    async handler({ body, req }) {
      const user = await currentUser(req);
      const sessionRow = (await sessions.findById(req.auth!.session._id, 'auth: select session')) as never;
      return { data: await auth.selectSchool(user as never, sessionRow, new Types.ObjectId(body.membershipId)) };
    },
  });

  r.define({
    method: 'post', path: '/auth/forgot-password', summary: 'Request a password-reset link (always 202)', tenancy: 'none', auth: 'public', rateClass: 'auth',
    body: forgotPasswordSchema, audit: { exempt: 'AuthService records auth.password_reset_requested when a user exists' },
    async handler({ body }) {
      await auth.forgotPassword(body.identifier);
      return { status: 202, data: { message: 'If an account exists, a reset link has been sent.' } };
    },
  });

  r.define({
    method: 'post', path: '/auth/reset-password', summary: 'Set a new password using a single-use token', tenancy: 'none', auth: 'public', rateClass: 'auth',
    body: resetPasswordSchema, audit: { exempt: 'AuthService records auth.password_reset' },
    async handler({ body }) {
      await auth.resetPassword(body.token, body.password);
      return { status: 204 };
    },
  });

  r.define({
    method: 'post', path: '/auth/change-password', summary: 'Change own password (revokes other sessions)', tenancy: 'none', auth: 'session', rateClass: 'sensitive',
    body: changePasswordSchema, audit: { exempt: 'AuthService records auth.password_changed' },
    async handler({ body, req }) {
      const user = await currentUser(req);
      const sessionRow = (await sessions.findById(req.auth!.session._id, 'auth: change-password session')) as never;
      await auth.changePassword(user as never, sessionRow, body.currentPassword, body.newPassword);
      return { status: 204 };
    },
  });

  r.define({
    method: 'post', path: '/auth/accept-invite', summary: 'Accept an invitation (sets password for new users)', tenancy: 'none', auth: 'public', rateClass: 'auth',
    body: acceptInviteSchema, audit: { exempt: 'AuthService records auth.invite_accepted' },
    async handler({ body }) {
      await auth.acceptInvite(body.token, body.password, body.name);
      return { status: 204 };
    },
  });

  r.define({
    method: 'get', path: '/auth/sessions', summary: 'List own active sessions', tenancy: 'none', auth: 'session',
    async handler({ req }) {
      const rows = await sessionService.listForUser(req.auth!.user._id);
      return {
        data: rows.map((s) => ({
          id: String(s._id),
          lastSeenAt: s.lastSeenAt,
          expiresAt: s.expiresAt,
          ip: s.ip,
          userAgent: s.userAgent,
          current: String(s._id) === String(req.auth!.session._id),
        })),
      };
    },
  });

  r.define({
    method: 'delete', path: '/auth/sessions/:id', summary: 'Revoke one of own sessions', tenancy: 'none', auth: 'session',
    params: z.object({ id: objectIdSchema }).strict(), audit: { exempt: 'low-risk own-session housekeeping; logout is audited' },
    idParams: { id: 'session' },
    async handler({ params, req, res }) {
      const oid = toObjectId(params.id)!;
      const row = await sessions.findOne({ _id: oid, userId: req.auth!.user._id, revokedAt: null }, 'auth: revoke own session');
      if (!row) throw notFound('Session');
      await sessionService.revoke(oid);
      if (String(oid) === String(req.auth!.session._id)) clearCookie(res);
      return { status: 204 };
    },
  });
}
