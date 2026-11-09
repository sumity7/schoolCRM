import request from 'supertest';
import type { Express } from 'express';
import type { Types } from 'mongoose';
import { loadEnv } from '../../src/config/env';
import { createApp } from '../../src/app';
import { createLogger } from '../../src/core/logging/logger';
import { DevEmailAdapter } from '../../src/core/notifications/email';
import { provisionSchool } from '../../src/modules/schools/schools.service';
import { users, memberships } from '../../src/modules/auth/auth.repository';
import { hashPassword } from '../../src/modules/auth/crypto';

export const TEST_ORIGIN = 'http://localhost:3000';
export const TEST_PASSWORD = 'Correct-Horse-9';

export function makeTestApp(envOverrides: Record<string, string> = {}, limiters?: Parameters<typeof createApp>[0]['limiters']) {
  const env = loadEnv({
    NODE_ENV: 'test',
    RATE_LIMIT_ENABLED: 'false',
    ALLOWED_ORIGINS: TEST_ORIGIN,
    LOG_LEVEL: 'silent',
    ...envOverrides,
  } as NodeJS.ProcessEnv);
  const email = new DevEmailAdapter(undefined, null);
  const built = createApp({ env, logger: createLogger('silent'), email, limiters });
  return { ...built, env, email };
}

/** A browser-like client: keeps cookies, always sends the headers the CSRF guard requires. */
export class Client {
  readonly agent: ReturnType<typeof request.agent>;
  constructor(app: Express, private readonly extraHeaders: Record<string, string> = {}) {
    this.agent = request.agent(app);
  }
  private h(headers: Record<string, string> = {}) {
    return { Origin: TEST_ORIGIN, 'X-Requested-With': 'edunex', ...this.extraHeaders, ...headers };
  }
  get(path: string, headers?: Record<string, string>) {
    return this.agent.get(`/api/v1${path}`).set(this.h(headers));
  }
  post(path: string, body: unknown = {}, headers?: Record<string, string>) {
    return this.agent.post(`/api/v1${path}`).set(this.h(headers)).send(body as object);
  }
  patch(path: string, body: unknown = {}, headers?: Record<string, string>) {
    return this.agent.patch(`/api/v1${path}`).set(this.h(headers)).send(body as object);
  }
  put(path: string, body: unknown = {}, headers?: Record<string, string>) {
    return this.agent.put(`/api/v1${path}`).set(this.h(headers)).send(body as object);
  }
  delete(path: string, headers?: Record<string, string>) {
    return this.agent.delete(`/api/v1${path}`).set(this.h(headers));
  }
  async login(identifier: string, password = TEST_PASSWORD) {
    return this.post('/auth/login', { identifier, password });
  }
}

export interface SeededSchool {
  schoolId: Types.ObjectId;
  code: string;
  ownerEmail: string;
  ownerMembershipId: Types.ObjectId;
}

/** Provisions a school, then activates its owner directly (skipping the email round-trip) with a known password. */
export async function seedSchool(code: string, opts: { limits?: { students: number; staff: number } } = {}): Promise<SeededSchool> {
  const ownerEmail = `owner@${code}.test`;
  const { school, membershipId, ownerUserId } = await provisionSchool(
    { name: `School ${code}`, code, owner: { name: `Owner ${code}`, email: ownerEmail }, limits: opts.limits },
    { appBaseUrl: 'http://localhost:3000' },
  );
  await users.updateOne({ _id: ownerUserId }, { $set: { passwordHash: await hashPassword(TEST_PASSWORD), status: 'active' } }, 'test: activate owner');
  await memberships.updateOne({ _id: membershipId }, { $set: { status: 'active' } }, 'test: activate owner membership');
  return { schoolId: school._id, code, ownerEmail, ownerMembershipId: membershipId };
}

/** Creates an ACTIVE user with the given roles in a school (bypasses the invite email flow). */
export async function seedMember(
  schoolId: Types.ObjectId,
  email: string,
  roleKeys: string[],
  opts: { personType?: 'staff' | 'guardian' | 'student' | 'owner'; name?: string; password?: string } = {},
) {
  let user = await users.findOne({ email }, 'test: find user');
  if (!user) {
    user = await users.create({ email, name: opts.name ?? email.split('@')[0]!, passwordHash: await hashPassword(opts.password ?? TEST_PASSWORD), status: 'active', failedLogins: 0 }, 'test: create user');
  }
  const membership = await memberships.create({ schoolId, userId: user._id, roleKeys, personType: opts.personType ?? 'staff', status: 'active' }, 'test: create membership');
  return { userId: user._id, membershipId: membership._id, email };
}

export async function loggedIn(app: Express, email: string, password = TEST_PASSWORD) {
  const c = new Client(app);
  const res = await c.login(email, password);
  if (res.status !== 200) throw new Error(`login failed for ${email}: ${res.status} ${JSON.stringify(res.body)}`);
  return c;
}
