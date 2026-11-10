import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { addDays } from '@edunex/shared';
import { setupTestDb, teardownTestDb, clearAll } from './helpers/db';
import { Client, loggedIn, makeTestApp, seedMember } from './helpers/app';
import { buildSchoolData, seedParent, seedStudentLogin, todayIst, type SchoolData } from './helpers/fixtures';
import { JobQueue, registerJobHandler } from '../src/core/jobs/job-queue';
import { JobModel } from '../src/core/jobs/job.model';
import { runAsPlatform, runWithTenant } from '../src/core/tenancy/context';
import { makeCtx } from './helpers/tenant';
import { _auditRowsForTest } from '../src/core/audit/audit.service';

const t = makeTestApp();
const { app } = t;
let A: SchoolData;
let B: SchoolData;
const today = todayIst();
let k = 0;
const key = () => `pn-${Date.now()}-${k++}`;

beforeAll(setupTestDb);
afterAll(teardownTestDb);
beforeEach(async () => {
  await clearAll();
  t.email.outbox.length = 0;
  A = await buildSchoolData(app, 'alpha');
  B = await buildSchoolData(app, 'bravo');
});

// ------------------------------------------------------------------------------------------------ job queue
describe('REQ-JOB background job queue (ADR-5)', () => {
  it('runs jobs in the school context, retries with backoff, dead-letters, de-duplicates by key and recovers expired leases', async () => {
    const seen: string[] = [];
    let failuresLeft = 2;
    registerJobHandler('test.ok', async (p) => { seen.push(String(p.n)); });
    registerJobHandler('test.flaky', async () => { if (failuresLeft-- > 0) throw new Error('transient'); seen.push('flaky-ok'); });
    registerJobHandler('test.bad', async () => { throw new Error('always'); });
    const ctx = makeCtx(A.school.schoolId);
    await runWithTenant(ctx, async () => {
      await JobQueue.enqueue('test.ok', { n: 1 }, { key: 'once' });
      await JobQueue.enqueue('test.ok', { n: 2 }, { key: 'once' }); // same key → not queued twice
      await JobQueue.enqueue('test.flaky', {}, { maxAttempts: 5 });
      await JobQueue.enqueue('test.bad', {}, { maxAttempts: 2 });
    });
    await JobQueue.drain();
    expect(seen).toEqual(['1']);
    // retries are scheduled in the future: pull them forward to simulate time passing
    for (let i = 0; i < 4; i++) {
      await runAsPlatform('test: time travel', async () => JobModel.updateMany({ status: 'queued' }, { $set: { runAt: new Date(Date.now() - 1000) } }));
      await JobQueue.drain();
    }
    expect(seen).toEqual(['1', 'flaky-ok']);
    const jobs = await runAsPlatform('test: read jobs', async () => JobModel.find({ schoolId: A.school.schoolId }).lean());
    expect(jobs.map((j) => `${j.type}:${j.status}:${j.attempts}`).sort()).toEqual(['test.bad:dead:2', 'test.flaky:done:3', 'test.ok:done:1']);
    expect(jobs.find((j) => j.type === 'test.bad')!.lastError).toBe('always');

    // a crashed worker's lease expires and the job is picked up again
    await runWithTenant(ctx, () => JobQueue.enqueue('test.ok', { n: 3 }));
    await runAsPlatform('test: simulate crash', async () => JobModel.updateOne({ 'payload.n': 3 }, { $set: { status: 'running', lockedUntil: new Date(Date.now() - 1000), lockedBy: 'dead-worker' } }));
    await JobQueue.drain();
    expect(seen).toContain('3');
  });
});

// ------------------------------------------------------------------------------------------------ parents
describe('REQ-PAR parent portal (acceptance scenario 2)', () => {
  it('invitation needs a verified, portal-enabled guardian with an email; accepting it gives a parent login', async () => {
    const add = await A.owner.post(`/students/${A.studentsA[1]}/guardians`, { name: 'Meena Rao', phone: '9822222222', email: 'meena@parents.test', relationship: 'mother' });
    const linkId = add.body.data.linkId as string;
    expect((await A.owner.post(`/students/${A.studentsA[1]}/guardians/${linkId}/portal-invite`)).status).toBe(409); // not verified
    await A.owner.patch(`/students/${A.studentsA[1]}/guardians/${linkId}`, { verified: true });
    expect((await A.owner.post(`/students/${A.studentsA[1]}/guardians/${linkId}/portal-invite`)).status).toBe(409); // portal off
    await A.owner.patch(`/students/${A.studentsA[1]}/guardians/${linkId}`, { portalAccess: true });
    expect((await A.teacher.post(`/students/${A.studentsA[1]}/guardians/${linkId}/portal-invite`)).status).toBe(403);
    const inv = await A.owner.post(`/students/${A.studentsA[1]}/guardians/${linkId}/portal-invite`);
    expect(inv.status, JSON.stringify(inv.body)).toBe(201);
    const token = /token=([A-Za-z0-9_-]+)/.exec(t.email.lastTo('meena@parents.test')!.text)![1]!;
    expect((await new Client(app).post('/auth/accept-invite', { token, password: 'Parent-Pass-123' })).status).toBe(204);
    const parent = await loggedIn(app, 'meena@parents.test', 'Parent-Pass-123');
    const kids = await parent.get('/parent/children');
    expect(kids.status).toBe(200);
    expect(kids.body.data.map((c: { admissionNo: string }) => c.admissionNo)).toEqual(['alpha-A2']);
    // phone-only guardian cannot be invited (no SMS)
    const ravi = (await A.owner.get(`/students/${A.studentsA[0]}/guardians`)).body.data[0];
    await A.owner.patch(`/students/${A.studentsA[0]}/guardians/${ravi.linkId}`, { verified: true });
    await A.owner.patch(`/students/${A.studentsA[0]}/guardians/${ravi.linkId}`, { portalAccess: true });
    expect((await A.owner.post(`/students/${A.studentsA[0]}/guardians/${ravi.linkId}/portal-invite`)).status).toBe(400);
  });

  it("a parent sees only their own linked children; another child is 404; ending the link or turning portal access off bites on the next request", async () => {
    const p = await seedParent(app, A, A.studentsA[0]!, 'ravi@parents.test');
    expect((await p.client.get(`/parent/children/${A.studentsA[0]}/attendance?from=${addDays(today, -7)}&to=${today}`)).status).toBe(200);
    expect((await p.client.get(`/parent/children/${A.studentsA[1]}/attendance?from=${addDays(today, -7)}&to=${today}`)).status).toBe(404); // classmate
    expect((await p.client.get(`/parent/children/${B.studentsA[0]}/attendance?from=${addDays(today, -7)}&to=${today}`)).status).toBe(404); // other school
    // staff APIs stay closed to parents
    expect((await p.client.get('/students')).status).toBe(403);
    expect((await p.client.get(`/students/${A.studentsA[0]}`)).status).toBe(403);
    expect((await p.client.get('/fees/invoices')).status).toBe(403);
    expect((await p.client.get('/attendance/reports/low-attendance')).status).toBe(403);
    // staff are not parents
    expect((await A.owner.get('/parent/children')).status).toBe(403);

    expect((await A.owner.patch(`/students/${A.studentsA[0]}/guardians/${p.linkId}`, { portalAccess: false })).status).toBe(200);
    expect((await p.client.get('/parent/children')).body.data).toEqual([]);
    expect((await p.client.get(`/parent/children/${A.studentsA[0]}/attendance?from=${today}&to=${today}`)).status).toBe(404);
    await A.owner.patch(`/students/${A.studentsA[0]}/guardians/${p.linkId}`, { verified: true });
    await A.owner.patch(`/students/${A.studentsA[0]}/guardians/${p.linkId}`, { portalAccess: true });
    expect((await p.client.get('/parent/children')).body.data).toHaveLength(1);
    await A.owner.patch(`/students/${A.studentsA[0]}/guardians/${p.linkId}`, { ended: true }); // e.g. custody order
    expect((await p.client.get(`/parent/children/${A.studentsA[0]}/attendance?from=${today}&to=${today}`)).status).toBe(404);
  });

  it('siblings share one login; attendance and fees are visible, receipts only for their own child, fees only if allowed', async () => {
    const p = await seedParent(app, A, A.studentsA[0]!, 'ravi@parents.test');
    // link the same guardian to a second child (sibling) — verified + portal
    const sib = await A.owner.post(`/students/${A.studentsA[1]}/guardians`, { name: 'Ravi Rao', phone: '9811111111', relationship: 'father', existingGuardianId: p.guardianId });
    await A.owner.patch(`/students/${A.studentsA[1]}/guardians/${sib.body.data.linkId}`, { verified: true });
    await A.owner.patch(`/students/${A.studentsA[1]}/guardians/${sib.body.data.linkId}`, { portalAccess: true });
    await A.owner.put(`/attendance/sections/${A.sectionA}`, { date: today, entries: [{ studentId: A.studentsA[0], status: 'absent' }, { studentId: A.studentsA[1], status: 'present' }] });
    const kids = (await p.client.get('/parent/children')).body.data as Array<{ admissionNo: string; attendance: { today: string } }>;
    expect(kids.map((c) => `${c.admissionNo}:${c.attendance.today}`).sort()).toEqual(['alpha-A1:absent', 'alpha-A2:present']);

    // fees: bill and pay for child 1 and for a classmate (child 3)
    const cat = await A.owner.post('/fees/categories', { key: 'tuition', name: 'Tuition', kind: 'tuition' });
    const st = await A.owner.post('/fees/structures', { sessionId: A.sessionId, classId: A.classId, name: 'S', items: [{ categoryId: cat.body.data.id, installments: [{ label: 'Q1', dueDate: today, amountPaise: 100_000 }] }] });
    await A.owner.post(`/fees/structures/${st.body.data.id}/publish`);
    await A.owner.post('/fees/invoices/generate', { structureId: st.body.data.id, installmentLabel: 'Q1', sectionId: A.sectionA }, { 'Idempotency-Key': key() });
    const mine = await A.owner.post('/fees/payments', { studentId: A.studentsA[0], amountPaise: 40_000, mode: 'cash', paidOn: today }, { 'Idempotency-Key': key() });
    const other = await A.owner.post('/fees/payments', { studentId: A.studentsA[2], amountPaise: 40_000, mode: 'cash', paidOn: today }, { 'Idempotency-Key': key() });
    const fees = await p.client.get(`/parent/children/${A.studentsA[0]}/fees`);
    expect(fees.body.data.totals).toMatchObject({ billedPaise: 100_000, paidPaise: 40_000, balancePaise: 60_000 });
    expect((await p.client.get(`/parent/children/${A.studentsA[0]}/payments/${mine.body.data.payment.id}/receipt.pdf`)).status).toBe(200);
    expect((await p.client.get(`/parent/children/${A.studentsA[0]}/payments/${other.body.data.payment.id}/receipt.pdf`)).status).toBe(404); // classmate's receipt
    expect((await p.client.get(`/parent/children/${A.studentsA[2]}/payments/${other.body.data.payment.id}/receipt.pdf`)).status).toBe(404); // not my child
    await A.owner.patch(`/students/${A.studentsA[0]}/guardians/${p.linkId}`, { canViewFees: false });
    expect((await p.client.get(`/parent/children/${A.studentsA[0]}/fees`)).status).toBe(403);
    expect((await p.client.get('/parent/children')).body.data.find((c: { admissionNo: string }) => c.admissionNo === 'alpha-A1').fees).toBeNull();
  });
});

// ------------------------------------------------------------------------------------------------ notices
describe('REQ-NOT notices', () => {
  it('section notices reach exactly that section: parents, emails (deduplicated, idempotent), teachers; others never see them', async () => {
    const pA = await seedParent(app, A, A.studentsA[0]!, 'ravi@parents.test');
    // give section B a parent too, and a second (sibling) link for Ravi's email via another guardian record with the same email
    const bKid = A.studentsB[0]!;
    const g = await A.owner.post(`/students/${bKid}/guardians`, { name: 'Bina Iyer', phone: '9833333333', email: 'bina@parents.test', relationship: 'mother' });
    await A.owner.patch(`/students/${bKid}/guardians/${g.body.data.linkId}`, { verified: true });
    const pB = await (async () => {
      await A.owner.patch(`/students/${bKid}/guardians/${g.body.data.linkId}`, { portalAccess: true });
      const guardians = (await A.owner.get(`/students/${bKid}/guardians`)).body.data;
      const pm = await seedMember(A.school.schoolId, 'bina@parents.test', ['parent'], { personType: 'guardian' });
      const { memberships } = await import('../src/modules/auth/auth.repository');
      const { Types } = await import('mongoose');
      await memberships.updateOne({ _id: pm.membershipId }, { $set: { personId: new Types.ObjectId(guardians[0].guardianId) } }, 'test');
      return loggedIn(app, 'bina@parents.test');
    })();
    // two section-A children whose guardians share one email address → one email
    for (const sid of [A.studentsA[1], A.studentsA[2]]) {
      const x = await A.owner.post(`/students/${sid}/guardians`, { name: 'Shared Family', phone: '9844444444', email: 'family@parents.test', relationship: 'guardian' });
      await A.owner.patch(`/students/${sid}/guardians/${x.body.data.linkId}`, { verified: true });
    }
    // an UNVERIFIED guardian in section A gets nothing
    const u = await A.owner.post(`/students/${A.studentsA[1]}/guardians`, { name: 'Not Verified', phone: '9855555555', email: 'unverified@parents.test', relationship: 'other' });
    expect(u.status).toBe(201);

    const n = await A.owner.post('/notices', { title: 'Picnic for 5A', body: 'Bring lunch.', audience: 'sections', sectionIds: [A.sectionA], emailParents: true });
    expect(n.status).toBe(201);
    expect(await JobQueue.drain()).toBe(1);
    const sent = t.email.outbox.filter((m) => m.subject.includes('Picnic')).map((m) => m.to).sort();
    expect(sent).toEqual(['family@parents.test']); // Ravi has no email (phone only); Bina is section B; unverified excluded; shared address once
    // retry safety: re-run the job → no duplicate email
    await runAsPlatform('test: re-queue', async () => JobModel.updateMany({ type: 'notice.email' }, { $set: { status: 'queued', runAt: new Date(0) } }));
    await JobQueue.drain();
    expect(t.email.outbox.filter((m) => m.subject.includes('Picnic'))).toHaveLength(1);

    const seenBy = async (c: Client) => ((await c.get('/notices')).body.data as Array<{ title: string }>).map((x) => x.title);
    expect(await seenBy(pA.client)).toContain('Picnic for 5A');
    expect(await seenBy(pB)).not.toContain('Picnic for 5A');
    expect(await seenBy(A.teacher)).toContain('Picnic for 5A'); // teaches 5A
    expect(await seenBy(B.owner)).not.toContain('Picnic for 5A'); // other school

    // read receipts + unread count
    const list = await pA.client.get('/notices');
    expect(list.body.meta.unread).toBe(1);
    expect((await pA.client.post(`/notices/${n.body.data.id}/read`)).status).toBe(204);
    expect((await pA.client.post(`/notices/${n.body.data.id}/read`)).status).toBe(204); // idempotent
    expect((await pA.client.get('/notices')).body.meta.unread).toBe(0);
    expect((await pB.post(`/notices/${n.body.data.id}/read`)).status).toBe(404); // cannot read what you cannot see
    const stats = await A.owner.get(`/notices/${n.body.data.id}/stats`);
    expect(stats.body.data).toEqual({ reads: 1, emails: { sent_dev: 1 } });

    // withdraw hides it from parents
    expect((await A.teacher.post(`/notices/${n.body.data.id}/withdraw`)).status).toBe(403); // not the author
    expect((await A.owner.post(`/notices/${n.body.data.id}/withdraw`)).status).toBe(200);
    expect(await seenBy(pA.client)).not.toContain('Picnic for 5A');
    expect((await _auditRowsForTest({ schoolId: A.school.schoolId })).map((r) => r.action)).toEqual(expect.arrayContaining(['notices.published', 'notices.withdrawn']));
  });

  it('teachers post only to their own sections; parents cannot post; staff-only notices stay away from parents', async () => {
    const pA = await seedParent(app, A, A.studentsA[0]!, 'ravi@parents.test');
    expect((await A.teacher.post('/notices', { title: 'All school', body: 'x', audience: 'everyone' })).status).toBe(403);
    expect((await A.teacher.post('/notices', { title: 'For 5B', body: 'x', audience: 'sections', sectionIds: [A.sectionB] })).status).toBe(403);
    expect((await A.teacher.post('/notices', { title: 'For 5A', body: 'Homework', audience: 'sections', sectionIds: [A.sectionA] })).status).toBe(201);
    expect((await A.owner.post('/notices', { title: 'Cross school', body: 'x', audience: 'sections', sectionIds: [B.sectionA] })).status).toBe(404);
    expect((await pA.client.post('/notices', { title: 'Parent post', body: 'x', audience: 'everyone' })).status).toBe(403);
    await A.owner.post('/notices', { title: 'Staff meeting', body: 'Friday 4pm', audience: 'staff' });
    await A.owner.post('/notices', { title: 'Holiday', body: 'Monday off', audience: 'everyone' });
    const parentSees = ((await pA.client.get('/notices')).body.data as Array<{ title: string }>).map((x) => x.title).sort();
    expect(parentSees).toEqual(['For 5A', 'Holiday']);
    const teacherSees = ((await A.teacher.get('/notices')).body.data as Array<{ title: string }>).map((x) => x.title).sort();
    expect(teacherSees).toEqual(['For 5A', 'Holiday', 'Staff meeting']);
  });
});

// ------------------------------------------------------------------------------------------------ child switching (A2/A3)
describe('REQ-PAR-SW parent child switching, profile overview and school contact', () => {
  const linkSibling = async (p: Awaited<ReturnType<typeof seedParent>>, studentId: string) => {
    const l = await A.owner.post(`/students/${studentId}/guardians`, { name: 'Ravi Rao', phone: '9811111111', relationship: 'father', existingGuardianId: p.guardianId });
    await A.owner.patch(`/students/${studentId}/guardians/${l.body.data.linkId}`, { verified: true });
    await A.owner.patch(`/students/${studentId}/guardians/${l.body.data.linkId}`, { portalAccess: true });
    return l.body.data.linkId as string;
  };

  it('one child or many: the list contains exactly the linked children, and each child-specific endpoint answers for THAT child only', async () => {
    const p = await seedParent(app, A, A.studentsA[0]!, 'ravi@parents.test');
    expect(((await p.client.get('/parent/children')).body.data as unknown[]).length).toBe(1);
    const sibLink = await linkSibling(p, A.studentsA[1]!);
    await A.owner.put(`/attendance/sections/${A.sectionA}`, { date: today, entries: [{ studentId: A.studentsA[0], status: 'absent' }, { studentId: A.studentsA[1], status: 'present' }] });
    const kids = (await p.client.get('/parent/children')).body.data as Array<{ id: string; admissionNo: string }>;
    expect(kids.map((c) => c.admissionNo).sort()).toEqual(['alpha-A1', 'alpha-A2']);
    const q = `from=${today}&to=${today}`;
    for (const [id, adm, status] of [[A.studentsA[0]!, 'alpha-A1', 'absent'], [A.studentsA[1]!, 'alpha-A2', 'present']] as const) {
      const prof = await p.client.get(`/parent/children/${id}/profile`);
      expect(prof.status).toBe(200);
      expect(prof.body.data).toMatchObject({ id, admissionNo: adm, relationship: 'father' });
      expect((await p.client.get(`/parent/children/${id}/attendance?${q}`)).body.data.records[0].status).toBe(status);
    }
    // never leaks other people's contact data
    expect(Object.keys((await p.client.get(`/parent/children/${A.studentsA[0]}/profile`)).body.data).sort()).toEqual(['admissionDate', 'admissionNo', 'className', 'dob', 'gender', 'id', 'name', 'relationship', 'rollNo', 'sectionName', 'session', 'status']);

    // switching to a child that is not linked (classmate, other school, junk id) is refused on the server, whatever the UI shows
    for (const id of [A.studentsA[2]!, B.studentsA[0]!, 'not-an-id']) {
      const r = await p.client.get(`/parent/children/${id}/profile`);
      expect([400, 404], id).toContain(r.status);
      expect(JSON.stringify(r.body)).not.toMatch(/Asha3|Bala|bravo/);
    }
    // revoking one link removes only that child, immediately
    await A.owner.patch(`/students/${A.studentsA[1]}/guardians/${sibLink}`, { ended: true });
    expect((await p.client.get(`/parent/children/${A.studentsA[1]}/profile`)).status).toBe(404);
    expect((await p.client.get(`/parent/children/${A.studentsA[0]}/profile`)).status).toBe(200);
    expect(((await p.client.get('/parent/children')).body.data as unknown[]).length).toBe(1);
  });

  it('profile and school contact are parent-only and respect portal access; staff and students cannot use them', async () => {
    const p = await seedParent(app, A, A.studentsA[0]!, 'ravi@parents.test');
    const contact = await p.client.get('/parent/school-contact');
    expect(contact.status).toBe(200);
    expect(contact.body.data.name).toBeTruthy();
    expect(Object.keys(contact.body.data).sort()).toEqual(['address', 'email', 'name', 'phone']); // public contact details only
    expect((await A.owner.get('/parent/school-contact')).status).toBe(403);
    expect((await A.owner.get(`/parent/children/${A.studentsA[0]}/profile`)).status).toBe(403);
    const stu = await seedStudentLogin(app, A, A.studentsA[0]!);
    expect((await stu.client.get(`/parent/children/${A.studentsA[0]}/profile`)).status).toBe(403);
    expect((await stu.client.get('/parent/school-contact')).status).toBe(403);
    await A.owner.patch(`/students/${A.studentsA[0]}/guardians/${p.linkId}`, { portalAccess: false });
    expect((await p.client.get(`/parent/children/${A.studentsA[0]}/profile`)).status).toBe(404);
    // another school's parent cannot reach school A's child by id
    const pb = await seedParent(app, B, B.studentsA[0]!, 'ravi@bravo-parents.test');
    expect((await pb.client.get(`/parent/children/${A.studentsA[0]}/profile`)).status).toBe(404);
  });
});
