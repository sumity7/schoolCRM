import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { setupTestDb, teardownTestDb, clearAll } from './helpers/db';
import { Client, makeTestApp } from './helpers/app';
import { buildSchoolData, seedParent, seedStudentLogin, type SchoolData } from './helpers/fixtures';
import { _auditRowsForTest } from '../src/core/audit/audit.service';

const t = makeTestApp();
const { app } = t;
let A: SchoolData;
let B: SchoolData;
let sub2 = '';
let teacher2 = '';

const PERIODS = [
  { no: 1, label: 'Period 1', start: '08:00', end: '08:45', kind: 'lesson' },
  { no: 2, label: 'Period 2', start: '08:45', end: '09:30', kind: 'lesson' },
  { no: 3, label: 'Break', start: '09:30', end: '09:50', kind: 'break' },
  { no: 4, label: 'Period 3', start: '09:50', end: '10:35', kind: 'lesson' },
];
const draft = async (sd: SchoolData, name = 'Term 1') => (await sd.owner.post('/timetable/versions', { name, workingDays: [1, 2, 3, 4, 5], periods: PERIODS })).body.data.id as string;
const lesson = (sd: SchoolData, versionId: string, body: Record<string, unknown>) =>
  sd.owner.put(`/timetable/versions/${versionId}/lessons`, { sectionId: sd.sectionA, day: 1, periodNo: 1, subjectId: sd.subjectId, staffId: sd.teacherStaffId, ...body });

beforeAll(setupTestDb);
afterAll(teardownTestDb);
beforeEach(async () => {
  await clearAll();
  A = await buildSchoolData(app, 'alpha');
  B = await buildSchoolData(app, 'bravo');
  sub2 = (await A.owner.post('/subjects', { code: 'ENG', name: 'English', type: 'core' })).body.data.id;
  teacher2 = (await A.owner.post('/staff', { employeeId: 'E-alpha-2', name: 'Raj Teacher', designation: 'Teacher', kind: 'teaching' })).body.data.id;
});

describe('REQ-TT timetable', () => {
  it('period grid and working days are validated', async () => {
    const bad = async (periods: unknown, days: number[] = [1, 2]) => (await A.owner.post('/timetable/versions', { name: 'X', workingDays: days, periods })).status;
    expect(await bad([])).toBe(400);
    expect(await bad([{ ...PERIODS[0], no: 2 }])).toBe(400); // must start at 1
    expect(await bad([{ ...PERIODS[0], end: '07:00' }])).toBe(400); // ends before it starts
    expect(await bad([PERIODS[0], { ...PERIODS[1], start: '08:30' }])).toBe(400); // overlaps previous
    expect(await bad([{ ...PERIODS[2] }].map((p) => ({ ...p, no: 1 })))).toBe(400); // no lesson period
    expect(await bad([{ ...PERIODS[0], start: '8:00' }])).toBe(400); // not HH:MM
    expect(await bad(PERIODS, [0, 9])).toBe(400);
    expect((await A.owner.post('/timetable/versions', { name: 'OK', periods: PERIODS })).status).toBe(201);
  });

  it('refuses teacher, room and class double-booking — with a clear reason — and allows legitimate changes', async () => {
    const v = await draft(A);
    expect((await lesson(A, v, {})).status).toBe(200);
    // same class, same period: that is a change of lesson, not a clash
    expect((await lesson(A, v, { subjectId: sub2, staffId: teacher2 })).status).toBe(200);
    expect((await lesson(A, v, {})).status).toBe(200); // back again

    // teacher double-booked: Tina is teaching 5 A in period 1 on Monday; 5 B cannot also have her
    const t1 = await lesson(A, v, { sectionId: A.sectionB });
    expect(t1.status).toBe(409);
    expect(t1.body.error.message).toMatch(/Tina Teacher is already teaching Class 5 A on Monday, period 1/);
    // the same teacher in another period is fine
    expect((await lesson(A, v, { sectionId: A.sectionB, periodNo: 2 })).status).toBe(200);

    // room double-booked
    expect((await lesson(A, v, { room: 'lab-1', periodNo: 4 })).status).toBe(200);
    const r1 = await lesson(A, v, { sectionId: A.sectionB, periodNo: 4, staffId: teacher2, room: 'LAB-1' });
    expect(r1.status).toBe(409);
    expect(r1.body.error.message).toMatch(/Room LAB-1 is already used by Class 5 A/);
    expect((await lesson(A, v, { sectionId: A.sectionB, periodNo: 4, staffId: teacher2, room: 'LAB-2' })).status).toBe(200);

    // rooms are optional: two lessons without a room never clash
    expect((await lesson(A, v, { day: 2, periodNo: 1 })).status).toBe(200);
    expect((await lesson(A, v, { day: 2, periodNo: 1, sectionId: A.sectionB, staffId: teacher2 })).status).toBe(200);

    // invalid placements
    expect((await lesson(A, v, { periodNo: 3 })).status).toBe(400); // break
    expect((await lesson(A, v, { day: 7 })).status).toBe(400); // not a working day
    expect((await lesson(A, v, { periodNo: 9 })).status).toBe(400); // no such period
    expect((await lesson(A, v, { sectionId: B.sectionA })).status).toBe(404); // another school's section
    expect((await lesson(A, v, { staffId: B.teacherStaffId })).status).toBe(404); // another school's teacher
    expect((await lesson(A, v, { subjectId: B.subjectId })).status).toBe(404); // another school's subject
    expect((await lesson(A, v, { staffId: 'nope' })).status).toBe(400);
  });

  it('concurrent attempts to book the same teacher/room/class cannot both win (database-level guarantee)', async () => {
    const v = await draft(A);
    const sections = [A.sectionA, A.sectionB];
    // one teacher, same slot, two classes, fired together
    const res = await Promise.all(sections.map((sectionId) => lesson(A, v, { sectionId, day: 3, periodNo: 1 })));
    expect(res.map((r) => r.status).sort()).toEqual([200, 409]);
    const view = await A.owner.get(`/timetable/versions/${v}`);
    expect(view.body.data.lessonCount).toBe(1);
    // one room, two teachers, fired together
    const rooms = await Promise.all([lesson(A, v, { sectionId: A.sectionA, day: 4, periodNo: 1, room: 'HALL' }), lesson(A, v, { sectionId: A.sectionB, day: 4, periodNo: 1, staffId: teacher2, room: 'hall' })]);
    expect(rooms.map((r) => r.status).sort()).toEqual([200, 409]);
  });

  it('only drafts are editable; publish archives the previous version; history is kept; a draft can be cloned and republished', async () => {
    const v1 = await draft(A, 'Term 1');
    expect((await A.owner.post(`/timetable/versions/${v1}/publish`)).status).toBe(400); // nothing to publish yet
    await lesson(A, v1, {});
    const pub1 = await A.owner.post(`/timetable/versions/${v1}/publish`);
    expect(pub1.status).toBe(200);
    expect(pub1.body.data).toMatchObject({ status: 'published', versionNo: 1 });
    // published is read-only
    expect((await lesson(A, v1, { periodNo: 2 })).status).toBe(409);
    expect((await A.owner.patch(`/timetable/versions/${v1}`, { name: 'Renamed' })).status).toBe(409);
    expect((await A.owner.post(`/timetable/versions/${v1}/publish`)).status).toBe(409);

    // new version via clone, change a lesson, publish: v1 is archived, not deleted
    const c = await A.owner.post(`/timetable/versions/${v1}/clone`, { name: 'Term 2' });
    expect(c.status).toBe(201);
    expect(c.body.data).toMatchObject({ status: 'draft', versionNo: 2, basedOnVersionId: v1 });
    const v2 = c.body.data.id as string;
    expect((await lesson(A, v2, { subjectId: sub2, staffId: teacher2 })).status).toBe(200);
    expect((await A.owner.post(`/timetable/versions/${v2}/publish`)).status).toBe(200);
    const all = (await A.owner.get('/timetable/versions')).body.data as Array<{ versionNo: number; status: string; lessonCount: number }>;
    expect(all.map((x) => `${x.versionNo}:${x.status}:${x.lessonCount}`).sort()).toEqual(['1:archived:1', '2:published:1']);
    // readers see v2 only; the archived v1 still holds the old lesson for editors
    const cur = await A.teacher.get(`/timetable/sections/${A.sectionA}`);
    expect(cur.body.data.version).toMatchObject({ versionNo: 2, status: 'published' });
    expect(cur.body.data.lessons[0]).toMatchObject({ subject: 'English', teacher: 'Raj Teacher' });
    const old = await A.owner.get(`/timetable/sections/${A.sectionA}?versionId=${v1}`);
    expect(old.body.data.lessons[0]).toMatchObject({ subject: 'Mathematics', teacher: 'Tina Teacher' });
    // audit trail
    const actions = (await _auditRowsForTest({ schoolId: A.school.schoolId })).map((r) => r.action);
    expect(actions).toEqual(expect.arrayContaining(['timetable.version_created', 'timetable.lesson_added', 'timetable.lesson_changed', 'timetable.published', 'timetable.version_cloned']));
  });

  it('two simultaneous publishes of different drafts leave exactly one published version', async () => {
    const a = await draft(A, 'A');
    const b = await draft(A, 'B');
    await lesson(A, a, {});
    await lesson(A, b, {});
    const res = await Promise.all([A.owner.post(`/timetable/versions/${a}/publish`), A.owner.post(`/timetable/versions/${b}/publish`)]);
    expect(res.every((r) => [200, 409].includes(r.status))).toBe(true);
    const published = ((await A.owner.get('/timetable/versions')).body.data as Array<{ status: string }>).filter((x) => x.status === 'published');
    expect(published).toHaveLength(1);
  });

  it('removing lessons and editing the grid is blocked while lessons would be orphaned', async () => {
    const v = await draft(A);
    const l = await lesson(A, v, { periodNo: 4 });
    expect((await A.owner.patch(`/timetable/versions/${v}`, { periods: PERIODS.slice(0, 2) })).status).toBe(409); // period 4 removed while used
    expect((await A.owner.patch(`/timetable/versions/${v}`, { workingDays: [2, 3] })).status).toBe(409); // Monday removed while used
    expect((await A.owner.delete(`/timetable/versions/${v}/lessons/${l.body.data.id}`)).status).toBe(204);
    expect((await A.owner.patch(`/timetable/versions/${v}`, { periods: PERIODS.slice(0, 2), workingDays: [2, 3] })).status).toBe(200);
    expect((await A.owner.delete(`/timetable/versions/${v}/lessons/${l.body.data.id}`)).status).toBe(404);
  });

  it('availability lists free and busy teachers and busy rooms for a period', async () => {
    const v = await draft(A);
    await lesson(A, v, { room: 'R1' });
    const a = (await A.owner.get(`/timetable/versions/${v}/availability?day=1&periodNo=1`)).body.data;
    expect(a.busyTeachers.map((x: { name: string }) => x.name)).toEqual(['Tina Teacher']);
    expect(a.freeTeachers.map((x: { name: string }) => x.name)).toEqual(['Raj Teacher']);
    expect(a.busyRooms).toEqual(['R1']);
  });

  it('who can do what: editors edit; teachers/principal read only the published timetable; drafts are hidden; parents and students have their own views', async () => {
    const v = await draft(A);
    await lesson(A, v, {});
    // a teacher cannot create/edit/publish/see the version list
    expect((await A.teacher.post('/timetable/versions', { name: 'x', periods: PERIODS })).status).toBe(403);
    expect((await A.teacher.put(`/timetable/versions/${v}/lessons`, { sectionId: A.sectionA, day: 1, periodNo: 2, subjectId: A.subjectId, staffId: A.teacherStaffId })).status).toBe(403);
    expect((await A.teacher.post(`/timetable/versions/${v}/publish`)).status).toBe(403);
    expect((await A.teacher.get('/timetable/versions')).status).toBe(403);
    expect((await A.teacher.get(`/timetable/versions/${v}/availability?day=1&periodNo=1`)).status).toBe(403);
    // drafts are invisible to readers and cannot be previewed by them
    expect((await A.teacher.get(`/timetable/sections/${A.sectionA}`)).body.data.lessons).toEqual([]);
    expect((await A.teacher.get(`/timetable/sections/${A.sectionA}?versionId=${v}`)).status).toBe(403);
    expect((await A.owner.get(`/timetable/sections/${A.sectionA}?versionId=${v}`)).body.data.lessons).toHaveLength(1);

    await A.owner.post(`/timetable/versions/${v}/publish`);
    expect((await A.teacher.get(`/timetable/sections/${A.sectionA}`)).body.data.lessons).toHaveLength(1);
    const mine = await A.teacher.get('/timetable/me');
    expect(mine.status).toBe(200);
    expect(mine.body.data.teacher).toBe('Tina Teacher');
    expect(mine.body.data.lessons).toHaveLength(1);
    expect((await A.teacher.get(`/timetable/teachers/${teacher2}`)).body.data.lessons).toEqual([]);
    expect((await A.owner.get('/timetable/me')).status).toBe(403); // owner has no staff record linked: not a teacher view

    // student: their own class only, no ids in the URL
    const stu = await seedStudentLogin(app, A, A.studentsA[0]!); // section A
    expect((await stu.client.get('/student/me/timetable')).body.data.lessons).toHaveLength(1);
    const stuB = await seedStudentLogin(app, A, A.studentsB[0]!); // section B has no lessons
    expect((await stuB.client.get('/student/me/timetable')).body.data.lessons).toEqual([]);
    expect((await stu.client.get(`/timetable/sections/${A.sectionB}`)).status).toBe(403); // staff-style route is closed to students (own scope only)
    expect((await stu.client.get('/timetable/me')).status).toBe(403);
    expect((await stu.client.post('/timetable/versions', { name: 'x', periods: PERIODS })).status).toBe(403);

    // parent: only a linked child
    const p = await seedParent(app, A, A.studentsA[0]!, 'ravi@parents.test');
    expect((await p.client.get(`/parent/children/${A.studentsA[0]}/timetable`)).body.data.lessons).toHaveLength(1);
    expect((await p.client.get(`/parent/children/${A.studentsA[1]}/timetable`)).status).toBe(404);
    expect((await p.client.get(`/parent/children/${B.studentsA[0]}/timetable`)).status).toBe(404);
    expect((await p.client.get(`/timetable/sections/${A.sectionA}`)).status).toBe(403);
    // staff are not parents
    expect((await A.owner.get(`/parent/children/${A.studentsA[0]}/timetable`)).status).toBe(403);
  });

  it('two schools never see or touch each other\'s timetables (IDs from the other school are 404)', async () => {
    const va = await draft(A, 'Alpha');
    await lesson(A, va, {});
    await A.owner.post(`/timetable/versions/${va}/publish`);
    const vb = await draft(B, 'Bravo');
    await lesson(B, vb, {});
    await B.owner.post(`/timetable/versions/${vb}/publish`);

    for (const call of [
      () => B.owner.get(`/timetable/versions/${va}`), () => B.owner.patch(`/timetable/versions/${va}`, { name: 'x' }), () => B.owner.post(`/timetable/versions/${va}/clone`, {}),
      () => B.owner.post(`/timetable/versions/${va}/publish`), () => B.owner.get(`/timetable/versions/${va}/availability?day=1&periodNo=1`),
      () => B.owner.put(`/timetable/versions/${va}/lessons`, { sectionId: B.sectionA, day: 2, periodNo: 1, subjectId: B.subjectId, staffId: B.teacherStaffId }),
      () => B.owner.get(`/timetable/sections/${A.sectionA}`), () => B.owner.get(`/timetable/teachers/${A.teacherStaffId}`),
    ]) expect((await call()).status).toBe(404);
    expect(((await B.owner.get('/timetable/versions')).body.data as unknown[]).length).toBe(1);
    expect((await B.teacher.get(`/timetable/sections/${B.sectionA}`)).body.data.lessons[0].teacher).toBe('Tina Teacher');
    const ids = JSON.stringify((await B.owner.get(`/timetable/sections/${B.sectionA}`)).body);
    expect(ids).not.toContain(A.sectionA);
    expect(new Client(app)).toBeTruthy();
  });
});
