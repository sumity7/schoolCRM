import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { setupTestDb, teardownTestDb, clearAll } from './helpers/db';
import { Client, loggedIn, makeTestApp, TEST_PASSWORD } from './helpers/app';
import { buildSchoolData, type SchoolData } from './helpers/fixtures';
import { base32Decode, base32Encode, decryptSecret, encryptSecret, totpAt, verifyTotp } from '../src/modules/auth/totp';
import { createSuperAdmin } from '../src/modules/schools/schools.service';
import { _auditRowsForTest } from '../src/core/audit/audit.service';

describe('REQ-MFA TOTP primitives', () => {
  it('matches the RFC 6238 SHA-1 test vectors and round-trips base32', () => {
    const secret = base32Encode(Buffer.from('12345678901234567890'));
    expect(secret).toBe('GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ');
    expect(base32Decode(secret).toString()).toBe('12345678901234567890');
    // RFC 6238 Appendix B (8-digit codes; the last 6 digits are the 6-digit code)
    expect(totpAt(secret, 59_000)).toBe('287082');
    expect(totpAt(secret, 1_111_111_109_000)).toBe('081804');
    expect(totpAt(secret, 1_234_567_890_000)).toBe('005924');
    expect(totpAt(secret, 2_000_000_000_000)).toBe('279037');
    expect(verifyTotp(secret, '287082', 59_000)).toBe(true);
    expect(verifyTotp(secret, totpAt(secret, 59_000 - 30_000), 59_000)).toBe(true); // one step of clock drift
    expect(verifyTotp(secret, totpAt(secret, 59_000 + 90_000), 59_000)).toBe(false); // three steps away
    expect(verifyTotp(secret, 'abcdef', 59_000)).toBe(false);
  });
  it('stores secrets encrypted; tampering or the wrong key fails', () => {
    const blob = encryptSecret('JBSWY3DPEHPK3PXP', 'k'.repeat(32));
    expect(blob).not.toContain('JBSWY3DPEHPK3PXP');
    expect(decryptSecret(blob, 'k'.repeat(32))).toBe('JBSWY3DPEHPK3PXP');
    expect(() => decryptSecret(blob, 'x'.repeat(32))).toThrow();
    const parts = blob.split('.');
    parts[2] = Buffer.from('AAAAAAAAAAAAAAAA').toString('base64');
    expect(() => decryptSecret(parts.join('.'), 'k'.repeat(32))).toThrow();
  });
});

const t = makeTestApp();
const { app } = t;
let A: SchoolData;
beforeAll(setupTestDb);
afterAll(teardownTestDb);
beforeEach(async () => {
  await clearAll();
  t.email.outbox.length = 0;
  A = await buildSchoolData(app, 'alpha');
});

async function enableMfa(c: Client): Promise<string> {
  const setup = await c.post('/auth/mfa/setup');
  expect(setup.status, JSON.stringify(setup.body)).toBe(200);
  expect(setup.body.data.otpauthUrl).toMatch(/^otpauth:\/\/totp\//);
  const secret = setup.body.data.secret as string;
  expect((await c.post('/auth/mfa/enable', { code: '000000' === totpAt(secret, Date.now()) ? '111111' : '000000' })).status).toBe(400);
  expect((await c.post('/auth/mfa/enable', { code: totpAt(secret, Date.now()) })).status).toBe(204);
  return secret;
}

describe('REQ-PLT Super Admin console with mandatory MFA', () => {
  it('platform routes need super_admin AND two-factor; sign-in is two-step; nothing about schools leaks before the code', async () => {
    await createSuperAdmin({ email: 'root@edunex.test', name: 'Root', password: TEST_PASSWORD });
    const root = await loggedIn(app, 'root@edunex.test');
    expect((await root.get('/platform/overview')).status).toBe(403); // MFA not set up yet
    expect((await A.owner.get('/platform/overview')).status).toBe(403); // school owner is not platform staff
    const secret = await enableMfa(root);
    expect((await root.post('/auth/mfa/disable', { password: TEST_PASSWORD, code: totpAt(secret, Date.now()) })).status).toBe(409); // staff keep MFA

    const fresh = new Client(app);
    const login = await fresh.login('root@edunex.test');
    expect(login.status).toBe(200);
    expect(login.body.data.mfa).toEqual({ enabled: true, pending: true });
    expect(login.body.data.memberships).toEqual([]);
    expect((await fresh.get('/platform/overview')).status).toBe(401);
    expect((await fresh.get('/auth/me')).body.data.mfa.pending).toBe(true);
    expect((await fresh.post('/auth/mfa/verify', { code: '123456' === totpAt(secret, Date.now()) ? '654321' : '123456' })).status).toBe(401);
    expect((await fresh.post('/auth/mfa/verify', { code: totpAt(secret, Date.now()) })).status).toBe(204);
    const ov = await fresh.get('/platform/overview');
    expect(ov.status).toBe(200);
    expect(ov.body.data).toMatchObject({ schools: 1, activeStudents: 6 });

    // create a school → owner invited
    const created = await fresh.post('/platform/schools', { name: 'Bravo Public School', code: 'bravo-ps', ownerName: 'B Owner', ownerEmail: 'owner@bravo-ps.test', limits: { students: 300, staff: 30 } });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    expect(t.email.lastTo('owner@bravo-ps.test')?.text).toMatch(/accept-invite\?token=/);
    expect((await fresh.post('/platform/schools', { name: 'Dup', code: 'bravo-ps', ownerName: 'x', ownerEmail: 'x@y.test' })).status).toBe(409);
    const list = (await fresh.get('/platform/schools')).body.data as Array<{ code: string; usage: { students: number }; limits: { students: number } }>;
    expect(list.find((s) => s.code === 'alpha')!.usage.students).toBe(6);
    expect(list.find((s) => s.code === 'bravo-ps')!.limits.students).toBe(300);
    expect(JSON.stringify(list)).not.toMatch(/Asha|alpha-A1/); // counts only — no student data in the console

    // suspend → the school's users lose access at once; reactivate → back
    const alphaId = list.find((s) => s.code === 'alpha') as unknown as { id: string };
    expect((await fresh.patch(`/platform/schools/${alphaId.id}`, { status: 'suspended' })).status).toBe(400); // reason required
    expect((await fresh.patch(`/platform/schools/${alphaId.id}`, { status: 'suspended', reason: 'Unpaid subscription' })).status).toBe(200);
    expect((await A.owner.get('/schools/me')).status).not.toBe(200);
    expect((await fresh.patch(`/platform/schools/${alphaId.id}`, { status: 'live', reason: 'Paid' })).status).toBe(200);
    expect((await (await loggedIn(app, A.school.ownerEmail)).get('/schools/me')).status).toBe(200);
    const audit = (await fresh.get('/platform/audit?limit=100')).body.data.map((a: { action: string }) => a.action);
    expect(audit).toEqual(expect.arrayContaining(['platform.school_updated', 'platform.school_provisioned', 'auth.mfa_enabled', 'auth.mfa_verified', 'auth.mfa_failed']));
  });

  it('support staff can look but not change; school users may opt into MFA and then need the code too', async () => {
    await createSuperAdmin({ email: 'help@edunex.test', name: 'Help', password: TEST_PASSWORD, role: 'support' });
    const help = await loggedIn(app, 'help@edunex.test');
    await enableMfa(help);
    expect((await help.get('/platform/schools')).status).toBe(200);
    const id = (await help.get('/platform/schools')).body.data[0].id;
    expect((await help.patch(`/platform/schools/${id}`, { status: 'suspended', reason: 'x'.repeat(5) })).status).toBe(403);
    expect((await help.post('/platform/schools', { name: 'Nope', code: 'nope', ownerName: 'n', ownerEmail: 'n@n.test' })).status).toBe(403);

    const secret = await enableMfa(A.owner);
    const c = new Client(app);
    await c.login(A.school.ownerEmail);
    expect((await c.get('/students')).status).toBe(401); // school data waits for the code
    expect((await c.post('/auth/mfa/verify', { code: totpAt(secret, Date.now()) })).status).toBe(204);
    expect((await c.get('/students')).status).toBe(200);
    expect((await c.post('/auth/mfa/disable', { password: 'wrong-password-1', code: totpAt(secret, Date.now()) })).status).toBe(401);
    expect((await c.post('/auth/mfa/disable', { password: TEST_PASSWORD, code: totpAt(secret, Date.now()) })).status).toBe(204);
    const rows = await _auditRowsForTest({ action: 'auth.mfa_disabled' });
    expect(rows).toHaveLength(1);
  });
});
