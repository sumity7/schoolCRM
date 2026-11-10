/**
 * Performance test on a realistic synthetic dataset (doc 11: p95 < 500 ms for common reads, < 1.5 s for saving a
 * 60-student attendance sheet, no COLLSCAN on application collections).
 *   npx tsx scripts/perf.ts        (MONGOMS_SYSTEM_BINARY to reuse a local mongod)
 *
 * Dataset: school "perf" — 12 classes × 3 sections, 2,000 students loaded through the real CSV import API, ~6 months of
 * daily attendance (≈ 260k records, bulk-inserted), plus a 60-student section for the save test; a second school
 * "noise" with 500 students so tenant filtering is exercised. Every measured request goes over real HTTP.
 * The MongoDB profiler records every query during the measurements and the script fails on any COLLSCAN.
 */
import type { AddressInfo } from 'node:net';
import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import mongoose, { Types } from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { addDays, isoWeekday, todayInTz } from '@edunex/shared';

const SAMPLES = Number(process.env.PERF_SAMPLES ?? 30);
const rs = await MongoMemoryReplSet.create({ replSet: { count: 1, storageEngine: 'wiredTiger' } });
const uri = rs.getUri('edunex_perf');
process.env.DATABASE_URL = uri;

const { loadEnv } = await import('../src/config/env');
const { connectDb, ensureIndexes } = await import('../src/core/db/connection');
const { createApp } = await import('../src/app');
const { createLogger } = await import('../src/core/logging/logger');
const { DevEmailAdapter } = await import('../src/core/notifications/email');
const { seedSchool } = await import('../test/helpers/app');

const ORIGIN = 'http://localhost:3000';
const env = loadEnv({ NODE_ENV: 'test', DATABASE_URL: uri, RATE_LIMIT_ENABLED: 'false', ALLOWED_ORIGINS: ORIGIN, LOG_LEVEL: 'silent' } as NodeJS.ProcessEnv);
await connectDb(uri);
await ensureIndexes();
const { app } = createApp({ env, logger: createLogger('silent'), email: new DevEmailAdapter(undefined, null) });
const server = app.listen(0);
const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/v1`;
const db = mongoose.connection.db!;

class Http {
  cookie = '';
  async req(method: string, path: string, body?: unknown, headers: Record<string, string> = {}) {
    const res = await fetch(`${base}${path}`, {
      method,
      headers: { Origin: ORIGIN, 'X-Requested-With': 'edunex', ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...(this.cookie ? { Cookie: this.cookie } : {}), ...headers },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const set = res.headers.getSetCookie?.() ?? [];
    for (const c of set) if (c.startsWith('edunex_sid=')) this.cookie = c.split(';')[0]!;
    const text = await res.text();
    if (res.status >= 400) throw new Error(`${method} ${path} → ${res.status} ${text.slice(0, 300)}`);
    return text.startsWith('{') ? (JSON.parse(text) as { data: never; meta?: { total: number } }) : ({ data: text } as never);
  }
}
const ok = <T,>(x: T) => x;

async function buildSchool(code: string, students: number, withAttendanceDays: number) {
  const s = await seedSchool(code, { limits: { students: 5000, staff: 200 } });
  const c = new Http();
  await c.req('POST', '/auth/login', { identifier: s.ownerEmail, password: 'Correct-Horse-9' });
  await c.req('PATCH', '/schools/me/settings', { workingDays: [1, 2, 3, 4, 5, 6] });
  const today = todayInTz('Asia/Kolkata');
  const sess = await c.req('POST', '/academics/sessions', { name: '2026-27', startDate: addDays(today, -200), endDate: addDays(today, 165) });
  await c.req('POST', `/academics/sessions/${(sess.data as { id: string }).id}/activate`, {});
  const sessionId = (sess.data as { id: string }).id;
  const sectionIds: string[] = [];
  for (let k = 1; k <= 12; k++) {
    const cls = await c.req('POST', '/classes', { sessionId, name: `Class ${k}`, order: k });
    for (const n of ['A', 'B', 'C']) sectionIds.push(((await c.req('POST', '/sections', { classId: (cls.data as { id: string }).id, name: n })).data as { id: string }).id);
  }
  // students through the REAL import pipeline (also times the import)
  const rows = ['Admission No,Student Name,DOB,Gender,Class,Section,Roll No,Father Name,Parent Mobile'];
  for (let i = 0; i < students; i++) {
    const k = (i % 12) + 1;
    const sec = ['A', 'B', 'C'][Math.floor(i / 12) % 3];
    rows.push(`${code.toUpperCase()}-${i + 1},Student${i + 1} Kumar${i % 97},${String((i % 28) + 1).padStart(2, '0')}/0${(i % 9) + 1}/${2008 + k},${i % 2 ? 'M' : 'F'},Class ${k},${sec},${Math.floor(i / 36) + 1},Parent${i % 1500} Kumar,9${String(800000000 + (i % 1500)).padStart(9, '0')}`);
  }
  const t0 = Date.now();
  const up = await c.req('POST', '/imports', { entity: 'students', filename: 'perf.csv', csv: rows.join('\n') });
  const id = (up.data as { id: string }).id;
  const val = await c.req('POST', `/imports/${id}/validate`, {});
  const t1 = Date.now();
  const com = await c.req('POST', `/imports/${id}/commit`, {}, { 'Idempotency-Key': `perf-${code}-${Date.now()}` });
  const t2 = Date.now();
  const counts = (com.data as { counts: { created: number; error: number } }).counts;
  if (counts.created !== students) throw new Error(`import created ${counts.created}/${students}: ${JSON.stringify((val.data as { problems: unknown[] }).problems.slice(0, 3))}`);

  // attendance history: bulk insert (realistic shape, bypasses 4,000+ HTTP saves)
  const schoolId = s.schoolId;
  const enr = await db.collection('enrollments').find({ schoolId }, { projection: { studentId: 1, sectionId: 1 } }).toArray();
  const statuses = ['present', 'present', 'present', 'present', 'present', 'present', 'present', 'present', 'absent', 'late'] as const;
  let inserted = 0;
  let batch: Record<string, unknown>[] = [];
  for (let d = withAttendanceDays; d >= 1; d--) {
    const date = addDays(today, -d);
    if (isoWeekday(date) === 7) continue;
    for (const e of enr) {
      batch.push({ schoolId, sessionId: new Types.ObjectId(sessionId), studentId: e.studentId, sectionId: e.sectionId, date, status: statuses[(inserted * 7 + d) % 10], markedBy: s.ownerMembershipId, markedAt: new Date(), source: 'teacher', createdAt: new Date(), updatedAt: new Date(), __v: 0 });
      inserted++;
      if (batch.length === 5000) { await db.collection('attendancerecords').insertMany(batch, { ordered: false }); batch = []; }
    }
  }
  if (batch.length) await db.collection('attendancerecords').insertMany(batch, { ordered: false });
  return { c, sessionId, sectionIds, importValidateMs: t1 - t0, importCommitMs: t2 - t1, attendanceRecords: inserted };
}

function pct(xs: number[], p: number) {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.ceil((p / 100) * s.length) - 1)]!;
}
const results: Array<{ name: string; n: number; p50: number; p95: number; max: number; target: number; pass: boolean }> = [];
async function measure(name: string, target: number, fn: (i: number) => Promise<unknown>, n = SAMPLES, concurrency = 1) {
  await fn(-1); // warm-up
  const times: number[] = [];
  for (let i = 0; i < n; i += concurrency) {
    await Promise.all(Array.from({ length: Math.min(concurrency, n - i) }, async (_x, j) => {
      const t = performance.now();
      await fn(i + j);
      times.push(performance.now() - t);
    }));
  }
  const r = { name, n, p50: Math.round(pct(times, 50)), p95: Math.round(pct(times, 95)), max: Math.round(Math.max(...times)), target, pass: pct(times, 95) < target };
  results.push(r);
  console.log(`${r.pass ? 'PASS' : 'FAIL'}  ${name}: p50 ${r.p50} ms · p95 ${r.p95} ms · max ${r.max} ms (target p95 < ${target})`);
}

try {
  console.log('Seeding (this takes a while)…');
  const ts = Date.now();
  const P = await buildSchool('perf', 2000, 180);
  await buildSchool('noise', 500, 60);
  const studentCount = await db.collection('students').countDocuments();
  const attCount = await db.collection('attendancerecords').countDocuments();
  console.log(`Seeded in ${Math.round((Date.now() - ts) / 1000)} s: ${studentCount} students, ${attCount} attendance records. Import of 2,000 rows: validate ${P.importValidateMs} ms, commit ${P.importCommitMs} ms.`);

  // a 60-student section for the save test
  const big = (await P.c.req('POST', '/sections', { classId: ((await P.c.req('GET', '/classes')).data as Array<{ id: string }>)[0]!.id, name: 'BIG' })).data as { id: string };
  const bigRows = ['Admission No,Student Name,DOB,Class,Section,Roll No'];
  for (let i = 1; i <= 60; i++) bigRows.push(`BIG-${i},Big${i} Student,01/01/2012,Class 1,BIG,${i}`);
  const bu = await P.c.req('POST', '/imports', { entity: 'students', filename: 'big.csv', csv: bigRows.join('\n') });
  await P.c.req('POST', `/imports/${(bu.data as { id: string }).id}/validate`, {});
  await P.c.req('POST', `/imports/${(bu.data as { id: string }).id}/commit`, {}, { 'Idempotency-Key': `perf-big-${Date.now()}` });
  const roster = ((await P.c.req('GET', `/academics/sections/${big.id}/roster`)).data as { students: Array<{ studentId: string }> }).students;
  const sample = ((await P.c.req('GET', '/students?limit=50')).data as Array<{ id: string }>).map((s) => s.id);
  const today = todayInTz('Asia/Kolkata');
  const month = today.slice(0, 7);
  const prevMonth = addDays(`${month}-01`, -1).slice(0, 7);

  await db.command({ profile: 2 }); // record every operation from here on
  await measure('students list (page 1)', 500, () => P.c.req('GET', '/students?limit=25'));
  await measure('students search by name prefix', 500, (i) => P.c.req('GET', `/students?q=student${(i + 2) * 7}&limit=25`));
  await measure('students filter by section', 500, (i) => P.c.req('GET', `/students?sectionId=${P.sectionIds[Math.abs(i) % 36]}&limit=25`));
  await measure('student profile', 500, (i) => P.c.req('GET', `/students/${sample[Math.abs(i) % sample.length]}`));
  await measure('student attendance history (60 days)', 500, (i) => P.c.req('GET', `/attendance/students/${sample[Math.abs(i) % sample.length]}?from=${addDays(today, -60)}&to=${today}`));
  await measure('attendance sheet (section, today)', 500, (i) => P.c.req('GET', `/attendance/sections/${P.sectionIds[Math.abs(i) % 36]}?date=${today}`));
  await measure('monthly report (section, previous month)', 500, (i) => P.c.req('GET', `/attendance/reports/monthly?sectionId=${P.sectionIds[Math.abs(i) % 36]}&month=${prevMonth}`));
  await measure('low-attendance report (whole school, session)', 1500, () => P.c.req('GET', '/attendance/reports/low-attendance'), 10);
  await measure('save attendance, 60 students', 1500, (i) => P.c.req('PUT', `/attendance/sections/${big.id}`, { date: today, entries: roster.map((s, k) => ({ studentId: s.studentId, status: (k + i) % 9 ? 'present' : 'absent' })) }));
  await measure('students list, 10 concurrent users', 500, () => P.c.req('GET', '/students?limit=25'), 50, 10);
  await measure('export all students (CSV, 2,060 rows)', 3000, () => P.c.req('GET', '/students/export.csv'), 5);
  await db.command({ profile: 0 });

  // COLLSCAN audit of everything the application ran during the measurements
  const scans = await db.collection('system.profile').aggregate([
    { $match: { planSummary: /COLLSCAN/, ns: { $not: /system\.|\.\$cmd$/ } } },
    { $group: { _id: { ns: '$ns', op: '$op' }, n: { $sum: 1 }, example: { $first: '$command' } } },
  ]).toArray();
  const appScans = scans.filter((s) => !/\.(schools|sessions|users)$/.test(String((s._id as { ns: string }).ns)));
  console.log(appScans.length ? `COLLSCAN found on: ${appScans.map((s) => `${(s._id as { ns: string }).ns} ×${s.n}`).join(', ')}` : 'No COLLSCAN on application collections.');
  for (const s of scans) console.log(`  scan ${(s._id as { ns: string }).ns} (${(s._id as { op: string }).op}) ×${s.n}: ${JSON.stringify(s.example).slice(0, 220)}`);

  const lines = [
    `# Performance run ${new Date().toISOString()}`, '',
    `Dataset: ${studentCount} students in 2 schools, ${attCount} attendance records; 2,000-row import: validate ${P.importValidateMs} ms, commit ${P.importCommitMs} ms.`,
    `Environment: local machine, single-node replica set (mongod via mongodb-memory-server), API + DB on the same host, HTTP over loopback.`, '',
    '| Request | n | p50 ms | p95 ms | max ms | target p95 | result |', '|---|---|---|---|---|---|---|',
    ...results.map((r) => `| ${r.name} | ${r.n} | ${r.p50} | ${r.p95} | ${r.max} | < ${r.target} | ${r.pass ? 'pass' : 'FAIL'} |`), '',
    appScans.length ? `COLLSCAN on application collections: ${appScans.map((s) => (s._id as { ns: string }).ns).join(', ')}` : 'No COLLSCAN on application collections during the run.', '',
    `Platform-collection scans (small, platform-wide): ${scans.length - appScans.length}`,
  ];
  const outDir = resolve('.data/perf');
  await mkdir(outDir, { recursive: true });
  const out = join(outDir, `perf-${Date.now()}.md`);
  await writeFile(out, lines.join('\n'));
  console.log(`\nReport: ${out}`);
  if (results.some((r) => !r.pass) || appScans.length) process.exitCode = 2;
} finally {
  server.close();
  await mongoose.disconnect().catch(() => undefined);
  await rs.stop();
}
void ok;
