import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { Types } from 'mongoose';
import { setupTestDb, teardownTestDb, clearAll } from './helpers/db';
import { Client, loggedIn, makeTestApp, seedMember } from './helpers/app';
import { buildSchoolData, seedParent, seedStudentLogin, type SchoolData } from './helpers/fixtures';
import { _auditRowsForTest } from '../src/core/audit/audit.service';
import { AssignmentModel } from '../src/modules/homework/homework.model';
import { runAsPlatform } from '../src/core/tenancy/context';
import { memberships } from '../src/modules/auth/auth.repository';
import { checkUpload, safeDisplayName } from '../src/core/storage/file-policy';
import { LocalDiskStorage, MemoryStorage, newStorageKey } from '../src/core/storage/file-storage';
import { mkdtempSync, readdirSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const t = makeTestApp({ UPLOAD_MAX_BYTES: String(64 * 1024) });
const { app } = t;
let A: SchoolData;
let B: SchoolData;

const b64 = (s: string | Buffer) => Buffer.from(s).toString('base64');
const PDF = b64('%PDF-1.4\n1 0 obj<<>>endobj\n');
const PNG = b64(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]));
const inDays = (d: number) => new Date(Date.now() + d * 86_400_000).toISOString();

beforeAll(setupTestDb);
afterAll(teardownTestDb);
beforeEach(async () => {
  await clearAll();
  strangerCache = null;
  A = await buildSchoolData(app, 'alpha');
  B = await buildSchoolData(app, 'bravo');
});

const upload = (c: Client, filename: string, contentBase64: string, path = '/homework/files') => c.post(path, { filename, contentBase64 });
async function setHomework(c: Client, sd: SchoolData, extra: Record<string, unknown> = {}) {
  return c.post('/homework', { sectionId: sd.sectionA, subjectId: sd.subjectId, title: 'Chapter 3 exercises', description: 'Do questions 1-10', dueAt: inDays(2), maxMarks: 10, ...extra });
}
/** A second teacher who teaches NOTHING (so has no scope over any class). */
let strangerCache: Client | null = null;
async function strangerTeacher(sd: SchoolData) {
  if (strangerCache) return strangerCache;
  const staff = (await sd.owner.post('/staff', { employeeId: 'E-x-9', name: 'Stranger Teacher', designation: 'Teacher', kind: 'teaching' })).body.data.id as string;
  const m = await seedMember(sd.school.schoolId, `stranger@${sd.school.code}.test`, ['teacher'], { name: 'Stranger Teacher' });
  await memberships.updateOne({ _id: m.membershipId }, { $set: { personId: new Types.ObjectId(staff) } }, 'test: link stranger');
  strangerCache = await loggedIn(app, `stranger@${sd.school.code}.test`);
  return strangerCache;
}

describe('REQ-HW-FILE upload policy (unit)', () => {
  it('decides the type from the bytes, requires a matching extension, refuses executables/active content, sanitises names', () => {
    const ok = checkUpload('Notes.PDF', Buffer.from('%PDF-1.7 x'), 1000);
    expect(ok).toMatchObject({ name: 'Notes.PDF', ext: 'pdf', mime: 'application/pdf' });
    expect(checkUpload('pic.jpeg', Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0]), 1000).mime).toBe('image/jpeg');
    expect(checkUpload('a.txt', Buffer.from('plain text ✓'), 1000).mime).toMatch(/text\/plain/);
    const bad = (name: string, data: Buffer) => () => checkUpload(name, data, 1000);
    expect(bad('virus.exe', Buffer.from('MZ\x90\x00'))).toThrow();
    expect(bad('virus.pdf', Buffer.from('MZ\x90\x00'))).toThrow(/does not match/); // an .exe renamed to .pdf
    expect(bad('page.html', Buffer.from('<script>alert(1)</script>'))).toThrow();
    expect(bad('image.svg', Buffer.from('<svg onload=alert(1)>'))).toThrow();
    expect(bad('run.sh', Buffer.from('#!/bin/sh'))).toThrow();
    expect(bad('report.exe.pdf', Buffer.from('%PDF-1.4'))).toThrow(/not allowed/); // hidden inner extension
    expect(bad('macro.docm', Buffer.from('PK\x03\x04'))).toThrow();
    expect(bad('noext', Buffer.from('%PDF-1.4'))).toThrow();
    expect(bad('bin.txt', Buffer.from([0x41, 0x00, 0x42]))).toThrow(); // NUL byte: not text
    expect(bad('empty.pdf', Buffer.alloc(0))).toThrow(/empty/);
    expect(bad('big.pdf', Buffer.concat([Buffer.from('%PDF-'), Buffer.alloc(2000)]))).toThrow(/too large/);
    expect(safeDisplayName('../../etc/passwd.pdf')).toBe('passwd.pdf');
    expect(safeDisplayName('C:\\Users\\x\\evil<>.pdf')).toBe('evil.pdf');
    expect(safeDisplayName('.hidden.txt')).toBe('hidden.txt');
    expect(safeDisplayName('a'.repeat(300) + '.pdf').length).toBe(100);
  });

  it('storage keys are generated server-side, traversal is impossible, objects are never overwritten', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'edunex-st-'));
    const st = new LocalDiskStorage(dir);
    const school = new Types.ObjectId().toHexString();
    const key = newStorageKey(school);
    await st.put(key, Buffer.from('x'));
    expect((await st.get(key)).toString()).toBe('x');
    await expect(st.put(key, Buffer.from('y'))).rejects.toBeTruthy(); // 'wx' — no overwrite
    for (const evil of ['../evil', `${school}/../../x`, `${school}/${'a'.repeat(32)}/../..`, 'C:\\x', `${school}/abc`]) await expect(st.get(evil)).rejects.toThrow(/Invalid storage key/);
    expect(readdirSync(join(dir, school))).toHaveLength(1);
    await st.remove(key);
    expect(existsSync(join(dir, school, key.split('/')[1]!))).toBe(false);
    const mem = new MemoryStorage();
    await mem.put(key, Buffer.from('m'));
    expect((await mem.get(key)).toString()).toBe('m');
  });
});

describe('REQ-HW homework & assignments', () => {
  it('uploads: only valid files are accepted; the client MIME type means nothing; the stored name is random; only the uploader sees an unattached file', async () => {
    expect((await upload(A.teacher, 'worksheet.pdf', PDF)).status).toBe(201);
    expect((await upload(A.teacher, 'diagram.png', PNG)).status).toBe(201);
    for (const [name, data] of [['x.exe', b64('MZ\x90\x00')], ['x.pdf', b64('MZ\x90\x00')], ['x.html', b64('<b>')], ['x.svg', b64('<svg/>')], ['report.exe.pdf', PDF], ['x.docm', b64('PK\x03\x04')]] as const) {
      expect((await upload(A.teacher, name, data)).status, name).toBe(400);
    }
    expect((await upload(A.teacher, 'x.pdf', '***not base64***')).status).toBe(400);
    expect((await upload(A.teacher, 'big.pdf', b64(Buffer.concat([Buffer.from('%PDF-'), Buffer.alloc(70 * 1024)])))).status).toBe(400); // over the 64 KB test limit
    expect((await A.teacher.post('/homework/files', { filename: 'a.pdf', contentBase64: PDF, mimeType: 'application/pdf' })).status).toBe(400); // no client mime accepted
    // permissions: students use their own upload route, parents have none, the other school's users nothing
    const stu = await seedStudentLogin(app, A, A.studentsA[0]!);
    expect((await upload(stu.client, 'a.pdf', PDF)).status).toBe(403);
    expect((await upload(stu.client, 'a.pdf', PDF, '/student/me/homework/files')).status).toBe(201);
    const par = await seedParent(app, A, A.studentsA[0]!, 'ravi@parents.test');
    expect((await upload(par.client, 'a.pdf', PDF)).status).toBe(403);
    expect((await upload(par.client, 'a.pdf', PDF, '/student/me/homework/files')).status).toBe(403);
    expect((await upload(A.teacher, 'a.pdf', PDF, '/student/me/homework/files')).status).toBe(403);

    const up = (await upload(A.teacher, 'My Worksheet.pdf', PDF)).body.data;
    expect(up).toMatchObject({ name: 'My Worksheet.pdf', mime: 'application/pdf' });
    expect((await A.teacher.get(`/homework/files/${up.id}`)).status).toBe(200); // uploader
    expect((await A.owner.get(`/homework/files/${up.id}`)).status).toBe(404); // unattached: uploader only
    expect((await stu.client.get(`/homework/files/${up.id}`)).status).toBe(404);
    const dl = await A.teacher.get(`/homework/files/${up.id}`);
    expect(dl.headers['content-type']).toBe('application/pdf');
    expect(dl.headers['content-disposition']).toMatch(/^attachment;/);
    expect(dl.headers['x-content-type-options']).toBe('nosniff');
    expect(Buffer.from(dl.body as Buffer).toString()).toContain('%PDF-1.4');
  });

  it('teachers set homework only for their own classes; invalid input and foreign attachments are refused; audit is written', async () => {
    const f = (await upload(A.teacher, 'sheet.pdf', PDF)).body.data.id as string;
    const mine = await setHomework(A.teacher, A, { fileIds: [f] });
    expect(mine.status).toBe(201);
    expect(mine.body.data).toMatchObject({ title: 'Chapter 3 exercises', subject: 'Mathematics', status: 'published', maxMarks: 10 });
    expect(mine.body.data.files).toHaveLength(1);
    expect((await setHomework(A.teacher, A, { sectionId: A.sectionB })).status).toBe(403); // not their class
    expect((await setHomework(A.owner, A, { sectionId: A.sectionB })).status).toBe(201); // administrator
    expect((await setHomework(A.teacher, A, { dueAt: new Date(Date.now() - 86_400_000).toISOString() })).status).toBe(400);
    expect((await setHomework(A.teacher, A, { title: 'x' })).status).toBe(400);
    expect((await setHomework(A.teacher, A, { subjectId: B.subjectId })).status).toBe(404);
    expect((await setHomework(A.teacher, A, { sectionId: B.sectionA })).status).toBe(404);
    expect((await setHomework(A.teacher, A, { fileIds: [f] })).status).toBe(404); // already attached elsewhere
    const other = await strangerTeacher(A);
    expect((await setHomework(other, A)).status).toBe(403);
    expect((await other.get(`/homework/${mine.body.data.id}`)).status).toBe(403);
    expect((await other.get('/homework')).body.data).toEqual([]);
    // another teacher's file cannot be attached to my homework
    const theirs = (await upload(other, 'z.pdf', PDF)).body.data.id as string;
    expect((await setHomework(A.teacher, A, { fileIds: [theirs] })).status).toBe(404);
    const actions = (await _auditRowsForTest({ schoolId: A.school.schoolId })).map((r) => r.action);
    expect(actions).toEqual(expect.arrayContaining(['homework.assignment_created', 'homework.file_uploaded']));
  });

  it('students see only their own class homework, submit once (re-submission before review), late handling, duplicates and review rules', async () => {
    const hw = (await setHomework(A.teacher, A)).body.data.id as string;
    const hwB = (await setHomework(A.owner, A, { sectionId: A.sectionB })).body.data.id as string;
    const s1 = await seedStudentLogin(app, A, A.studentsA[0]!);
    const s2 = await seedStudentLogin(app, A, A.studentsA[1]!);
    expect((await s1.client.get('/student/me/homework')).body.data.map((x: { id: string }) => x.id)).toEqual([hw]);
    expect((await s1.client.get(`/student/me/homework/${hwB}`)).status).toBe(404); // another class
    expect((await s1.client.get('/homework')).status).toBe(403); // staff list is closed to students
    expect((await s1.client.get(`/homework/${hw}`)).status).toBe(403);
    expect((await s1.client.put(`/student/me/homework/${hwB}/submission`, { text: 'x' })).status).toBe(404);
    expect((await s1.client.put(`/student/me/homework/${hw}/submission`, {})).status).toBe(400); // nothing submitted

    const f = (await upload(s1.client, 'answer.pdf', PDF, '/student/me/homework/files')).body.data.id as string;
    const sub = await s1.client.put(`/student/me/homework/${hw}/submission`, { text: 'My answer', fileIds: [f] });
    expect(sub.status).toBe(200);
    expect(sub.body.data.mine).toMatchObject({ status: 'submitted', late: false, attempts: 1, text: 'My answer' });
    expect(sub.body.data.mine.files).toHaveLength(1);
    // assignment-purpose files can't be used as a submission, nor a classmate's
    const tf = (await upload(A.teacher, 'sheet.pdf', PDF)).body.data.id as string;
    expect((await s1.client.put(`/student/me/homework/${hw}/submission`, { text: 'again', fileIds: [tf] })).status).toBe(404);
    const f2 = (await upload(s2.client, 'mine.pdf', PDF, '/student/me/homework/files')).body.data.id as string;
    expect((await s1.client.put(`/student/me/homework/${hw}/submission`, { text: 'again', fileIds: [f2] })).status).toBe(404);

    // re-submission replaces the answer and counts attempts; still ONE submission
    const again = await s1.client.put(`/student/me/homework/${hw}/submission`, { text: 'Better answer' });
    expect(again.body.data.mine).toMatchObject({ attempts: 2, text: 'Better answer' });
    expect(again.body.data.mine.files).toHaveLength(0);
    const sheet = (await A.teacher.get(`/homework/${hw}/submissions`)).body.data;
    expect(sheet.summary).toEqual({ total: 3, submitted: 1, late: 0, reviewed: 0, missing: 2 });
    expect(sheet.students.find((x: { admissionNo: string }) => x.admissionNo === 'alpha-A1').state).toBe('submitted');

    // concurrent double-click by another student: exactly one submission row
    const both = await Promise.all([s2.client.put(`/student/me/homework/${hw}/submission`, { text: 'one' }), s2.client.put(`/student/me/homework/${hw}/submission`, { text: 'two' })]);
    expect(both.every((r) => r.status === 200)).toBe(true);
    const sheet2 = (await A.teacher.get(`/homework/${hw}/submissions`)).body.data;
    expect(sheet2.summary.submitted).toBe(2);

    // review: rules and permissions
    const rv = (c: Client, sid: string, body: unknown) => c.put(`/homework/${hw}/submissions/${sid}/review`, body);
    expect((await rv(A.teacher, A.studentsA[0]!, { marks: 11 })).status).toBe(400); // over max
    expect((await rv(A.teacher, A.studentsA[0]!, { marks: -1 })).status).toBe(400);
    expect((await rv(A.teacher, A.studentsA[0]!, {})).status).toBe(400); // nothing to give
    expect((await rv(A.teacher, A.studentsA[2]!, { marks: 5 })).status).toBe(404); // no submission
    expect((await rv(s1.client, A.studentsA[0]!, { marks: 10 })).status).toBe(403); // students cannot grade themselves
    const par = await seedParent(app, A, A.studentsA[0]!, 'ravi@parents.test');
    expect((await rv(par.client, A.studentsA[0]!, { marks: 10 })).status).toBe(403);
    expect((await rv(await strangerTeacher(A), A.studentsA[0]!, { marks: 10 })).status).toBe(403);
    const rev = await rv(A.teacher, A.studentsA[0]!, { marks: 8, feedback: 'Good work' });
    expect(rev.status).toBe(200);
    expect(rev.body.data).toMatchObject({ marks: 8, feedback: 'Good work', status: 'reviewed' });
    const mine = (await s1.client.get(`/student/me/homework/${hw}`)).body.data.mine;
    expect(mine).toMatchObject({ marks: 8, feedback: 'Good work', status: 'reviewed' });
    expect((await s1.client.put(`/student/me/homework/${hw}/submission`, { text: 'too late to change' })).status).toBe(409); // reviewed: locked
    expect((await A.teacher.get(`/homework/${hw}/submissions`)).body.data.summary).toMatchObject({ reviewed: 1 });
    // parent sees the child's state read-only; cannot submit
    const pv = (await par.client.get(`/parent/children/${A.studentsA[0]}/homework`)).body.data;
    expect(pv[0]).toMatchObject({ id: hw, state: 'reviewed', mine: { marks: 8 } });
    expect((await par.client.get(`/parent/children/${A.studentsA[1]}/homework`)).status).toBe(404); // not their child
    expect((await par.client.put(`/student/me/homework/${hw}/submission`, { text: 'x' })).status).toBe(403);
    expect((await A.owner.get(`/parent/children/${A.studentsA[0]}/homework`)).status).toBe(403);
    const actions = (await _auditRowsForTest({ schoolId: A.school.schoolId })).map((r) => r.action);
    expect(actions).toEqual(expect.arrayContaining(['homework.submitted', 'homework.submission_resubmitted', 'homework.submission_reviewed']));
  });

  it('late submissions: accepted and flagged by default; refused when the teacher turned late work off', async () => {
    const lateOk = (await setHomework(A.teacher, A)).body.data.id as string;
    const noLate = (await setHomework(A.teacher, A, { allowLate: false, title: 'No late please' })).body.data.id as string;
    // test-only time travel: move the due date into the past (raw model ⇒ needs an explicit platform context)
    await runAsPlatform('test: past due', async () => AssignmentModel.updateMany({ _id: { $in: [lateOk, noLate] } }, { $set: { dueAt: new Date(Date.now() - 3_600_000) } }));
    const s = await seedStudentLogin(app, A, A.studentsA[0]!);
    const l = await s.client.put(`/student/me/homework/${lateOk}/submission`, { text: 'sorry' });
    expect(l.body.data.mine).toMatchObject({ late: true });
    expect((await A.teacher.get(`/homework/${lateOk}/submissions`)).body.data.students.find((x: { admissionNo: string }) => x.admissionNo === 'alpha-A1').state).toBe('late');
    expect((await s.client.put(`/student/me/homework/${noLate}/submission`, { text: 'sorry' })).status).toBe(409);
    expect((await s.client.get('/student/me/homework')).body.data.find((x: { id: string }) => x.id === noLate).state).toBe('overdue');
  });

  it('files: a classmate, another class, a stranger teacher and the other school can never read a submission file; the right people can', async () => {
    const hw = (await setHomework(A.teacher, A)).body.data.id as string;
    const s1 = await seedStudentLogin(app, A, A.studentsA[0]!);
    const s2 = await seedStudentLogin(app, A, A.studentsA[1]!);
    const sB = await seedStudentLogin(app, A, A.studentsB[0]!); // other section
    const f = (await upload(s1.client, 'answer.pdf', PDF, '/student/me/homework/files')).body.data.id as string;
    await s1.client.put(`/student/me/homework/${hw}/submission`, { text: 'mine', fileIds: [f] });
    const p1 = await seedParent(app, A, A.studentsA[0]!, 'ravi@parents.test');

    const status = async (c: Client) => (await c.get(`/homework/files/${f}`)).status;
    expect(await status(s1.client)).toBe(200); // the author
    expect(await status(A.teacher)).toBe(200); // teaches the class
    expect(await status(A.owner)).toBe(200);
    expect(await status(p1.client)).toBe(200); // their child's work
    expect(await status(s2.client)).toBe(404); // classmate
    expect(await status(sB.client)).toBe(404); // another class
    expect(await status(await strangerTeacher(A))).toBe(404);
    expect(await status(B.owner)).toBe(404); // another school
    expect(await status(B.teacher)).toBe(404);
    expect((await new Client(app).get(`/homework/files/${f}`)).status).toBe(401);

    // assignment attachments: visible to the class and its parents, not to another class
    const att = (await upload(A.teacher, 'sheet.pdf', PDF)).body.data.id as string;
    const hw2 = (await setHomework(A.teacher, A, { fileIds: [att], title: 'With attachment' })).body.data.id as string;
    expect((await s1.client.get(`/homework/files/${att}`)).status).toBe(200);
    expect((await p1.client.get(`/homework/files/${att}`)).status).toBe(200);
    expect((await sB.client.get(`/homework/files/${att}`)).status).toBe(404);
    expect((await B.owner.get(`/homework/files/${att}`)).status).toBe(404);
    expect((await s1.client.get(`/student/me/homework/${hw2}`)).body.data.files).toHaveLength(1);
    expect((await sB.client.get(`/student/me/homework/${hw2}`)).status).toBe(404);
    // a withdrawn assignment disappears for students
    expect((await A.teacher.post(`/homework/${hw2}/withdraw`)).status).toBe(200);
    expect((await s1.client.get(`/student/me/homework/${hw2}`)).status).toBe(404);
    expect((await s1.client.get('/student/me/homework')).body.data.map((x: { id: string }) => x.id)).not.toContain(hw2);
    expect((await (await strangerTeacher(A)).post(`/homework/${hw2}/withdraw`)).status).toBe(403);
  });

  it('two schools: every id from the other school is 404 and lists never leak', async () => {
    const hwA = (await setHomework(A.teacher, A)).body.data.id as string;
    const hwB = (await setHomework(B.teacher, B)).body.data.id as string;
    for (const call of [
      () => B.owner.get(`/homework/${hwA}`), () => B.owner.get(`/homework/${hwA}/submissions`), () => B.owner.post(`/homework/${hwA}/withdraw`),
      () => B.owner.put(`/homework/${hwA}/submissions/${B.studentsA[0]}/review`, { marks: 1 }), () => B.teacher.get(`/homework/${hwA}`),
    ]) expect([403, 404]).toContain((await call()).status);
    expect((await B.owner.get(`/homework/${hwA}`)).status).toBe(404);
    expect((await B.owner.get('/homework')).body.data.map((x: { id: string }) => x.id)).toEqual([hwB]);
    const sB = await seedStudentLogin(app, B, B.studentsA[0]!);
    expect((await sB.client.get(`/student/me/homework/${hwA}`)).status).toBe(404);
    expect((await sB.client.put(`/student/me/homework/${hwA}/submission`, { text: 'x' })).status).toBe(404);
  });
});
