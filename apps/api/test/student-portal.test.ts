import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { addDays } from '@edunex/shared';
import { setupTestDb, teardownTestDb, clearAll } from './helpers/db';
import { Client, loggedIn, makeTestApp } from './helpers/app';
import { buildExamData, buildSchoolData, seedStudentLogin, todayIst, type SchoolData } from './helpers/fixtures';
import { studentLoginId } from '../src/modules/users/student-access.service';
import { _auditRowsForTest } from '../src/core/audit/audit.service';
import { authTokens } from '../src/modules/auth/auth.repository';
import { hashToken } from '../src/modules/auth/crypto';

const t = makeTestApp();
const { app } = t;
let A: SchoolData;
let B: SchoolData;
const today = todayIst();
beforeAll(setupTestDb);
afterAll(teardownTestDb);
beforeEach(async () => {
  await clearAll();
  A = await buildSchoolData(app, 'alpha');
  B = await buildSchoolData(app, 'bravo');
});

const tokenOf = (url: string) => /token=([A-Za-z0-9_-]+)/.exec(url)![1]!;

describe('REQ-STU-ACC student accounts', () => {
  it('login id format; staff issue one-time activation (no password ever seen); student chooses own password; link is single-use', async () => {
    expect(studentLoginId('SR/2019 045', 'Alpha')).toBe('sr-2019-045@alpha.student');
    expect((await A.teacher.post(`/students/${A.studentsA[0]}/portal-access`)).status).toBe(403); // teacher cannot issue
    expect((await B.owner.post(`/students/${A.studentsA[0]}/portal-access`)).status).toBe(404); // other school
    const issued = await A.owner.post(`/students/${A.studentsA[0]}/portal-access`);
    expect(issued.status).toBe(201);
    expect(issued.body.data.loginId).toBe('alpha-a1@alpha.student');
    expect(JSON.stringify(issued.body)).not.toMatch(/password/i);
    const status = await A.owner.get(`/students/${A.studentsA[0]}/portal-access`);
    expect(status.body.data).toMatchObject({ exists: true, status: 'invited', loginId: 'alpha-a1@alpha.student' });
    expect(JSON.stringify(status.body)).not.toMatch(/passwordHash|token/i);
    expect((await new Client(app).login('alpha-a1@alpha.student', 'Anything-123')).status).toBe(401); // not usable before activation
    const token = tokenOf(issued.body.data.activationUrl);
    expect((await new Client(app).post('/auth/accept-invite', { token, password: 'short' })).status).toBe(400); // weak password refused
    expect((await new Client(app).post('/auth/accept-invite', { token, password: 'My-Own-Pass-77' })).status).toBe(204);
    expect((await new Client(app).post('/auth/accept-invite', { token, password: 'Other-Pass-88' })).status).toBe(400); // single use
    const me = await (await loggedIn(app, 'alpha-a1@alpha.student', 'My-Own-Pass-77')).get('/auth/me');
    expect(me.body.data.roleKeys).toEqual(['student']);
    const actions = (await _auditRowsForTest({ schoolId: A.school.schoolId })).map((r) => r.action);
    expect(actions).toContain('students.portal_access_issued');
  });

  it('disable ends sessions at once; reissue = reset (old password dead, old sessions revoked); withdrawn students are locked out', async () => {
    const s = await seedStudentLogin(app, A, A.studentsA[0]!);
    expect((await s.client.get('/student/me')).status).toBe(200);
    expect((await A.owner.post(`/students/${A.studentsA[0]}/portal-access/disable`)).status).toBe(204);
    expect((await s.client.get('/student/me')).status).toBe(401);
    const fresh = new Client(app);
    expect((await fresh.login(s.loginId, s.password)).body.data.memberships).toEqual([]); // may authenticate, but belongs to no school
    expect((await fresh.get('/student/me')).status).toBe(403);
    expect((await A.owner.post(`/students/${A.studentsA[0]}/portal-access/enable`)).status).toBe(204);
    const c2 = await loggedIn(app, s.loginId, s.password);
    expect((await c2.get('/student/me')).status).toBe(200);

    const reissued = await A.owner.post(`/students/${A.studentsA[0]}/portal-access`);
    expect((await c2.get('/student/me')).status).toBe(401); // sessions revoked
    expect((await new Client(app).login(s.loginId, s.password)).status).toBe(401); // old password gone
    await new Client(app).post('/auth/accept-invite', { token: tokenOf(reissued.body.data.activationUrl), password: 'Brand-New-Pass-5' });
    const c3 = await loggedIn(app, s.loginId, 'Brand-New-Pass-5');
    expect((await c3.get('/student/me')).status).toBe(200);

    await A.owner.post(`/students/${A.studentsA[0]}/status`, { status: 'withdrawn' });
    expect((await c3.get('/student/me')).status).toBe(403); // login exists, student no longer active
    expect((await A.owner.post(`/students/${A.studentsA[0]}/portal-access`)).status).toBe(409); // cannot issue for inactive students
  });
});

describe('REQ-STU-PORTAL student portal', () => {
  it('students reach only their own record; every staff/parent/finance API refuses them; they cannot edit attendance', async () => {
    const s = await seedStudentLogin(app, A, A.studentsA[0]!);
    const me = await s.client.get('/student/me');
    expect(me.body.data.profile).toMatchObject({ name: 'Asha1 Rao', admissionNo: 'alpha-A1' });
    expect(me.body.data.class).toMatchObject({ className: 'Class 5', sectionName: 'A', rollNo: 1 });
    expect(JSON.stringify(me.body)).not.toContain('Asha2'); // no classmate data
    for (const path of ['/students', `/students/${A.studentsA[0]}`, '/students/export.csv', '/staff', '/users', '/audit-logs', '/fees/invoices', '/fees/payments', '/imports', '/attendance/reports/low-attendance', '/parent/children', '/exams', '/sections', '/classes']) {
      expect((await s.client.get(path)).status, path).toBeGreaterThanOrEqual(403);
    }
    expect((await s.client.put(`/attendance/sections/${A.sectionA}`, { date: today, entries: [{ studentId: A.studentsA[0], status: 'present' }] })).status).toBe(403);
    expect((await s.client.post('/notices', { title: 'Student post', body: 'x', audience: 'everyone' })).status).toBe(403);
    expect((await A.owner.get('/student/me')).status).toBe(403); // staff are not students
  });

  it('attendance (read-only, own), low-attendance flag, class history', async () => {
    const s = await seedStudentLogin(app, A, A.studentsA[0]!);
    await A.owner.put(`/attendance/sections/${A.sectionA}`, { date: today, entries: [{ studentId: A.studentsA[0], status: 'absent' }, { studentId: A.studentsA[1], status: 'present' }] });
    const att = await s.client.get(`/student/me/attendance?from=${addDays(today, -7)}&to=${today}`);
    expect(att.body.data.records).toEqual([{ date: today, status: 'absent', remark: null }]);
    expect(att.body.data.summary).toMatchObject({ markedDays: 1, absent: 1, percentage: 0 });
    expect((await s.client.get(`/student/me/attendance?from=${today}&to=${addDays(today, -1)}`)).status).toBe(400);
    expect((await s.client.get('/student/me')).body.data.attendance).toMatchObject({ today: 'absent', low: false }); // fewer than 5 marked days: no warning yet
    const hist = (await s.client.get('/student/me/history')).body.data;
    expect(hist).toHaveLength(1);
    expect(hist[0]).toMatchObject({ className: 'Class 5', sectionName: 'A', status: 'active' });
  });

  it('only PUBLISHED results; rank hidden unless the school enables it; report card only for own result', async () => {
    const s = await seedStudentLogin(app, A, A.studentsA[0]!);
    const ex = await buildExamData(A); // computed but NOT published
    expect((await s.client.get('/student/me/results')).body.data).toEqual([]);
    await A.owner.post(`/exams/${ex.examId}/results/publish`);
    const rows = (await s.client.get('/student/me/results')).body.data;
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ examName: 'Unit test 1', percentage: 80, rank: null });
    expect((await s.client.get(`/student/me/results/${rows[0].id}/report-card.pdf`)).status).toBe(200);
    const others = (await A.owner.get(`/exams/${ex.examId}/results?sectionId=${A.sectionA}`)).body.data as Array<{ id: string; studentId: string }>;
    const classmate = others.find((r) => r.studentId === A.studentsA[1])!;
    expect((await s.client.get(`/student/me/results/${classmate.id}/report-card.pdf`)).status).toBe(404);
    expect((await A.owner.patch('/schools/me/settings', { portalPolicy: { studentsSeeRank: true } })).status).toBe(200);
    expect((await s.client.get('/student/me/results')).body.data[0].rank).toBe(1);
  });

  it('fees are hidden by default and shown only if the school policy allows; notices respect audience', async () => {
    const s = await seedStudentLogin(app, A, A.studentsA[0]!);
    expect((await s.client.get('/student/me/fees')).status).toBe(404);
    expect((await s.client.get('/student/me')).body.data.fees).toBeNull();
    await A.owner.patch('/schools/me/settings', { portalPolicy: { studentsSeeFees: true } });
    expect((await s.client.get('/student/me/fees')).status).toBe(200);
    for (const n of [
      { title: 'Staff only', audience: 'staff' }, { title: 'Parents only', audience: 'parents' }, { title: 'Everyone', audience: 'everyone' },
      { title: 'Class 5A only', audience: 'sections', sectionIds: [A.sectionA] }, { title: 'Class 5B only', audience: 'sections', sectionIds: [A.sectionB] },
    ]) await A.owner.post('/notices', { body: 'x', ...n });
    const titles = ((await s.client.get('/notices')).body.data as Array<{ title: string }>).map((n) => n.title).sort();
    expect(titles).toEqual(['Class 5A only', 'Everyone']);
  });

  it("two schools: each student sees only their own school's record; school A staff cannot reach school B's student access", async () => {
    const sA = await seedStudentLogin(app, A, A.studentsA[0]!);
    const sB = await seedStudentLogin(app, B, B.studentsA[0]!);
    expect((await sA.client.get('/student/me')).body.data.profile.admissionNo).toBe('alpha-A1');
    expect((await sB.client.get('/student/me')).body.data.profile.admissionNo).toBe('bravo-A1');
    expect((await A.owner.get(`/students/${B.studentsA[0]}/portal-access`)).status).toBe(404);
  });
});

describe('REQ-STU-ACT activation token security (A1)', () => {
  const accept = (token: string, password = 'My-Own-Pass-77', extra: Record<string, unknown> = {}) => new Client(app).post('/auth/accept-invite', { token, password, ...extra });
  const issue = async (sd: SchoolData, id: string) => tokenOf((await sd.owner.post(`/students/${id}/portal-access`)).body.data.activationUrl);

  it('invalid, malformed, expired, reused and revoked tokens all fail with the SAME generic message (no enumeration, nothing changes)', async () => {
    const generic = 'This link is invalid or has expired';
    const bogus = await accept('x'.repeat(43));
    expect(bogus.status).toBe(400);
    expect(bogus.body.error.message).toBe(generic);
    expect((await accept('short')).status).toBe(400); // schema-level rejection, still no hint about existence

    const expiredTok = await issue(A, A.studentsA[0]!);
    await authTokens.updateOne({ tokenHash: hashToken(expiredTok) }, { $set: { expiresAt: new Date(Date.now() - 1000) } }, 'test: expire');
    const expired = await accept(expiredTok);
    expect(expired.status).toBe(400);
    expect(expired.body.error.message).toBe(generic);
    expect((await new Client(app).login('alpha-a1@alpha.student', 'My-Own-Pass-77')).status).toBe(401); // expired link set nothing

    const first = await issue(A, A.studentsA[1]!);
    expect((await accept(first)).status).toBe(204);
    const reused = await accept(first, 'Another-Pass-99');
    expect(reused.body.error.message).toBe(generic);
    expect((await new Client(app).login('alpha-a2@alpha.student', 'Another-Pass-99')).status).toBe(401); // reuse cannot change the password

    const old = await issue(A, A.studentsA[2]!);
    const fresh = await issue(A, A.studentsA[2]!); // re-issuing voids the previous link
    expect((await accept(old)).body.error.message).toBe(generic);
    expect((await accept(fresh)).status).toBe(204);

    // disabling access while a link is outstanding revokes it
    const pending = await issue(A, A.studentsA[0]!);
    expect((await A.owner.post(`/students/${A.studentsA[0]}/portal-access/disable`)).status).toBe(204);
    expect((await accept(pending)).body.error.message).toBe(generic);
    expect((await new Client(app).login('alpha-a1@alpha.student', 'My-Own-Pass-77')).status).toBe(401);
  });

  it('a link only ever activates the student it was issued for, in its own school; the activation page cannot rename the student', async () => {
    const tok = await issue(A, A.studentsA[0]!);
    const before = (await A.owner.get(`/students/${A.studentsA[0]}`)).body.data;
    expect((await accept(tok, 'My-Own-Pass-77', { name: 'Totally Different Person' })).status).toBe(204);
    const c = await loggedIn(app, 'alpha-a1@alpha.student', 'My-Own-Pass-77');
    const me = (await c.get('/auth/me')).body.data;
    expect(me.user.name).toBe([before.firstName, before.lastName].filter(Boolean).join(' '));
    expect((await c.get('/student/me')).body.data.profile.admissionNo).toBe(before.admissionNo);
    // school B staff cannot issue for / read / disable school A's student, and school B's student login is separate
    for (const call of [() => B.owner.post(`/students/${A.studentsA[0]}/portal-access`), () => B.owner.get(`/students/${A.studentsA[0]}/portal-access`), () => B.owner.post(`/students/${A.studentsA[0]}/portal-access/disable`)]) expect((await call()).status).toBe(404);
    const bTok = await issue(B, B.studentsA[0]!);
    expect((await accept(bTok)).status).toBe(204);
    const bMe = (await (await loggedIn(app, 'bravo-a1@bravo.student', 'My-Own-Pass-77')).get('/student/me')).body.data.profile;
    expect(bMe.admissionNo).not.toBe(before.admissionNo);
  });

  it('weak passwords are refused without consuming the link; an unactivated student has no session and no student routes; audit never holds secrets', async () => {
    const tok = await issue(A, A.studentsA[0]!);
    for (const weak of ['short', 'alllowercaseletters', '12345678901234']) expect((await accept(tok, weak)).status, weak).toBe(400);
    const anon = new Client(app);
    expect((await anon.get('/student/me')).status).toBe(401);
    expect((await new Client(app).login('alpha-a1@alpha.student', 'My-Own-Pass-77')).status).toBe(401);
    expect((await accept(tok)).status).toBe(204); // link still worked after the refused attempts
    const rows = await _auditRowsForTest({ schoolId: A.school.schoolId });
    const dump = JSON.stringify(rows);
    expect(rows.map((r) => r.action)).toEqual(expect.arrayContaining(['students.portal_access_issued', 'auth.invite_accepted']));
    expect(dump).not.toContain(tok);
    expect(dump).not.toContain('My-Own-Pass-77');
    expect(dump).not.toMatch(/passwordHash|tokenHash|activationUrl/);
  });
});
