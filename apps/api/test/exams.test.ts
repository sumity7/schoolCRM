import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { DEFAULT_BANDS, computeResult, rankResults, validateBands, type SubjectInput } from '@edunex/shared';
import { setupTestDb, teardownTestDb, clearAll } from './helpers/db';
import { loggedIn, makeTestApp, seedMember, type Client } from './helpers/app';
import { buildSchoolData, seedParent, type SchoolData } from './helpers/fixtures';

const bands = [{ minPct: 50, grade: 'P' }, { minPct: 0, grade: 'F' }];
const subj = (o: number | null, status: SubjectInput['status'] = 'entered', max = 100, pass = 33): SubjectInput => ({ subjectId: `s${Math.random()}`, maxMarks: max, passMarks: pass, obtained: o, status });

describe('REQ-EXM-001 grading rules (pure, deterministic)', () => {
  it('grade boundaries: 49.99 % is below a 50 % band, 50.00 % is in it; percentage rounds half-up to 2 decimals', () => {
    expect(computeResult([subj(4999, 'entered', 10_000, 0)], bands)).toMatchObject({ percentage: 49.99, grade: 'F' });
    expect(computeResult([subj(5000, 'entered', 10_000, 0)], bands)).toMatchObject({ percentage: 50, grade: 'P' });
    expect(computeResult([subj(1, 'entered', 3, 0)], bands).percentage).toBe(33.33);
    expect(computeResult([subj(2, 'entered', 3, 0)], bands).percentage).toBe(66.67);
    expect(computeResult([subj(49.995, 'entered', 100, 0)], bands).percentage).toBe(50);
  });
  it('missing marks ⇒ incomplete (never zero); absent fails by policy or is excluded; exempt is excluded', () => {
    expect(computeResult([subj(80), subj(null)], DEFAULT_BANDS)).toMatchObject({ resultStatus: 'incomplete', percentage: null });
    expect(computeResult([subj(80), subj(null, 'not_entered')], DEFAULT_BANDS).resultStatus).toBe('incomplete');
    expect(computeResult([subj(80), subj(null, 'absent')], DEFAULT_BANDS)).toMatchObject({ resultStatus: 'fail', totalMax: 200, totalObtained: 80, percentage: 40 });
    expect(computeResult([subj(80), subj(null, 'absent')], DEFAULT_BANDS, { absentIsFail: false })).toMatchObject({ resultStatus: 'pass', totalMax: 100, percentage: 80 });
    expect(computeResult([subj(80), subj(null, 'exempt')], DEFAULT_BANDS)).toMatchObject({ resultStatus: 'pass', totalMax: 100, percentage: 80 });
    expect(computeResult([subj(32), subj(99)], DEFAULT_BANDS).resultStatus).toBe('fail'); // one subject below pass marks
    expect(computeResult([subj(33), subj(99)], DEFAULT_BANDS).resultStatus).toBe('pass');
  });
  it('ties share a rank (1,2,2,4); incomplete gets none; same inputs ⇒ identical output', () => {
    const ranked = rankResults([{ percentage: 90, resultStatus: 'pass' }, { percentage: 80, resultStatus: 'pass' }, { percentage: 80, resultStatus: 'fail' }, { percentage: 70, resultStatus: 'pass' }, { percentage: null, resultStatus: 'incomplete' }]);
    expect(ranked.map((r) => r.rank)).toEqual([1, 2, 2, 4, null]);
    const inputs = [subj(71.5), subj(45, 'entered', 50, 17), subj(null, 'exempt')];
    expect(JSON.stringify(computeResult(inputs, DEFAULT_BANDS))).toBe(JSON.stringify(computeResult(inputs, DEFAULT_BANDS)));
    expect(validateBands([{ minPct: 40, grade: 'A' }])).toMatch(/0%/);
    expect(validateBands(DEFAULT_BANDS)).toBeNull();
  });
});

const t = makeTestApp();
const { app } = t;
let A: SchoolData;
let acc: Client;
beforeAll(setupTestDb);
afterAll(teardownTestDb);
beforeEach(async () => {
  await clearAll();
  A = await buildSchoolData(app, 'alpha');
  await seedMember(A.school.schoolId, 'acc@alpha.test', ['accountant']);
  acc = await loggedIn(app, 'acc@alpha.test');
});

async function setupExam() {
  const eng = await A.owner.post('/subjects', { code: 'ENG', name: 'English', type: 'core' });
  const scale = await A.owner.post('/exams/grading-scales', { name: 'CBSE-like', bands: DEFAULT_BANDS });
  expect(scale.status, JSON.stringify(scale.body)).toBe(201);
  expect((await A.teacher.post(`/exams/grading-scales/${scale.body.data.id}/publish`)).status).toBe(403);
  await A.owner.post(`/exams/grading-scales/${scale.body.data.id}/publish`);
  const ex = await A.owner.post('/exams', { name: 'Half yearly', type: 'midterm', classIds: [A.classId], gradingScaleId: scale.body.data.id });
  expect(ex.status, JSON.stringify(ex.body)).toBe(201);
  const s = await A.owner.put(`/exams/${ex.body.data.id}/subjects`, { subjects: [{ classId: A.classId, subjectId: A.subjectId, maxMarks: 100, passMarks: 33 }, { classId: A.classId, subjectId: eng.body.data.id, maxMarks: 50, passMarks: 17 }] });
  expect(s.status, JSON.stringify(s.body)).toBe(200);
  return { examId: ex.body.data.id as string, maths: A.subjectId, english: eng.body.data.id as string };
}
const entries = (ids: string[], marks: Array<number | null | 'AB'>) => ids.map((studentId, i) => (marks[i] === 'AB' ? { studentId, obtained: null, status: 'absent' } : { studentId, obtained: marks[i] as number | null, status: 'entered' }));

describe('REQ-EXM-010 exam workflow (acceptance scenarios 3 & 4)', () => {
  it('marks entry is scoped: teacher only for assigned section+subject, accountant never; invalid marks save nothing', async () => {
    const { examId, maths, english } = await setupExam();
    expect((await A.teacher.put(`/exams/${examId}/marks`, { sectionId: A.sectionA, subjectId: maths, entries: entries(A.studentsA, [80, 70, 60]) })).status).toBe(409); // not open yet
    await A.owner.post(`/exams/${examId}/open-marks`);
    expect((await A.teacher.put(`/exams/${examId}/marks`, { sectionId: A.sectionA, subjectId: maths, entries: entries(A.studentsA, [80, 70, 60]) })).status).toBe(200);
    expect((await A.teacher.put(`/exams/${examId}/marks`, { sectionId: A.sectionA, subjectId: english, entries: entries(A.studentsA, [40, 30, 20]) })).status).toBe(403); // not their subject
    expect((await A.teacher.put(`/exams/${examId}/marks`, { sectionId: A.sectionB, subjectId: maths, entries: entries(A.studentsB, [40, 30, 20]) })).status).toBe(403); // not their section (scenario 3)
    expect((await acc.put(`/exams/${examId}/marks`, { sectionId: A.sectionA, subjectId: maths, entries: entries(A.studentsA, [1, 1, 1]) })).status).toBe(403); // accountant (scenario 4)
    const bad = await A.owner.put(`/exams/${examId}/marks`, { sectionId: A.sectionA, subjectId: english, entries: entries(A.studentsA, [40, 51, 20]) }); // 51 > max 50
    expect(bad.status).toBe(400);
    expect((await A.owner.put(`/exams/${examId}/marks`, { sectionId: A.sectionA, subjectId: english, entries: entries(A.studentsA, [40, 12.345, 20]) })).status).toBe(400); // >2 decimals
    const sheet = await A.teacher.get(`/exams/${examId}/marks?sectionId=${A.sectionA}&subjectId=${english}`);
    expect(sheet.status).toBe(403);
    const ownerSheet = await A.owner.get(`/exams/${examId}/marks?sectionId=${A.sectionA}&subjectId=${english}`);
    expect(ownerSheet.body.data.students.every((s: { obtained: number | null }) => s.obtained === null)).toBe(true); // the invalid saves wrote nothing
  });

  it('compute → incomplete blocks publish → complete → publish (immutable) → correction is version 2, version 1 kept; parents see only published', async () => {
    const { examId, maths, english } = await setupExam();
    await A.owner.post(`/exams/${examId}/open-marks`);
    await A.owner.put(`/exams/${examId}/marks`, { sectionId: A.sectionA, subjectId: maths, entries: entries(A.studentsA, [90, 75.5, 'AB']) });
    await A.owner.put(`/exams/${examId}/marks`, { sectionId: A.sectionA, subjectId: english, entries: entries(A.studentsA, [45, 40, 30]) });
    expect((await A.owner.post(`/exams/${examId}/results/compute`)).status).toBe(409); // not locked
    await A.owner.post(`/exams/${examId}/lock-marks`);
    const c1 = await A.owner.post(`/exams/${examId}/results/compute`);
    expect(c1.body.data).toMatchObject({ students: 6, incomplete: 3 }); // section B has no marks yet
    expect((await A.owner.post(`/exams/${examId}/results/publish`)).status).toBe(409);
    await A.owner.post(`/exams/${examId}/open-marks`);
    await A.owner.put(`/exams/${examId}/marks`, { sectionId: A.sectionB, subjectId: maths, entries: entries(A.studentsB, [50, 50, 20]) });
    await A.owner.put(`/exams/${examId}/marks`, { sectionId: A.sectionB, subjectId: english, entries: entries(A.studentsB, [25, 30, 25]) });
    await A.owner.post(`/exams/${examId}/lock-marks`);
    const c2 = await A.owner.post(`/exams/${examId}/results/compute`);
    expect(c2.body.data).toMatchObject({ students: 6, incomplete: 0, fail: 2 }); // A3 absent in maths, B3 20 < 33
    const first = (await A.owner.get(`/exams/${examId}/results?sectionId=${A.sectionA}`)).body.data;
    const again = await A.owner.post(`/exams/${examId}/results/compute`); // determinism: recompute gives identical numbers
    expect(again.status).toBe(200);
    const second = (await A.owner.get(`/exams/${examId}/results?sectionId=${A.sectionA}`)).body.data;
    const strip = (rows: Array<Record<string, unknown>>) => rows.map(({ id: _i, ...r }) => r);
    expect(strip(second)).toEqual(strip(first));
    expect(first.map((r: { student: { name: string }; percentage: number; rank: number; grade: string }) => `${r.student.name}:${r.percentage}:${r.rank}:${r.grade}`)).toEqual(['Asha1 Rao:90:1:A2', 'Asha2 Rao:77:2:B1', 'Asha3 Rao:20:3:E']);

    // parent of Asha1 sees nothing before publication
    const parent = await seedParent(app, A, A.studentsA[0]!, 'ravi@parents.test');
    expect((await parent.client.get(`/parent/children/${A.studentsA[0]}/results`)).body.data).toEqual([]);
    expect((await A.teacher.post(`/exams/${examId}/results/publish`)).status).toBe(403);
    expect((await A.owner.post(`/exams/${examId}/results/publish`)).status).toBe(200);
    const pr = (await parent.client.get(`/parent/children/${A.studentsA[0]}/results`)).body.data;
    expect(pr).toHaveLength(1);
    expect(pr[0]).toMatchObject({ examName: 'Half yearly', percentage: 90, resultStatus: 'pass', version: 1 });
    expect((await parent.client.get(`/parent/children/${A.studentsA[0]}/results/${pr[0].id}/report-card.pdf`)).status).toBe(200);
    const otherResult = first.find((r: { student: { name: string } }) => r.student.name === 'Asha2 Rao').id;
    expect((await parent.client.get(`/parent/children/${A.studentsA[0]}/results/${otherResult}/report-card.pdf`)).status).toBe(404);

    // published = immutable
    expect((await A.owner.put(`/exams/${examId}/marks`, { sectionId: A.sectionA, subjectId: maths, entries: entries([A.studentsA[2]!], [50]) })).status).toBe(409);
    expect((await A.owner.post(`/exams/${examId}/open-marks`)).status).toBe(409);
    expect((await A.owner.post(`/exams/${examId}/results/compute`)).status).toBe(409);
    // correction: Asha3 was marked absent by mistake
    expect((await A.teacher.post(`/exams/${examId}/results/students/${A.studentsA[2]}/correct`, { reason: 'Wrongly marked absent', marks: [{ subjectId: maths, obtained: 64, status: 'entered' }] })).status).toBe(403);
    const fix = await A.owner.post(`/exams/${examId}/results/students/${A.studentsA[2]}/correct`, { reason: 'Wrongly marked absent', marks: [{ subjectId: maths, obtained: 64, status: 'entered' }] });
    expect(fix.status, JSON.stringify(fix.body)).toBe(200);
    expect(fix.body.data).toMatchObject({ version: 2, percentage: 62.67, resultStatus: 'pass', correction: { reason: 'Wrongly marked absent', previousVersion: 1 } });
    const hist = (await A.owner.get(`/exams/${examId}/results?sectionId=${A.sectionA}&history=true`)).body.data.filter((r: { studentId: string }) => r.studentId === A.studentsA[2]);
    expect(hist.map((r: { version: number; current: boolean; percentage: number }) => `${r.version}:${r.current}:${r.percentage}`).sort()).toEqual(['1:false:20', '2:true:62.67']);
    const pdf = await A.owner.get(`/results/${fix.body.data.id}/report-card.pdf`);
    expect(pdf.status).toBe(200);
    expect(pdf.headers['content-type']).toBe('application/pdf');
    expect((await A.teacher.get(`/exams/${examId}/results?sectionId=${A.sectionB}`)).status).toBe(403); // teacher: own sections only
    expect((await A.teacher.get(`/exams/${examId}/results?sectionId=${A.sectionA}`)).status).toBe(200);
  });
});
