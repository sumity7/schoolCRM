import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { Types } from 'mongoose';
import { mappingProblems, parseImportDate, suggestStudentMapping } from '@edunex/shared';
import { setupTestDb, teardownTestDb, clearAll } from './helpers/db';
import { makeTestApp, type Client } from './helpers/app';
import { buildSchoolData, todayIst, type SchoolData } from './helpers/fixtures';
import { parseCsv, sanitizeCell, toCsv } from '../src/core/csv/csv';
import { _auditRowsForTest } from '../src/core/audit/audit.service';
import { runAsPlatform, runWithTenant } from '../src/core/tenancy/context';
import { withTransaction } from '../src/core/db/connection';
import { studentRepo } from '../src/modules/students/students.repository';
import { makeCtx } from './helpers/tenant';
import { GuardianModel, StudentGuardianModel, StudentModel, EnrollmentModel } from '../src/modules/students/students.model';

const t = makeTestApp();
const { app } = t;
let A: SchoolData;

beforeAll(setupTestDb);
afterAll(teardownTestDb);
beforeEach(async () => {
  await clearAll();
  A = await buildSchoolData(app, 'alpha');
});

const HEAD = 'Admission No,Student Name,DOB,Gender,Class,Section,Roll No,Father Name,Relation,Parent Mobile';
const csvOf = (lines: string[]) => [HEAD, ...lines].join('\r\n');
let keyN = 0;
const key = () => `test-key-${Date.now()}-${keyN++}`;

async function upload(c: Client, csv: string, filename = 'students.csv') {
  return c.post('/imports', { entity: 'students', filename, csv });
}
async function uploadValidated(c: Client, csv: string) {
  const up = await upload(c, csv);
  expect(up.status, JSON.stringify(up.body)).toBe(201);
  const v = await c.post(`/imports/${up.body.data.id}/validate`, {});
  expect(v.status, JSON.stringify(v.body)).toBe(200);
  return v.body.data;
}
const commit = (c: Client, id: string, k = key()) => c.post(`/imports/${id}/commit`, {}, { 'Idempotency-Key': k });
const dbCount = (model: { countDocuments(f: object): Promise<number> }, f: object) => runAsPlatform('test', async () => await model.countDocuments(f));

describe('REQ-IMP CSV primitives', () => {
  it('parses BOM, quoted commas/newlines, doubled quotes, CRLF, semicolons and pads short rows', () => {
    const p = parseCsv('﻿a,b,c\r\n1,"x, y","he said ""hi"""\n2,"multi\nline"\n\n');
    expect(p.headers).toEqual(['a', 'b', 'c']);
    expect(p.rows).toEqual([['1', 'x, y', 'he said "hi"'], ['2', 'multi\nline', '']]);
    expect(parseCsv('a;b\n1;2').rows).toEqual([['1', '2']]);
    expect(() => parseCsv('a,b\n"open')).toThrow(/unclosed quote/);
    expect(() => parseCsv('a\n1\n2\n3', { maxRows: 2 })).toThrow(/more than 2 rows/);
  });
  it('neutralises formula injection (= + - @ TAB CR) and round-trips through the parser', () => {
    for (const bad of ['=HYPERLINK("http://x","y")', '+1+1', '-2+3', '@SUM(A1)', '\tx', '\rx']) expect(sanitizeCell(bad).startsWith("'")).toBe(true);
    expect(sanitizeCell('Asha')).toBe('Asha');
    const csv = toCsv(['Name', 'Note'], [['=cmd|calc', 'a, "b"'], ['राम', null]]);
    const back = parseCsv(csv);
    expect(back.rows).toEqual([["'=cmd|calc", 'a, "b"'], ['राम', '']]);
  });
  it('parses dates in the chosen order, rejects impossible dates and 2-digit years', () => {
    expect(parseImportDate('05/04/2015', 'DMY')).toBe('2015-04-05');
    expect(parseImportDate('05/04/2015', 'MDY')).toBe('2015-05-04');
    expect(parseImportDate('2015.4.5', 'YMD')).toBe('2015-04-05');
    expect(parseImportDate('2015-04-05', 'DMY')).toBe('2015-04-05'); // ISO always accepted
    expect(parseImportDate('31/02/2015', 'DMY')).toBeNull();
    expect(parseImportDate('05/04/15', 'DMY')).toBeNull();
    expect(parseImportDate('soon', 'DMY')).toBeNull();
  });
  it('suggests a mapping from common header names and reports missing required columns', () => {
    const m = suggestStudentMapping(HEAD.split(','));
    expect(m).toMatchObject({ admissionNo: 0, fullName: 1, dob: 2, gender: 3, className: 4, sectionName: 5, rollNo: 6, guardianName: 7, guardianRelationship: 8, guardianPhone: 9 });
    expect(mappingProblems(m, 10)).toEqual([]);
    expect(mappingProblems({ admissionNo: 0 }, 10).join(' ')).toMatch(/First Name.*Date of Birth/);
    expect(mappingProblems({ admissionNo: 0, firstName: 0, dob: 12 }, 10).length).toBeGreaterThan(0);
  });
});

describe('REQ-IMP student import workflow (doc 11 acceptance)', () => {
  it('1,000 rows with 30 bad → 970 committed, 30 reported with line + reason; re-import → duplicates, nothing created; nothing silently dropped', async () => {
    const cls = await A.owner.post('/classes', { sessionId: A.sessionId, name: 'Class 7', order: 7 });
    for (const s of ['A', 'B']) expect((await A.owner.post('/sections', { classId: cls.body.data.id, name: s })).status).toBe(201);
    const lines: string[] = [];
    for (let i = 1; i <= 1000; i++) {
      const sec = i % 2 ? 'A' : 'B';
      let adm = `IMP-${i}`;
      let name = `Student${i} Kumar`;
      let dob = '05/06/2014';
      let gender = i % 3 ? 'F' : 'M';
      let klass = '7';
      if (i % 200 === 1) dob = '31/02/2014'; //                5 impossible dates
      else if (i % 100 === 3) klass = 'Class 99'; //          10 unknown classes
      else if (i % 200 === 5) gender = 'X'; //                 5 bad genders
      else if (i % 200 === 7) adm = `IMP-${i - 1}`; //          5 in-file duplicates (line of i-1 is fine)
      else if (i % 200 === 9) name = ''; //                    5 missing names
      const guardian = i % 10 === 0 ? `Parent${i},father,98765${String(i).padStart(5, '0')}` : ',,';
      lines.push(`${adm},${name},${dob},${gender},${klass},${sec},${Math.ceil(i / 2)},${guardian}`);
    }
    const csv = csvOf(lines);
    const v = await uploadValidated(A.owner, csv);
    expect(v.counts).toMatchObject({ total: 1000, ok: 970, error: 30, duplicate: 0 });
    expect(v.preview.length).toBe(20);
    const bad = v.problems as Array<{ line: number; status: string; messages: string[] }>;
    expect(bad).toHaveLength(30);
    expect(bad.every((p) => p.line >= 2 && p.messages.length > 0)).toBe(true);
    expect(bad.find((p) => p.line === 2)!.messages.join()).toMatch(/Date of Birth "31\/02\/2014"/); // row i=1 → file line 2
    const c = await commit(A.owner, v.id);
    expect(c.status, JSON.stringify(c.body)).toBe(200);
    expect(c.body.data.counts).toMatchObject({ created: 970, error: 30, ok: 0 });
    expect(await dbCount(StudentModel, { schoolId: A.school.schoolId, importBatchId: new Types.ObjectId(v.id) })).toBe(970);
    expect(await dbCount(EnrollmentModel, { schoolId: A.school.schoolId, importBatchId: new Types.ObjectId(v.id) })).toBe(970);

    const report = await A.owner.get(`/imports/${v.id}/errors.csv`);
    expect(report.status).toBe(200);
    expect(report.headers['content-type']).toMatch(/text\/csv/);
    const parsed = parseCsv(report.text);
    expect(parsed.headers.slice(0, 3)).toEqual(['Line', 'Status', 'Problems']);
    expect(parsed.rows).toHaveLength(30);

    const again = await uploadValidated(A.owner, csv);
    expect(again.counts).toMatchObject({ ok: 0, duplicate: 970, error: 30 });
    const c2 = await commit(A.owner, again.id);
    expect(c2.body.data.counts.created).toBe(0);
    expect(await dbCount(StudentModel, { schoolId: A.school.schoolId })).toBe(6 + 970);
  }, 120_000);

  it('createMany / bulkWrite join the surrounding transaction (a failed import chunk leaves nothing behind)', async () => {
    const ctx = makeCtx(A.school.schoolId);
    const before = await dbCount(StudentModel, { schoolId: A.school.schoolId });
    await expect(runWithTenant(ctx, () => withTransaction(async () => {
      const made = await studentRepo.createMany([
        { admissionNo: 'TX-1', firstName: 'T', normalizedName: 't', dob: '2015-01-01', status: 'active', admissionDate: '2025-01-01', emergencyContacts: [] },
        { admissionNo: 'TX-2', firstName: 'T', normalizedName: 't', dob: '2015-01-01', status: 'active', admissionDate: '2025-01-01', emergencyContacts: [] },
      ]);
      await studentRepo.bulkWrite([{ updateOne: { filter: { _id: made[0]!._id }, update: { $set: { firstName: 'U' } } } }]);
      await studentRepo.createMany([{ admissionNo: 'alpha-A1', firstName: 'Dup', normalizedName: 'dup', dob: '2015-01-01', status: 'active', admissionDate: '2025-01-01', emergencyContacts: [] }]);
    }))).rejects.toMatchObject({ code: 11000 });
    expect(await dbCount(StudentModel, { schoolId: A.school.schoolId })).toBe(before);
  });

  it('bad rows in the first line of the file are reported against line 2 (header = line 1)', async () => {
    const v = await uploadValidated(A.owner, csvOf(['X-1,,01/01/2015,F,,,,,,', 'X-2,Ok Kid,01/01/2015,F,,,,,,']));
    expect(v.problems).toEqual([{ line: 2, status: 'error', messages: ['Student name is empty'] }]);
    expect(v.counts.ok).toBe(1);
  });

  it('validates class/section/roll against the active session, capacity and existing roll numbers', async () => {
    const v = await uploadValidated(A.owner, csvOf([
      'R-1,Kid One,01/01/2015,F,Class 5,A,1,,,', //  roll 1 already used in 5-A (fixture)
      'R-2,Kid Two,01/01/2015,F,5,C,,,,', //         no section C
      'R-3,Kid Three,01/01/2015,F,5,,,,,', //        class 5 has two sections → section required
      'R-4,Kid Four,01/01/2015,F,5th,b,40,,,', //    "5th" + lowercase section match
      'R-5,Kid Five,01/01/2015,F,5,B,40,,,', //      roll 40 just taken by line 5
      'R-6,Kid Six,01/01/2015,F,,,7,,,', //          roll without class
    ]));
    const by = Object.fromEntries((v.problems as Array<{ line: number; messages: string[] }>).map((p) => [p.line, p.messages.join(' | ')]));
    expect(by[2]).toMatch(/Roll No 1 is already used/);
    expect(by[3]).toMatch(/Section "C" does not exist/);
    expect(by[4]).toMatch(/Section is required for Class 5 \(A, B\)/);
    expect(by[5]).toBeUndefined();
    expect(by[6]).toMatch(/Roll No 40 is already used/);
    expect(by[7]).toMatch(/without a Class/);
  });

  it('respects the plan student limit', async () => {
    const { seedSchool, loggedIn } = await import('./helpers/app');
    const S = await seedSchool('tiny', { limits: { students: 2, staff: 5 } });
    const owner = await loggedIn(app, S.ownerEmail);
    const v = await uploadValidated(owner, csvOf(['L-1,Kid A,01/01/2015,F,,,,,,', 'L-2,Kid B,01/01/2015,F,,,,,,', 'L-3,Kid C,01/01/2015,F,,,,,,']));
    expect(v.counts).toMatchObject({ ok: 2, error: 1 });
    expect(v.problems[0].messages[0]).toMatch(/Student limit/);
  });

  it('siblings share one guardian; existing guardians (same phone + name) are re-used, not duplicated', async () => {
    const v = await uploadValidated(A.owner, csvOf([
      'S-1,Sib One,01/01/2015,F,,,,Ravi Rao,father,9811111111', // same as fixture guardian
      'S-2,Sib Two,01/01/2016,M,,,,Mina Shah,mother,9822000000',
      'S-3,Sib Three,01/01/2017,M,,,,mina shah,Mother,98220 00000',
    ]));
    expect(v.counts.ok).toBe(3);
    const before = await dbCount(GuardianModel, { schoolId: A.school.schoolId });
    expect((await commit(A.owner, v.id)).status).toBe(200);
    expect(await dbCount(GuardianModel, { schoolId: A.school.schoolId })).toBe(before + 1); // only Mina is new
    expect(await dbCount(StudentGuardianModel, { schoolId: A.school.schoolId, importBatchId: new Types.ObjectId(v.id) })).toBe(3);
    const links = await A.owner.get(`/students/${(await A.owner.get(`/students?q=${encodeURIComponent('Sib Three')}`)).body.data[0].id}/guardians`);
    expect(links.body.data[0]).toMatchObject({ name: 'Mina Shah', relationship: 'mother', isPrimary: true, verified: false, portalAccess: false });
  });

  it('commit needs Idempotency-Key; a retry with the same key replays; a second commit is refused', async () => {
    const v = await uploadValidated(A.owner, csvOf(['I-1,Kid A,01/01/2015,F,,,,,,']));
    expect((await A.owner.post(`/imports/${v.id}/commit`, {})).status).toBe(400);
    const k = key();
    const first = await commit(A.owner, v.id, k);
    const replay = await commit(A.owner, v.id, k);
    expect(first.status).toBe(200);
    expect(replay.status).toBe(200);
    expect(replay.body.data.counts.created).toBe(1);
    expect((await commit(A.owner, v.id)).status).toBe(409);
    expect(await dbCount(StudentModel, { schoolId: A.school.schoolId, admissionNo: 'I-1' })).toBe(1);
  });

  it('cannot commit before validation; mapping changes reset validation; invalid mappings are rejected', async () => {
    const up = await upload(A.owner, csvOf(['M-1,Kid A,2015-01-01,F,,,,,,']));
    const id = up.body.data.id;
    expect((await commit(A.owner, id)).status).toBe(409);
    expect((await A.owner.put(`/imports/${id}/mapping`, { mapping: { admissionNo: 0, fullName: 1, dob: 99 } })).status).toBe(400);
    expect((await A.owner.put(`/imports/${id}/mapping`, { mapping: { admissionNo: 0, fullName: 0, dob: 2 } })).status).toBe(400); // same column twice
    expect((await A.owner.put(`/imports/${id}/mapping`, { mapping: { admissionNo: 0, bogus: 1 } })).status).toBe(400); // unknown field
    expect((await A.owner.put(`/imports/${id}/mapping`, { mapping: { admissionNo: 0 } })).status).toBe(200);
    expect((await A.owner.post(`/imports/${id}/validate`, {})).status).toBe(400); // required columns unmapped
    expect((await A.owner.put(`/imports/${id}/mapping`, { mapping: { admissionNo: 0, fullName: 1, dob: 2 }, dateFormat: 'YMD' })).status).toBe(200);
    const v = await A.owner.post(`/imports/${id}/validate`, {});
    expect(v.body.data.counts.ok).toBe(1);
  });

  it('rejects empty files, header-only files and files over 2,000 rows', async () => {
    expect((await upload(A.owner, '\n\n')).status).toBe(400);
    expect((await upload(A.owner, HEAD)).status).toBe(400);
    const big = csvOf(Array.from({ length: 2001 }, (_, i) => `B-${i},K,01/01/2015,F,,,,,,`));
    const r = await upload(A.owner, big);
    expect(r.status).toBe(400);
    expect(r.body.error.message).toMatch(/more than 2000 rows/);
  });

  it('rollback removes only untouched rows (edited / attendance-marked / status-changed rows are kept) and orphaned guardians', async () => {
    const sec = await A.owner.post('/sections', { classId: A.classId, name: 'Z' });
    expect(sec.status).toBe(201);
    const v = await uploadValidated(A.owner, csvOf([
      'K-1,Kid One,01/01/2015,F,5,Z,1,Gita Devi,mother,9833000001',
      'K-2,Kid Two,01/01/2015,F,5,Z,2,Gita Devi,mother,9833000001',
      'K-3,Kid Three,01/01/2015,F,5,Z,3,Hari Lal,father,9833000003',
      'K-4,Kid Four,01/01/2015,F,5,Z,4,,,',
      'K-5,Kid Five,01/01/2015,F,5,Z,5,,,',
    ]));
    await commit(A.owner, v.id);
    const ids: Record<string, string> = {};
    for (const s of (await A.owner.get(`/students?sectionId=${sec.body.data.id}`)).body.data) ids[s.admissionNo] = s.id;
    await new Promise((r) => setTimeout(r, 15)); // updatedAt must be strictly after committedAt
    expect((await A.owner.patch(`/students/${ids['K-2']}`, { firstName: 'Edited' })).status).toBe(200);
    expect((await A.owner.put(`/attendance/sections/${sec.body.data.id}`, { date: todayIst(), entries: [{ studentId: ids['K-4'], status: 'present' }] })).status).toBe(200);
    expect((await A.owner.post(`/students/${ids['K-5']}/status`, { status: 'withdrawn' })).status).toBe(200);

    const teacherTry = await A.teacher.post(`/imports/${v.id}/rollback`, {});
    expect(teacherTry.status).toBe(403);
    const rb = await A.owner.post(`/imports/${v.id}/rollback`, { reason: 'wrong file' });
    expect(rb.status, JSON.stringify(rb.body)).toBe(200);
    expect(rb.body.data.counts).toMatchObject({ rolledBack: 2, kept: 3 });
    expect(rb.body.data.status).toBe('rolled_back');
    const left = (await A.owner.get(`/students?sectionId=${sec.body.data.id}`)).body.data.map((s: { admissionNo: string }) => s.admissionNo).sort();
    expect(left).toEqual(['K-2', 'K-4']); // K-5 was withdrawn (not in the active section list) but still exists
    expect((await A.owner.get(`/students/${ids['K-5']}`)).status).toBe(200);
    expect((await A.owner.get(`/students/${ids['K-1']}`)).status).toBe(404);
    // Gita still links to the kept K-2 → kept; Hari only linked to removed K-3 → removed.
    expect(await dbCount(GuardianModel, { schoolId: A.school.schoolId, name: 'Gita Devi' })).toBe(1);
    expect(await dbCount(GuardianModel, { schoolId: A.school.schoolId, name: 'Hari Lal' })).toBe(0);
    expect((await A.owner.post(`/imports/${v.id}/rollback`, {})).status).toBe(409);
    const kept = parseCsv((await A.owner.get(`/imports/${v.id}/errors.csv`)).text);
    expect(kept.rows.map((r) => r[0])).toEqual(['3', '5', '6']);
    expect(kept.rows[0]![2]).toMatch(/Kept/);
    const actions = (await _auditRowsForTest({ schoolId: A.school.schoolId })).map((r) => r.action);
    expect(actions).toEqual(expect.arrayContaining(['imports.uploaded', 'imports.committed', 'imports.rolled_back', 'imports.error_report_downloaded']));
  });

  it('only roles with imports permissions can use the import screens', async () => {
    expect((await A.teacher.get('/imports')).status).toBe(403);
    expect((await upload(A.teacher, csvOf(['T-1,Kid,01/01/2015,F,,,,,,']))).status).toBe(403);
    expect((await A.teacher.get('/imports/template.csv')).status).toBe(403);
    const tpl = await A.owner.get('/imports/template.csv');
    expect(tpl.status).toBe(200);
    expect(parseCsv(tpl.text).headers).toContain('Admission No');
  });
});

describe('REQ-RPT CSV exports', () => {
  it('student export is audited, formula-injection safe and re-imports as duplicates without re-mapping', async () => {
    expect((await A.owner.post('/students', { admissionNo: 'EV-1', firstName: '=HYPERLINK("http://evil","x")', dob: '2015-01-01', enrollment: { sectionId: A.sectionA } })).status).toBe(201);
    const res = await A.owner.get('/students/export.csv');
    expect(res.status).toBe(200);
    expect(res.headers['content-disposition']).toMatch(/attachment; filename="students-\d{4}-\d{2}-\d{2}\.csv"/);
    const p = parseCsv(res.text);
    expect(p.rows).toHaveLength(7);
    const evil = p.rows.find((r) => r[0] === 'EV-1')!;
    expect(evil[1]!.startsWith("'=")).toBe(true);
    const asha = p.rows.find((r) => r[0] === 'alpha-A1')!;
    expect(asha.slice(0, 8)).toEqual(['alpha-A1', 'Asha1', 'Rao', '2015-05-05', 'f', 'Class 5', 'A', '1']);
    expect(asha[11]).toBe('Ravi Rao');
    const rows = await _auditRowsForTest({ schoolId: A.school.schoolId });
    expect(rows.find((r) => r.action === 'students.exported')).toBeTruthy();

    const back = await uploadValidated(A.owner, res.text);
    expect(back.mappingProblems).toEqual([]);
    expect(back.counts).toMatchObject({ total: 7, duplicate: 7, ok: 0, error: 0 });
  });

  it('teachers cannot export students or attendance; owners get CSV attendance reports', async () => {
    const month = todayIst().slice(0, 7);
    expect((await A.teacher.get('/students/export.csv')).status).toBe(403);
    expect((await A.teacher.get(`/attendance/reports/monthly.csv?sectionId=${A.sectionA}&month=${month}`)).status).toBe(403);
    expect((await A.owner.put(`/attendance/sections/${A.sectionA}`, { date: todayIst(), entries: [{ studentId: A.studentsA[0], status: 'absent' }] })).status).toBe(200);
    const m = await A.owner.get(`/attendance/reports/monthly.csv?sectionId=${A.sectionA}&month=${month}`);
    expect(m.status).toBe(200);
    const p = parseCsv(m.text);
    expect(p.headers[0]).toBe('Roll No');
    expect(p.rows.find((r) => r[1] === 'Asha1 Rao')).toEqual(['1', 'Asha1 Rao', '1', '0', '1', '0', '0', '0', '0']);
    expect((await A.owner.get('/attendance/reports/low-attendance.csv')).status).toBe(200);
  });
});
