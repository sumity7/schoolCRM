import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { isPermissionKey } from '@edunex/shared';
import { setupTestDb, teardownTestDb, clearAll } from './helpers/db';
import { Client, loggedIn, makeTestApp, seedMember, seedSchool, type SeededSchool } from './helpers/app';
import { _auditRowsForTest } from '../src/core/audit/audit.service';
import { memberships, sessions } from '../src/modules/auth/auth.repository';
import mongoose, { Types } from 'mongoose';
import { buildExamData, buildFeeData, buildSchoolData, seedParent, seedStudentLogin, todayIst, type SchoolData } from './helpers/fixtures';
import { modelRegistry } from '../src/core/tenancy/registry';
import { runAsPlatform } from '../src/core/tenancy/context';
import { AttendanceCorrectionModel } from '../src/modules/attendance/attendance.model';
import type { ManifestEntry } from '../src/core/http/route';

const t = makeTestApp();
const { app, registrar } = t;
let A: SeededSchool;
let B: SeededSchool;

beforeAll(setupTestDb);
afterAll(teardownTestDb);
beforeEach(async () => {
  await clearAll();
  t.email.outbox.length = 0;
  A = await seedSchool('alpha');
  B = await seedSchool('bravo');
});

describe('REQ-RBAC route manifest (deny-by-default, doc 06 lock 4)', () => {
  const manifest: ManifestEntry[] = registrar.manifest;

  it('registers routes and has no duplicates', () => {
    expect(manifest.length).toBeGreaterThan(15);
    const keys = manifest.map((m) => `${m.method} ${m.path}`);
    expect(new Set(keys).size).toBe(keys.length);
  });
  it('every school route declares a valid permission or anyMember; platform routes declare roles', () => {
    for (const m of manifest) {
      if (m.tenancy === 'school') {
        expect(m.permission || m.anyMember, `${m.method} ${m.path}`).toBeTruthy();
        if (m.permission) expect(isPermissionKey(m.permission), `${m.permission}`).toBe(true);
        expect(m.auth).toBe('session');
      }
      if (m.tenancy === 'platform') expect(m.platformRoles?.length).toBeGreaterThan(0);
    }
  });
  it('every mutating route states audit:true or an explicit exemption reason; strict body schema present', () => {
    for (const m of manifest.filter((x) => x.mutating)) {
      expect(m.audit, `${m.method} ${m.path} lacks audit declaration`).toBeTruthy();
      if (typeof m.audit === 'object') expect(m.audit.exempt.length).toBeGreaterThan(10);
      if (m.method !== 'delete') expect(m.hasBody, `${m.method} ${m.path} needs a body schema`).toBe(true);
    }
  });
  it('own-scope grants (parents, own staff profile) reach only an explicit allow-list of routes', () => {
    const own = manifest.filter((m) => m.allowOwnScope).map((m) => `${m.method} ${m.path.replace('/api/v1', '')}`).sort();
    expect(own).toEqual([
      'get /notices', 'get /notices/:id/stats', 'get /parent/children', 
      // Phase A–C (reviewed): parent routes re-check the verified guardian link (assertChild); student routes derive the
      // student from the session (currentStudent); file download is authorised per file; /timetable/me is staff-only.
      'get /parent/children/:id/profile', 'get /parent/school-contact', 'get /parent/children/:id/timetable', 'get /parent/children/:id/homework',
      'get /student/me/timetable', 'get /student/me/homework', 'get /student/me/homework/:id', 'put /student/me/homework/:id/submission', 'post /student/me/homework/files',
      'get /homework/files/:id', 'get /timetable/me',
      'get /student/me', 'get /student/me/attendance', 'get /student/me/fees', 'get /student/me/history', 'get /student/me/results', 'get /student/me/results/:resultId/report-card.pdf', 'get /parent/children/:id/attendance', 'get /parent/children/:id/fees',
      'get /parent/children/:id/payments/:paymentId/receipt.pdf', 'get /parent/children/:id/results', 'get /parent/children/:id/results/:resultId/report-card.pdf', 'get /staff', 'get /staff/:id', 'post /notices', 'post /notices/:id/read', 'post /notices/:id/withdraw',
    ].sort());
  });
  it('only public routes are in the auth namespace and tenant-less', () => {
    for (const m of manifest.filter((x) => x.auth === 'public')) {
      expect(m.tenancy).toBe('none');
      expect(m.path.startsWith('/api/v1/auth/')).toBe(true);
    }
  });
  it('unauthenticated callers get 401 on every non-public route', async () => {
    const anon = new Client(app);
    for (const m of manifest.filter((x) => x.auth === 'session')) {
      const path = m.path.replace('/api/v1', '').replace(/:(\w+)/g, '64b64b64b64b64b64b64b64b');
      const res = await (anon as unknown as Record<string, (p: string, b?: unknown) => Promise<{ status: number }>>)[m.method]!(path, {});
      expect(res.status, `${m.method.toUpperCase()} ${m.path}`).toBe(401);
    }
  });
});

describe("REQ-TEN isolation harness v2 — every school route attacked with the other tenant's identity", () => {
  /** Request shapes that pass validation, so the attack reaches the handler and the 404 is the TENANT answer. */
  const specs = (bd: SchoolData): Record<string, { body?: object; query?: string; as?: 'parent' | 'student' }> => ({
    'patch /academics/sessions/:id': { body: { name: 'Hack' } }, 'post /academics/sessions/:id/activate': {}, 'post /academics/sessions/:id/close': {},
    'patch /classes/:id': { body: { name: 'x' } }, 'delete /classes/:id': {}, 'patch /sections/:id': { body: { name: 'x' } }, 'delete /sections/:id': {},
    'delete /subjects/:id': {}, 'delete /academics/teacher-assignments/:id': {}, 'delete /academics/calendar/events/:id': {},
    'get /staff/:id': {}, 'patch /staff/:id': { body: { name: 'x' } }, 'post /staff/:id/status': { body: { status: 'on_leave' } },
    'get /students/:id': {}, 'patch /students/:id': { body: { firstName: 'x' } }, 'post /students/:id/status': { body: { status: 'withdrawn' } },
    'get /students/:id/guardians': {}, 'post /students/:id/guardians': { body: { name: 'g', phone: '9000000000', relationship: 'father' } },
    'patch /students/:id/guardians/:linkId': { body: { verified: true } }, 'get /academics/sections/:id/roster': {},
    'get /attendance/sections/:sectionId': { query: `?date=${todayIst()}` },
    'put /attendance/sections/:sectionId': { body: { date: todayIst(), entries: [{ studentId: bd.studentsA[0], status: 'present' }] } },
    'get /attendance/students/:studentId': { query: `?from=${todayIst()}&to=${todayIst()}` },
    'post /attendance/corrections/:id/approve': { body: {} }, 'post /attendance/corrections/:id/reject': { body: {} },
    'patch /users/:membershipId': { body: { status: 'suspended' } },
    'get /imports/:id': {}, 'put /imports/:id/mapping': { body: { mapping: { admissionNo: 0 } } }, 'post /imports/:id/validate': { body: {} },
    'post /imports/:id/commit': { body: {} }, 'post /imports/:id/rollback': { body: {} }, 'get /imports/:id/errors.csv': {},
    'patch /fees/categories/:id': { body: { name: 'Hack' } }, 'get /fees/structures/:id': {}, 'patch /fees/structures/:id': { body: { name: 'Hack' } },
    'delete /fees/structures/:id': {}, 'post /fees/structures/:id/publish': { body: {} }, 'post /fees/structures/:id/revise': { body: {} },
    'post /fees/concessions/:id/approve': { body: {} }, 'post /fees/concessions/:id/reject': { body: {} }, 'post /fees/concessions/:id/revoke': { body: { reason: 'hack attempt' } },
    'get /fees/invoices/:id': {}, 'post /fees/invoices/:id/void': { body: { reason: 'hack attempt' } }, 'post /fees/invoices/:id/late-fee': { body: { amountPaise: 100, reason: 'hack attempt' } },
    'post /fees/invoices/:id/adjust': { body: { amountPaise: -100, reason: 'hack attempt' } }, 'get /fees/students/:id/summary': {},
    'get /fees/payments/:id': {}, 'get /fees/payments/:id/receipt.pdf': {}, 'post /fees/payments/:id/reversal-requests': { body: { reason: 'hack attempt' } },
    'post /students/:id/guardians/:linkId/portal-invite': { body: {} },
    'post /notices/:id/read': { body: {} }, 'post /notices/:id/withdraw': { body: {} }, 'get /notices/:id/stats': {},
    'get /parent/children/:id/attendance': { query: `?from=${todayIst()}&to=${todayIst()}`, as: 'parent' }, 'get /parent/children/:id/fees': { as: 'parent' },
    'get /parent/children/:id/payments/:paymentId/receipt.pdf': { as: 'parent' },
    'post /exams/grading-scales/:id/publish': { body: {} }, 'get /exams/:id': {}, 'put /exams/:id/subjects': { body: { subjects: [] } },
    'post /exams/:id/open-marks': { body: {} }, 'post /exams/:id/lock-marks': { body: {} },
    'get /exams/:id/marks': { query: `?sectionId=${bd.sectionA}&subjectId=${bd.subjectId}` },
    'put /exams/:id/marks': { body: { sectionId: bd.sectionA, subjectId: bd.subjectId, entries: [{ studentId: bd.studentsA[0], obtained: 1, status: 'entered' }] } },
    'post /exams/:id/results/compute': { body: {} }, 'post /exams/:id/results/publish': { body: {} }, 'get /exams/:id/results': { query: `?sectionId=${bd.sectionA}` },
    'post /exams/:id/results/students/:studentId/correct': { body: { reason: 'hack attempt', marks: [{ subjectId: bd.subjectId, obtained: 1, status: 'entered' }] } },
    'get /results/:id/report-card.pdf': {},
    'get /parent/children/:id/results': { as: 'parent' }, 'get /parent/children/:id/results/:resultId/report-card.pdf': { as: 'parent' },
    'get /students/:id/portal-access': {}, 'post /students/:id/portal-access': { body: {} }, 'post /students/:id/portal-access/disable': { body: {} }, 'post /students/:id/portal-access/enable': { body: {} },
    'get /student/me/results/:resultId/report-card.pdf': { as: 'student' },
    'get /parent/children/:id/profile': { as: 'parent' }, 'get /parent/children/:id/timetable': { as: 'parent' }, 'get /parent/children/:id/homework': { as: 'parent' },
    'get /timetable/versions/:versionId': {}, 'patch /timetable/versions/:versionId': { body: { name: 'hack attempt' } }, 'post /timetable/versions/:versionId/clone': { body: {} },
    'post /timetable/versions/:versionId/publish': { body: {} }, 'get /timetable/versions/:versionId/availability': { query: '?day=1&periodNo=1' },
    'put /timetable/versions/:versionId/lessons': { body: { sectionId: bd.sectionA, day: 1, periodNo: 1, subjectId: bd.subjectId, staffId: bd.teacherStaffId } },
    'delete /timetable/versions/:versionId/lessons/:lessonId': {}, 'get /timetable/sections/:sectionId': {}, 'get /timetable/teachers/:staffId': {},
    'get /homework/files/:id': {}, 'get /homework/:id': {}, 'post /homework/:id/withdraw': { body: {} }, 'get /homework/:id/submissions': {},
    'put /homework/:id/submissions/:studentId/review': { body: { marks: 1, feedback: 'hack attempt' } },
    'get /student/me/homework/:id': { as: 'student' }, 'put /student/me/homework/:id/submission': { as: 'student', body: { text: 'hack attempt' } },
    'post /fees/requests/:id/approve': { body: {} }, 'post /fees/requests/:id/reject': { body: {} }, 'post /fees/requests/:id/mark-paid': { body: { paidOn: todayIst(), mode: 'cash' } },
  });

  const snapshotSchool = async (schoolId: Types.ObjectId) => {
    const out: Record<string, unknown[]> = {};
    for (const [name, info] of modelRegistry) {
      if (info.kind !== 'tenant') continue;
      out[name] = await runAsPlatform('test: snapshot', async () => await mongoose.models[name]!.find({ schoolId }).sort({ _id: 1 }).lean());
    }
    return JSON.stringify(out);
  };

  async function twoSchools() {
    const HA = await buildSchoolData(app, 'harna');
    const HB = await buildSchoolData(app, 'harnb');
    const bCorrection = await runAsPlatform('test: B correction', async () =>
      AttendanceCorrectionModel.create({ schoolId: HB.school.schoolId, studentId: new Types.ObjectId(HB.studentsA[0]), sectionId: new Types.ObjectId(HB.sectionA), date: '2026-01-05', to: 'present', reason: 'fixture', requestedBy: new Types.ObjectId(), status: 'pending' }));
    const bImport = await HB.owner.post('/imports', { entity: 'students', filename: 'b.csv', csv: 'Admission No,Student Name,DOB\nB-9,Secret Kid,01/01/2015' });
    if (bImport.status !== 201) throw new Error(`fixture import: ${bImport.status}`);
    const bFees = await buildFeeData(HB, 'harnb');
    const bNotice = await HB.owner.post('/notices', { title: 'B only notice', body: 'secret', audience: 'everyone' });
    const aParent = await seedParent(app, HA, HA.studentsA[0]!, 'harness-parent@harna.test');
    const aStudent = await seedStudentLogin(app, HA, HA.studentsA[1]!);
    const bExam = await buildExamData(HB);
    const bTt = await HB.owner.post('/timetable/versions', { name: 'B timetable', workingDays: [1, 2, 3, 4, 5], periods: [{ no: 1, label: 'P1', start: '08:00', end: '08:45', kind: 'lesson' }] });
    const bLesson = await HB.owner.put(`/timetable/versions/${bTt.body.data.id}/lessons`, { sectionId: HB.sectionA, day: 1, periodNo: 1, subjectId: HB.subjectId, staffId: HB.teacherStaffId });
    const bFile = await HB.owner.post('/homework/files', { filename: 'b-secret.pdf', contentBase64: Buffer.from('%PDF-1.4 b').toString('base64') });
    const bHw = await HB.owner.post('/homework', { sectionId: HB.sectionA, subjectId: HB.subjectId, title: 'B only homework', description: 'secret', dueAt: new Date(Date.now() + 86_400_000).toISOString(), fileIds: [bFile.body.data.id] });
    if (bTt.status !== 201 || bLesson.status !== 200 || bFile.status !== 201 || bHw.status !== 201) throw new Error(`fixture timetable/homework: ${bTt.status} ${bLesson.status} ${bFile.status} ${bHw.status}`);
    const fx: Record<string, string> = {
      import: bImport.body.data.id, notice: bNotice.body.data.id, grading_scale: bExam.scaleId, exam: bExam.examId, result: bExam.resultId,
      fee_category: bFees.categoryId, fee_structure: bFees.structureId, concession: bFees.concessionId, invoice: bFees.invoiceId, payment: bFees.paymentId, finance_request: bFees.requestId,
      session: HB.sessionId, class: HB.classId, section: HB.sectionA, subject: HB.subjectId, assignment: HB.assignmentId, event: HB.eventId,
      timetableVersion: bTt.body.data.id, timetableSlot: bLesson.body.data.id, file: bFile.body.data.id, homework: bHw.body.data.id,
      staff: HB.teacherStaffId, student: HB.studentsA[0]!, guardian_link: HB.guardianLinkId, correction: String(bCorrection._id), membership: String(HB.teacherMembershipId),
    };
    return { HA, HB, fx, bFees, aParent, aStudent };
  }

  it("every id-bearing route returns 404 for School B ids, and School B's data is byte-for-byte unchanged", async () => {
    const { HA, HB, fx, aParent, aStudent } = await twoSchools();
    const sp = specs(HB);
    const routes = registrar.manifest.filter((m) => m.tenancy === 'school' && m.idParams);
    expect(routes.length).toBeGreaterThan(25);
    const before = await snapshotSchool(HB.school.schoolId);
    for (const m of routes) {
      const key = `${m.method} ${m.path.replace('/api/v1', '')}`;
      const spec = sp[key];
      if (!spec) throw new Error(`Isolation harness has no attack spec for "${key}" — add one so the route is covered`);
      const path = m.path.replace('/api/v1', '').replace(/:(\w+)/g, (_s, p: string) => {
        const kind = m.idParams![p];
        if (!kind || !fx[kind]) throw new Error(`Isolation harness has no fixture for resource kind "${kind}" (${key}) — add one`);
        return fx[kind]!;
      });
      const caller = spec.as === 'parent' ? aParent.client : spec.as === 'student' ? aStudent.client : HA.owner;
      const res = await (caller as unknown as Record<string, (p: string, b?: unknown) => Promise<{ status: number }>>)[m.method]!(`${path}${spec.query ?? ''}`, spec.body ?? {});
      expect(res.status, `${key} with a School B id`).toBe(404);
    }
    expect(await snapshotSchool(HB.school.schoolId)).toBe(before);
  });

  it("every collection route returns only the caller's own rows (no School B id appears anywhere)", async () => {
    const { HA, HB, fx, aParent, aStudent } = await twoSchools();
    const bIds = ['Secret Kid', 'B only notice', 'B only homework', 'B timetable', 'b-secret.pdf', fx.timetableVersion!, fx.homework!, fx.file!, fx.import!, fx.notice!, fx.exam!, fx.result!, fx.grading_scale!, fx.invoice!, fx.payment!, fx.fee_structure!, HB.sessionId, HB.classId, HB.sectionA, HB.sectionB, HB.subjectId, HB.teacherStaffId, HB.assignmentId, HB.eventId, HB.guardianLinkId, ...HB.studentsA, ...HB.studentsB, String(HB.school.schoolId), String(HB.teacherMembershipId)];
    const routes = registrar.manifest.filter((m) => m.method === 'get' && m.tenancy === 'school' && !m.path.includes(':'));
    const month = `?sectionId=${HA.sectionA}&month=${todayIst().slice(0, 7)}`;
    const range = `?from=2020-01-01&to=${todayIst()}`;
    const queries: Record<string, string> = { '/attendance/reports/monthly': month, '/attendance/reports/monthly.csv': month, '/fees/reports/collection': range, '/fees/reports/collection.csv': range };
    await buildFeeData(HA, 'harna2');
    let checked = 0;
    for (const m of routes) {
      const p = m.path.replace('/api/v1', '');
      // parent-portal routes are swept AS A PARENT of school A (staff are refused there before any data is read)
      // /timetable/me is a staff member's own view: the owner has no staff record (403 by design), so sweep it as A's teacher
      const caller = p.startsWith('/parent/') ? aParent.client : p.startsWith('/student/') ? aStudent.client : p === '/timetable/me' ? HA.teacher : HA.owner;
      const res = (await caller.get(`${p}${queries[p] ?? ''}`)) as { status: number; body: unknown; text?: string };
      if (res.status === 400 || (res.status === 404 && p === '/student/me/fees')) continue; // needs params we did not supply (covered by the id-route attack) / hidden by policy
      expect(res.status, p).toBe(200);
      const text = JSON.stringify(res.body) + (res.text ?? '');
      for (const id of bIds) expect(text.includes(id), `${p} leaked School B id ${id}`).toBe(false);
      checked++;
    }
    expect(checked).toBeGreaterThan(10);
    expect((await HA.owner.get('/students')).body.meta.total).toBe(6);
  });

  it("finance: School B ids inside request BODIES are refused (payments, refunds, billing, concessions) and B's money is untouched", async () => {
    const { HA, HB, bFees } = await twoSchools();
    await buildFeeData(HA, 'harna');
    const before = await snapshotSchool(HB.school.schoolId);
    const k = (n: string) => ({ 'Idempotency-Key': `attack-${n}-${Date.now()}` });
    expect((await HA.owner.post('/fees/payments', { studentId: HB.studentsA[0], amountPaise: 100, mode: 'cash', paidOn: todayIst() }, k('pay'))).status).toBe(404);
    expect((await HA.owner.post('/fees/refunds', { studentId: HB.studentsA[0], amountPaise: 100, reason: 'attack' })).status).toBe(404);
    expect((await HA.owner.post('/fees/invoices/generate', { structureId: bFees.structureId, installmentLabel: 'Q1' }, k('gen'))).status).toBe(404);
    expect((await HA.owner.post('/fees/concessions', { studentId: HB.studentsA[0], kind: 'other', valueType: 'flat', value: 100, reason: 'attack' })).status).toBe(404);
    const myInvoices = (await HA.owner.get(`/fees/invoices?studentId=${HA.studentsA[0]}`)).body.data as Array<{ id: string }>;
    const res = await HA.owner.post('/fees/payments', { studentId: HA.studentsA[0], amountPaise: 100, mode: 'cash', paidOn: todayIst(), allocations: [{ invoiceId: bFees.invoiceId, amountPaise: 100 }] }, k('alloc'));
    expect(res.status).toBe(404); // allocating to another school's invoice
    expect(myInvoices.length).toBeGreaterThan(0);
    expect(await snapshotSchool(HB.school.schoolId)).toBe(before);
  });

  it('payload schoolId is rejected (strict schemas), never trusted', async () => {
    const ownerA = await loggedIn(app, A.ownerEmail);
    const res = await ownerA.patch('/schools/me', { name: 'Hacked', schoolId: String(B.schoolId) });
    expect(res.status).toBe(400);
    const res2 = await ownerA.post('/users/invite', { name: 'X', email: 'x@y.test', roleKeys: ['teacher'], schoolId: String(B.schoolId) });
    expect(res2.status).toBe(400);
    const res3 = await ownerA.get(`/users?schoolId=${B.schoolId}`);
    expect(res3.status).toBe(400);
  });

  it("a user from school A with no membership in B cannot switch into B or read B's data", async () => {
    const ownerA = await loggedIn(app, A.ownerEmail);
    expect((await ownerA.post('/auth/select-school', { membershipId: String(B.ownerMembershipId) })).status).toBe(404);
    expect((await ownerA.get('/schools/me')).body.data.code).toBe('alpha');
  });

  it('a membership ended/suspended mid-session loses access on the very next request', async () => {
    const tina = await seedMember(A.schoolId, 'tina@alpha.test', ['teacher']);
    const c = await loggedIn(app, 'tina@alpha.test');
    expect((await c.get('/schools/me')).status).toBe(200);
    await memberships.updateOne({ _id: tina.membershipId }, { $set: { status: 'suspended' } }, 'test');
    expect((await c.get('/schools/me')).status).toBe(403);
  });
});

describe('REQ-RBAC permissions, escalation and owner protection', () => {
  it('a teacher cannot invite, list users, read the audit log or change school settings', async () => {
    await seedMember(A.schoolId, 'tina@alpha.test', ['teacher']);
    const c = await loggedIn(app, 'tina@alpha.test');
    expect((await c.get('/users')).status).toBe(403);
    expect((await c.post('/users/invite', { name: 'X', email: 'x@alpha.test', roleKeys: ['teacher'] })).status).toBe(403);
    expect((await c.get('/audit-logs')).status).toBe(403);
    expect((await c.patch('/schools/me/settings', { themeColor: '#112233' })).status).toBe(403);
    expect((await c.get('/schools/me')).status).toBe(200); // anyMember
  });

  it('an admin can invite staff but cannot grant Owner, Accountant (finance) or any role above their own permissions', async () => {
    await seedMember(A.schoolId, 'ada@alpha.test', ['admin']);
    const c = await loggedIn(app, 'ada@alpha.test');
    expect((await c.post('/users/invite', { name: 'T', email: 't@alpha.test', roleKeys: ['teacher'] })).status).toBe(201);
    expect((await c.post('/users/invite', { name: 'O', email: 'o@alpha.test', roleKeys: ['owner'] })).status).toBe(403);
    expect((await c.post('/users/invite', { name: 'F', email: 'f@alpha.test', roleKeys: ['accountant'] })).status).toBe(403);
    expect((await c.post('/users/invite', { name: 'P', email: 'p@alpha.test', roleKeys: ['parent'] })).status).toBe(400); // not a staff role
  });

  it('nobody can change their own roles/status', async () => {
    const c = await loggedIn(app, A.ownerEmail);
    expect((await c.patch(`/users/${A.ownerMembershipId}`, { status: 'suspended' })).status).toBe(403);
    expect((await c.patch(`/users/${A.ownerMembershipId}`, { roleKeys: ['teacher'] })).status).toBe(403);
  });

  it('only an Owner may demote or suspend an Owner (an Admin cannot, even with users:update)', async () => {
    await seedMember(A.schoolId, 'ada@alpha.test', ['admin']);
    const ada = await loggedIn(app, 'ada@alpha.test');
    expect((await ada.patch(`/users/${A.ownerMembershipId}`, { status: 'suspended' })).status).toBe(403);
    expect((await ada.patch(`/users/${A.ownerMembershipId}`, { roleKeys: ['admin'] })).status).toBe(403);
    const o2 = await seedMember(A.schoolId, 'owner2@alpha.test', ['owner'], { personType: 'owner' });
    const owner = await loggedIn(app, A.ownerEmail);
    expect((await owner.patch(`/users/${o2.membershipId}`, { roleKeys: ['admin'] })).status).toBe(200); // owners may demote owners
    // the owner row is untouched by the failed attempts
    const [row] = await memberships.find({ _id: A.ownerMembershipId }, 'test');
    expect(row!.roleKeys).toEqual(['owner']);
    expect(row!.status).toBe('active');
  });

  it('suspending a member revokes their sessions at once; role changes also bite immediately', async () => {
    const tina = await seedMember(A.schoolId, 'tina@alpha.test', ['teacher']);
    const tinaC = await loggedIn(app, 'tina@alpha.test');
    const owner = await loggedIn(app, A.ownerEmail);
    expect((await owner.patch(`/users/${tina.membershipId}`, { status: 'suspended' })).status).toBe(200);
    expect((await tinaC.get('/schools/me')).status).toBe(401);
    const live = await sessions.find({ userId: tina.userId, revokedAt: null }, 'test');
    expect(live).toHaveLength(0);
  });

  it('optimistic locking on membership edits returns 409 for stale versions', async () => {
    const tina = await seedMember(A.schoolId, 'tina@alpha.test', ['teacher']);
    const owner = await loggedIn(app, A.ownerEmail);
    const list = await owner.get('/users');
    const row = list.body.data.find((u: { email: string }) => u.email === 'tina@alpha.test');
    expect((await owner.patch(`/users/${tina.membershipId}`, { roleKeys: ['class_teacher'], version: row.version })).status).toBe(200);
    expect((await owner.patch(`/users/${tina.membershipId}`, { roleKeys: ['teacher'], version: row.version })).status).toBe(409);
  });

  it('staff limits (entitlement-lite) block invites beyond the plan, existing data stays readable', async () => {
    const S = await seedSchool('tiny', { limits: { students: 10, staff: 2 } });
    const owner = await loggedIn(app, S.ownerEmail);
    expect((await owner.post('/users/invite', { name: 'T1', email: 't1@tiny.test', roleKeys: ['teacher'] })).status).toBe(201);
    const over = await owner.post('/users/invite', { name: 'T2', email: 't2@tiny.test', roleKeys: ['teacher'] });
    expect(over.status).toBe(403);
    expect(over.body.error.code).toBe('ENTITLEMENT_REQUIRED');
    expect((await owner.get('/users')).status).toBe(200);
  });
});

describe('REQ-AUD audit trail', () => {
  it('audited writes always leave a row with actor, school and request id; secrets are redacted; reads are school-scoped', async () => {
    const owner = await loggedIn(app, A.ownerEmail);
    await owner.post('/users/invite', { name: 'T', email: 't@alpha.test', roleKeys: ['teacher'] });
    await owner.patch('/schools/me', { name: 'Alpha Public School' });
    const rows = await _auditRowsForTest({ schoolId: A.schoolId });
    const actions = rows.map((r) => r.action);
    expect(actions).toContain('users.invited');
    expect(actions).toContain('school.profile_updated');
    expect(actions).toContain('auth.login');
    const invited = rows.find((r) => r.action === 'users.invited')!;
    expect(String(invited.actorUserId)).toBeTruthy();
    expect(invited.requestId).toBeTruthy();
    expect(JSON.stringify(rows)).not.toMatch(/password|tokenHash|\$argon2/i);

    const bOwner = await loggedIn(app, B.ownerEmail);
    const bLog = await bOwner.get('/audit-logs');
    expect(bLog.body.data.some((r: { action: string }) => r.action === 'users.invited')).toBe(false);
  });
});
