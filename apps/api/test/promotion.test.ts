import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { Types } from 'mongoose';
import { setupTestDb, teardownTestDb, clearAll } from './helpers/db';
import { makeTestApp } from './helpers/app';
import { buildFeeData, buildSchoolData, todayIst, type SchoolData } from './helpers/fixtures';
import { runAsPlatform } from '../src/core/tenancy/context';
import { EnrollmentModel } from '../src/modules/students/students.model';
import { AttendanceRecordModel } from '../src/modules/attendance/attendance.model';
import { InvoiceModel } from '../src/modules/fees/fees.model';

const t = makeTestApp();
const { app } = t;
let A: SchoolData;
let B: SchoolData;
beforeAll(setupTestDb);
afterAll(teardownTestDb);
beforeEach(async () => {
  await clearAll();
  A = await buildSchoolData(app, 'alpha');
  B = await buildSchoolData(app, 'bravo');
});

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const snap = (model: any, f: object) => runAsPlatform('test: snapshot', async () => JSON.stringify(await model.find(f).sort({ _id: 1 }).lean()));

describe('REQ-PRO year-end promotion (acceptance scenario 7)', () => {
  it('prepare → preview → commit (all-or-nothing, replaceable) → old year untouched until activation → activation closes old enrolments; history unchanged', async () => {
    // a top class with one student who will graduate
    const c6 = await A.owner.post('/classes', { sessionId: A.sessionId, name: 'Class 6', order: 6 });
    const s6 = await A.owner.post('/sections', { classId: c6.body.data.id, name: 'A' });
    const senior = await A.owner.post('/students', { admissionNo: 'SR-1', firstName: 'Senior', dob: '2012-01-01', enrollment: { sectionId: s6.body.data.id } });
    // history in the old year: attendance, fees
    await A.owner.put(`/attendance/sections/${A.sectionA}`, { date: todayIst(), entries: [{ studentId: A.studentsA[0], status: 'absent' }] });
    await buildFeeData(A, 'promo');
    const next = await A.owner.post('/academics/sessions', { name: '2100-01', startDate: '2100-01-01', endDate: '2100-12-31' });
    const target = next.body.data.id as string;

    expect((await A.teacher.post('/promotions/prepare', { targetSessionId: target })).status).toBe(403);
    expect((await A.owner.post('/promotions/prepare', { targetSessionId: B.sessionId })).status).toBe(404); // other school's session
    const prep = await A.owner.post('/promotions/prepare', { targetSessionId: target, copyFeeStructures: true });
    expect(prep.body.data).toEqual({ classesCreated: 2, sectionsCreated: 3, feeStructuresCopied: 1 });
    expect((await A.owner.post('/promotions/prepare', { targetSessionId: target })).body.data).toMatchObject({ classesCreated: 0, sectionsCreated: 0 }); // idempotent

    const plan = (await A.owner.get(`/promotions/preview?targetSessionId=${target}`)).body.data as Array<{ className: string; nextClass: { name: string; sections: Array<{ id: string; name: string }> } | null; sameClass: { sections: Array<{ id: string; name: string }> } | null; students: Array<{ studentId: string; suggested: string; suggestedSectionId: string | null }> }>;
    const p5 = plan.find((p) => p.className === 'Class 5')!;
    const p6 = plan.find((p) => p.className === 'Class 6')!;
    expect(p5.nextClass!.name).toBe('Class 6');
    expect(p5.students.every((s) => s.suggested === 'promote')).toBe(true);
    expect(p6.nextClass).toBeNull();
    expect(p6.students[0]).toMatchObject({ studentId: senior.body.data.id, suggested: 'graduate' });
    const new6A = p5.nextClass!.sections.find((s) => s.name === 'A')!.id;
    const new5A = p5.sameClass!.sections.find((s) => s.name === 'A')!.id;

    const old = { enr: await snap(EnrollmentModel, { schoolId: A.school.schoolId, sessionId: new Types.ObjectId(A.sessionId) }), att: await snap(AttendanceRecordModel, { schoolId: A.school.schoolId }), inv: await snap(InvoiceModel, { schoolId: A.school.schoolId }) };
    const key = (n: string) => ({ 'Idempotency-Key': `promo-${n}-${Date.now()}` });
    const bad = await A.owner.post('/promotions/commit', { targetSessionId: target, decisions: [{ studentId: A.studentsA[0], action: 'promote', sectionId: new6A }, { studentId: A.studentsA[1], action: 'promote', sectionId: new5A }] }, key('bad'));
    expect(bad.status).toBe(400); // "promotion" into the same class — whole batch refused
    expect(await snap(EnrollmentModel, { schoolId: A.school.schoolId, sessionId: new Types.ObjectId(target) })).toBe('[]');

    const decisions = [
      { studentId: A.studentsA[0], action: 'retain', sectionId: new5A }, // first decision, changed below
      { studentId: A.studentsA[1], action: 'retain', sectionId: new5A },
      ...A.studentsA.slice(2).map((s) => ({ studentId: s, action: 'promote', sectionId: new6A })),
      ...A.studentsB.map((s) => ({ studentId: s, action: 'promote', sectionId: new6A })),
      { studentId: senior.body.data.id, action: 'graduate' },
    ];
    const ok = await A.owner.post('/promotions/commit', { targetSessionId: target, decisions }, key('ok'));
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
    expect(ok.body.data).toEqual({ promote: 4, retain: 2, graduate: 1 });
    const change = await A.owner.post('/promotions/commit', { targetSessionId: target, decisions: [{ studentId: A.studentsA[0], action: 'promote', sectionId: new6A }] }, key('change'));
    expect(change.body.data).toEqual({ promote: 1, retain: 0, graduate: 0 });
    const newEnr = await runAsPlatform('test', async () => EnrollmentModel.find({ schoolId: A.school.schoolId, sessionId: new Types.ObjectId(target) }).lean());
    expect(newEnr).toHaveLength(6); // 7 decisions − 1 graduate; the changed decision replaced (not duplicated)
    expect(newEnr.filter((e) => String(e.sectionId) === new6A)).toHaveLength(5); // A1 (changed to promote), A3, B1–B3

    // nothing in the current year moved yet: attendance can still be marked
    expect(await snap(EnrollmentModel, { schoolId: A.school.schoolId, sessionId: new Types.ObjectId(A.sessionId) })).toBe(old.enr);
    expect((await A.owner.put(`/attendance/sections/${A.sectionA}`, { date: todayIst(), entries: [{ studentId: A.studentsA[0], status: 'absent' }] })).status).toBe(200);
    old.att = await snap(AttendanceRecordModel, { schoolId: A.school.schoolId }); // baseline for the activation step

    // year end: close old, activate new → decisions take effect
    expect((await A.owner.post(`/academics/sessions/${A.sessionId}/close`)).status).toBe(200);
    const act = await A.owner.post(`/academics/sessions/${target}/activate`);
    expect(act.body.data.promotionsApplied).toBe(7);
    const after = await runAsPlatform('test', async () => EnrollmentModel.find({ schoolId: A.school.schoolId, sessionId: new Types.ObjectId(A.sessionId) }).sort({ _id: 1 }).lean());
    const before = JSON.parse(old.enr) as Array<Record<string, unknown>>;
    for (const [i, e] of after.entries()) {
      const b = before[i]!;
      // only status / leftOn / audit fields changed; class, section, roll, dates are untouched
      for (const k of ['studentId', 'sessionId', 'classId', 'sectionId', 'rollNo', 'joinedOn']) expect(JSON.stringify((e as Record<string, unknown>)[k])).toBe(JSON.stringify(b[k]));
    }
    expect(after.find((e) => String(e.studentId) === A.studentsA[0])!.status).toBe('promoted');
    expect(after.find((e) => String(e.studentId) === A.studentsA[1])!.status).toBe('retained');
    expect(after.find((e) => String(e.studentId) === senior.body.data.id)!.status).toBe('graduated');
    expect(await snap(AttendanceRecordModel, { schoolId: A.school.schoolId })).toBe(old.att); // old attendance unchanged
    expect(await snap(InvoiceModel, { schoolId: A.school.schoolId })).toBe(old.inv); // old invoices unchanged
    expect((await A.owner.get(`/students/${senior.body.data.id}`)).body.data.status).toBe('graduated');
    const p = await A.owner.get(`/students/${A.studentsA[0]}`);
    expect(p.body.data.enrollment).toMatchObject({ sectionId: new6A, sessionId: target });
    expect((await A.owner.get(`/fees/students/${A.studentsA[0]}/summary`)).body.data.invoices.length).toBeGreaterThan(0); // dues carried with the student
    expect((await A.owner.get(`/students?sectionId=${new6A}`)).body.meta.total).toBe(5);
    expect((await A.owner.get(`/fees/structures?sessionId=${target}`)).body.data[0]).toMatchObject({ status: 'draft', name: 'Standard' });
  });
});
