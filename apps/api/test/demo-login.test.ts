import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { setupTestDb, teardownTestDb, clearAll } from './helpers/db';
import { Client, makeTestApp } from './helpers/app';
import { buildSchoolData } from './helpers/fixtures';
import { loadEnv } from '../src/config/env';
import { DEMO_ACCOUNTS, DEMO_PASSWORD } from '../src/modules/auth/demo-accounts';
import { ensureDemoAccounts } from '../scripts/lib/demo-seed';

const off = makeTestApp(); // NODE_ENV=test, flag unset → demo login OFF
const on = makeTestApp({ DEMO_LOGIN_ENABLED: 'true' });

beforeAll(setupTestDb);
afterAll(teardownTestDb);
beforeEach(clearAll);

type Demo = { key: string; label: string; available: boolean; identifier?: string; password?: string };

describe('REQ-DEMO login-page demo accounts (development only)', () => {
  it('the server flag is development-only: default on in development, off elsewhere, and refused in production/staging', () => {
    const base = { COOKIE_SECURE: 'true', DATABASE_URL: 'mongodb+srv://x', APP_BASE_URL: 'https://app.example.test', ALLOWED_ORIGINS: 'https://app.example.test', TRUST_PROXY_HOPS: '1', MFA_ENCRYPTION_KEY: 'a-long-random-production-key-0123456789' };
    expect(loadEnv({ NODE_ENV: 'development' } as NodeJS.ProcessEnv).DEMO_LOGIN_ENABLED).toBe(true);
    expect(loadEnv({ NODE_ENV: 'test' } as NodeJS.ProcessEnv).DEMO_LOGIN_ENABLED).toBe(false);
    expect(loadEnv({ NODE_ENV: 'development', DEMO_LOGIN_ENABLED: 'false' } as NodeJS.ProcessEnv).DEMO_LOGIN_ENABLED).toBe(false);
    expect(loadEnv({ ...base, NODE_ENV: 'production' } as NodeJS.ProcessEnv).DEMO_LOGIN_ENABLED).toBe(false);
    expect(() => loadEnv({ ...base, NODE_ENV: 'production', DEMO_LOGIN_ENABLED: 'true' } as NodeJS.ProcessEnv)).toThrow(/DEMO_LOGIN_ENABLED/);
    expect(() => loadEnv({ ...base, NODE_ENV: 'staging', DEMO_LOGIN_ENABLED: '1' } as NodeJS.ProcessEnv)).toThrow(/DEMO_LOGIN_ENABLED/);
  });

  it('when the flag is off the route does not exist (404) and nothing about demo accounts is revealed', async () => {
    await buildSchoolData(off.app, 'demo', { students: 3 });
    const res = await new Client(off.app).get('/auth/demo-accounts');
    expect(res.status).toBe(404);
    expect(JSON.stringify(res.body)).not.toMatch(/owner@demo|Correct-Horse/);
    expect(off.registrar.manifest.some((m) => m.path.endsWith('/auth/demo-accounts'))).toBe(false);
    expect(on.registrar.manifest.some((m) => m.path.endsWith('/auth/demo-accounts'))).toBe(true);
  });

  it('lists only accounts that really exist; unconfigured roles carry NO credentials', async () => {
    await buildSchoolData(on.app, 'demo', { students: 3 }); // owner@demo.test + tina@demo.test only
    const res = await new Client(on.app).get('/auth/demo-accounts');
    expect(res.status).toBe(200);
    const by = new Map((res.body.data as Demo[]).map((d) => [d.key, d]));
    expect([...by.keys()]).toEqual(DEMO_ACCOUNTS.map((d) => d.key));
    expect(by.get('school_admin')).toMatchObject({ available: true, identifier: 'owner@demo.test', password: DEMO_PASSWORD });
    expect(by.get('teacher')).toMatchObject({ available: true, identifier: 'tina@demo.test', password: DEMO_PASSWORD });
    for (const k of ['super_admin', 'accountant', 'parent', 'student']) {
      expect(by.get(k)!.available, k).toBe(false);
      expect(Object.keys(by.get(k)!).sort(), k).toEqual(['available', 'description', 'key', 'label']); // no identifier, no password
    }
  });

  it('after the idempotent seeder every listed credential really works and lands on the right role; running it again changes nothing', async () => {
    const first = await ensureDemoAccounts(on.app);
    expect(first.created.length).toBeGreaterThanOrEqual(5);
    const second = await ensureDemoAccounts(on.app);
    expect(second.created).toEqual([]);

    const list = (await new Client(on.app).get('/auth/demo-accounts')).body.data as Demo[];
    expect(list.every((d) => d.available)).toBe(true);
    const expected: Record<string, { roleKeys?: string[]; platformRole?: string }> = {
      super_admin: { platformRole: 'super_admin' }, school_admin: { roleKeys: ['owner'] }, teacher: { roleKeys: ['teacher'] },
      accountant: { roleKeys: ['accountant'] }, parent: { roleKeys: ['parent'] }, student: { roleKeys: ['student'] },
    };
    for (const d of list) {
      const c = new Client(on.app);
      const login = await c.login(d.identifier!, d.password!); // the NORMAL login: password verified, session + CSRF applied
      expect(login.status, d.key).toBe(200);
      const me = (await c.get('/auth/me')).body.data;
      if (expected[d.key]!.platformRole) { expect(me.platformRole).toBe('super_admin'); expect(me.activeMembershipId).toBeNull(); }
      else expect(me.roleKeys, d.key).toEqual(expected[d.key]!.roleKeys);
    }
  });

  it('the demo list never bypasses authentication: wrong password is rejected, and a changed password makes the account unavailable', async () => {
    await ensureDemoAccounts(on.app);
    expect((await new Client(on.app).login('owner@demo.test', 'Not-The-Password-1')).status).toBe(401);
    const owner = new Client(on.app);
    await owner.login('owner@demo.test', DEMO_PASSWORD);
    expect((await owner.post('/auth/change-password', { currentPassword: DEMO_PASSWORD, newPassword: 'Changed-Secret-77' })).status).toBe(204);
    const list = (await new Client(on.app).get('/auth/demo-accounts')).body.data as Demo[];
    const admin = list.find((d) => d.key === 'school_admin')!;
    expect(admin.available).toBe(false); // the listed password no longer works, so it is not offered
    expect(admin.password).toBeUndefined();
    // the endpoint is read-only: it cannot create sessions
    const anon = new Client(on.app);
    await anon.get('/auth/demo-accounts');
    expect((await anon.get('/auth/me')).status).toBe(401);
  });
});
