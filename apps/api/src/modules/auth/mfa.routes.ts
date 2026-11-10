import type { Types } from 'mongoose';
import { z } from 'zod';
import type { Env } from '../../config/env';
import { conflict, notFound, unauthenticated, validationFailed } from '../../core/errors';
import { AuditService } from '../../core/audit/audit.service';
import type { Registrar } from '../../core/http/route';
import { users } from './auth.repository';
import { verifyPassword } from './crypto';
import type { SessionService } from './session.service';
import { decryptSecret, encryptSecret, newTotpSecret, otpauthUrl, verifyTotp } from './totp';
import type { IUser } from '../users/user.model';

type UserRow = IUser & { _id: Types.ObjectId };
const code = z.string().trim().regex(/^\d{6}$/, 'Enter the 6-digit code');

/**
 * Two-factor authentication (TOTP). Mandatory for the platform console (route registrar), optional for school users.
 * Setup is two-step (setup → enable with a valid code) so a mistyped secret can never lock anyone out.
 */
export function registerMfaRoutes(r: Registrar, deps: { env: Env; sessions: SessionService }) {
  const load = async (id: Types.ObjectId) => {
    const u = (await users.findById(id, 'mfa: load user')) as UserRow | null;
    if (!u) throw notFound('User');
    return u;
  };

  r.define({
    method: 'post', path: '/auth/mfa/setup', summary: 'Start two-factor setup: returns a new secret (not active until confirmed)', tenancy: 'none', auth: 'session', rateClass: 'sensitive',
    body: z.object({}).strict(), audit: { exempt: 'Nothing changes until /auth/mfa/enable; that step is audited' },
    async handler({ auth }) {
      const u = await load(auth!.user._id);
      if (u.mfa?.enabledAt) throw conflict('Two-factor authentication is already on');
      const secret = newTotpSecret();
      await users.updateOne({ _id: u._id }, { $set: { mfaPendingSecretEnc: encryptSecret(secret, deps.env.MFA_ENCRYPTION_KEY) } }, 'mfa: store pending secret');
      return { data: { secret, otpauthUrl: otpauthUrl(secret, u.email ?? u.phone ?? u.name) } };
    },
  });

  r.define({
    method: 'post', path: '/auth/mfa/enable', summary: 'Confirm setup with a code from the authenticator app', tenancy: 'none', auth: 'session', rateClass: 'auth',
    body: z.object({ code }).strict(), audit: { exempt: 'Handler records auth.mfa_enabled' },
    async handler({ auth, body }) {
      const u = await load(auth!.user._id);
      if (!u.mfaPendingSecretEnc) throw conflict('Start the setup first');
      const secret = decryptSecret(u.mfaPendingSecretEnc, deps.env.MFA_ENCRYPTION_KEY);
      if (!verifyTotp(secret, body.code)) throw validationFailed('That code is not valid — check the time on your phone and try again');
      await users.updateOne({ _id: u._id }, { $set: { mfa: { type: 'totp', secretEnc: u.mfaPendingSecretEnc, enabledAt: new Date() }, mfaPendingSecretEnc: null } }, 'mfa: enable');
      await AuditService.record({ action: 'auth.mfa_enabled', entityType: 'user', entityId: u._id, actorUserId: u._id, schoolId: null });
      return { status: 204 };
    },
  });

  r.define({
    method: 'post', path: '/auth/mfa/verify', summary: 'Second step of sign-in: the code from the authenticator app', tenancy: 'none', auth: 'session', allowMfaPending: true, rateClass: 'auth',
    body: z.object({ code }).strict(), audit: { exempt: 'Handler records auth.mfa_verified / auth.mfa_failed' },
    async handler({ auth, body }) {
      if (!auth!.session.mfaPending) throw conflict('No code is needed for this session');
      const u = await load(auth!.user._id);
      if (!u.mfa?.secretEnc || !verifyTotp(decryptSecret(u.mfa.secretEnc, deps.env.MFA_ENCRYPTION_KEY), body.code)) {
        await AuditService.record({ action: 'auth.mfa_failed', entityType: 'user', entityId: u._id, actorUserId: u._id, schoolId: null });
        throw unauthenticated('That code is not valid');
      }
      await deps.sessions.completeMfa(auth!.session._id);
      await AuditService.record({ action: 'auth.mfa_verified', entityType: 'user', entityId: u._id, actorUserId: u._id, schoolId: null });
      return { status: 204 };
    },
  });

  r.define({
    method: 'post', path: '/auth/mfa/disable', summary: 'Turn two-factor authentication off (password + current code)', tenancy: 'none', auth: 'session', rateClass: 'sensitive',
    body: z.object({ password: z.string().min(1).max(200), code }).strict(), audit: { exempt: 'Handler records auth.mfa_disabled' },
    async handler({ auth, body }) {
      const u = await load(auth!.user._id);
      if (!u.mfa?.secretEnc) throw conflict('Two-factor authentication is not on');
      if (u.platformRole) throw conflict('Platform staff must keep two-factor authentication on');
      if (!(await verifyPassword(u.passwordHash, body.password)) || !verifyTotp(decryptSecret(u.mfa.secretEnc, deps.env.MFA_ENCRYPTION_KEY), body.code)) throw unauthenticated('Password or code is not valid');
      await users.updateOne({ _id: u._id }, { $set: { mfa: null } }, 'mfa: disable');
      await AuditService.record({ action: 'auth.mfa_disabled', entityType: 'user', entityId: u._id, actorUserId: u._id, schoolId: null });
      return { status: 204 };
    },
  });
}
