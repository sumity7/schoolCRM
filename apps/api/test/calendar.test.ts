import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { setupTestDb, teardownTestDb, clearAll } from './helpers/db';
import { makeTestApp } from './helpers/app';
import { buildExamData, buildSchoolData, seedParent, seedStudentLogin, todayIst, type SchoolData } from './helpers/fixtures';

const { app } = makeTestApp();
let A: SchoolData;
let B: SchoolData;
beforeAll(setupTestDb);
afterAll(teardownTestDb);
beforeEach(async () => {
  await clearAll();
  A = await buildSchoolData(app, 'alpha');
  B = await buildSchoolData(app, 'bravo');
});

type Cal = { events: Array<{ title: string; type: string }>; exams: Array<{ name: string; subjects: Array<{ subject: string; date: string | null; maxMarks: number }> }> };

describe('REQ-CAL school calendar & exam schedule for parents and students', () => {
  it('shows school-wide holidays/events and the exams of the child’s own class; draft exams stay hidden', async () => {
    const day = todayIst();
    expect((await A.owner.post('/academics/calendar/events', { date: day, type: 'holiday', title: 'Diwali break' })).status).toBe(201);
    expect((await A.owner.post('/academics/calendar/events', { date: day, type: 'ptm', title: 'Parent-teacher meeting' })).status).toBe(201);
    await B.owner.post('/academics/calendar/events', { date: day, type: 'holiday', title: 'Bravo only holiday' });
    await buildExamData(A); // "Unit test 1" for Class 5, maths, computed (not a draft)
    const draft = await A.owner.post('/exams', { name: 'Secret draft exam', type: 'final', classIds: [A.classId], gradingScaleId: (await A.owner.get('/exams/grading-scales')).body.data[0].id });
    expect(draft.status).toBe(201);

    const p = await seedParent(app, A, A.studentsA[0]!, 'ravi@parents.test');
    const s = await seedStudentLogin(app, A, A.studentsA[1]!);
    for (const res of [await p.client.get(`/parent/children/${A.studentsA[0]}/calendar`), await s.client.get('/student/me/calendar')]) {
      expect(res.status).toBe(200);
      const cal = res.body.data as Cal;
      expect(cal.events.map((e) => e.title).sort()).toEqual(['Diwali break', 'Parent-teacher meeting', 'Republic Day']); // + the fixture's own holiday
      expect(cal.exams.map((e) => e.name)).toEqual(['Unit test 1']); // the draft is not shown
      expect(cal.exams[0]!.subjects).toEqual([{ subject: 'Mathematics', date: null, maxMarks: 50 }]);
      expect(JSON.stringify(cal)).not.toMatch(/Bravo only|Secret draft/);
    }
  });

  it('parents only for linked children; staff, other families and other schools are refused', async () => {
    const p = await seedParent(app, A, A.studentsA[0]!, 'ravi@parents.test');
    expect((await p.client.get(`/parent/children/${A.studentsA[1]}/calendar`)).status).toBe(404); // classmate
    expect((await p.client.get(`/parent/children/${B.studentsA[0]}/calendar`)).status).toBe(404); // other school
    expect((await A.owner.get(`/parent/children/${A.studentsA[0]}/calendar`)).status).toBe(403); // staff are not parents
    expect((await A.owner.get('/student/me/calendar')).status).toBe(403); // staff are not students
    expect((await p.client.get('/student/me/calendar')).status).toBe(403); // parents are not students
    await A.owner.patch(`/students/${A.studentsA[0]}/guardians/${p.linkId}`, { ended: true }); // link revoked
    expect((await p.client.get(`/parent/children/${A.studentsA[0]}/calendar`)).status).toBe(404);
  });
});
