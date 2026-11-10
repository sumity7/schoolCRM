import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import mongoose, { Types } from 'mongoose';
import { setupTestDb, teardownTestDb, clearAll } from './helpers/db';
import { Client, loggedIn, makeTestApp, seedMember } from './helpers/app';
import { buildSchoolData, type SchoolData } from './helpers/fixtures';
import { BackupError, verifyArchive } from '../src/core/backup/archive';
import { backupDatabase, backupFileName, digestCollection, parseBackupDate, planRetention, restoreArchive, restoreDrill } from '../src/core/backup/backup';
import { exportSchool, purgeSchool, restoreSchool } from '../src/core/backup/tenant';
import { modelRegistry } from '../src/core/tenancy/registry';

const t = makeTestApp(); // registers every model
const { app } = t;
const PASS = 'correct horse battery staple 42';
let A: SchoolData;
let B: SchoolData;
let dir: string;
const db = () => mongoose.connection.db!;
const client = () => mongoose.connection.getClient();
const tokenFromEmail = (to: string) => /token=([A-Za-z0-9_-]+)/.exec(t.email.lastTo(to)?.text ?? '')?.[1];

beforeAll(async () => {
  await setupTestDb();
  dir = await mkdtemp(join(tmpdir(), 'edx-backup-'));
});
afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
  await teardownTestDb();
});
beforeEach(async () => {
  await clearAll();
  t.email.outbox.length = 0;
  A = await buildSchoolData(app, 'alpha');
  B = await buildSchoolData(app, 'bravo');
});

let n = 0;
const file = () => join(dir, `f${n++}.edxbak`);

/** Every document of a school, across all tenant collections + its school row (stable order) — for byte-level comparison. */
async function schoolSnapshot(schoolId: Types.ObjectId) {
  const out: Record<string, string> = {};
  for (const [, info] of modelRegistry) {
    if (info.kind !== 'tenant') continue;
    out[info.collection] = (await digestCollection(db(), { name: info.collection, filter: { schoolId } })).sha256;
  }
  out.schools = (await digestCollection(db(), { name: 'schools', filter: { _id: schoolId } })).sha256;
  return out;
}

describe('REQ-OPS encrypted backup archive', () => {
  it('round-trips a whole database exactly (digests recomputed from the restored DB) and refuses non-empty targets', async () => {
    const f = file();
    const stats = await backupDatabase(db(), f, PASS);
    expect(stats.documents).toBeGreaterThan(20);
    const raw = await readFile(f);
    expect(raw.subarray(0, 8).toString()).toBe('EDXBAK01');
    expect(raw.includes(Buffer.from('alpha-A1'))).toBe(false); // encrypted: no plaintext PII in the file

    const target = client().db(`rt_${Date.now()}`);
    try {
      const r = await restoreArchive(target, f, PASS);
      expect(r.verified).toBe(true);
      expect(r.documents).toBe(stats.documents);
      expect(await target.collection('students').countDocuments({ schoolId: A.school.schoolId })).toBe(6);
      const idx = await target.collection('students').indexes();
      expect(idx.some((i) => i.unique && JSON.stringify(i.key) === JSON.stringify({ schoolId: 1, admissionNo: 1 }))).toBe(true);
      await expect(restoreArchive(target, f, PASS)).rejects.toThrow(/not empty/);
    } finally {
      await target.dropDatabase();
    }
  });

  it('wrong passphrase, tampering and truncation are detected BEFORE anything is written', async () => {
    const f = file();
    await backupDatabase(db(), f, PASS);
    await expect(verifyArchive(f, 'a different passphrase!!')).rejects.toThrow(BackupError);

    const raw = await readFile(f);
    const tampered = Buffer.from(raw);
    tampered[Math.floor(raw.length / 2)]! ^= 0x01;
    const tf = file();
    await writeFile(tf, tampered);
    const target = client().db(`tamper_${Date.now()}`);
    try {
      await expect(restoreArchive(target, tf, PASS)).rejects.toThrow(BackupError);
      expect((await target.listCollections().toArray()).length).toBe(0); // nothing written
      const cut = file();
      await writeFile(cut, raw.subarray(0, raw.length - 200));
      await expect(restoreArchive(target, cut, PASS)).rejects.toThrow(BackupError);
      expect((await target.listCollections().toArray()).length).toBe(0);
    } finally {
      await target.dropDatabase();
    }
  });

  it('refuses short passphrases and never overwrites an existing backup file', async () => {
    await expect(backupDatabase(db(), file(), 'short')).rejects.toThrow(/at least 16/);
    const f = file();
    await writeFile(f, 'existing');
    await expect(backupDatabase(db(), f, PASS)).rejects.toThrow();
    expect(await readFile(f, 'utf8')).toBe('existing');
  });

  it('restore drill restores into a scratch database, checks it, reports timings and drops it', async () => {
    const f = file();
    await backupDatabase(db(), f, PASS);
    const report = await restoreDrill(client(), f, PASS);
    expect(report.ok).toBe(true);
    expect(report.checks.map((c) => c.name)).toEqual(expect.arrayContaining(['digests', 'schools readable', 'every student belongs to a school']));
    expect(report.restoreMs).toBeGreaterThan(0);
    expect(report.backupAgeHours).toBeLessThan(1);
    const dbs = (await client().db().admin().listDatabases()).databases.map((d) => d.name);
    expect(dbs).not.toContain(report.scratchDb);
  });

  it('retention keeps 7 daily / 4 weekly / 6 monthly and ignores unknown files', () => {
    const now = new Date(Date.UTC(2026, 10, 9, 23, 0, 0));
    const names: string[] = ['notes.txt'];
    for (let d = 0; d < 400; d++) names.push(backupFileName(new Date(now.getTime() - d * 86_400_000)));
    names.push(backupFileName(new Date(now.getTime() - 3_600_000))); // two backups today
    expect(parseBackupDate(names[1]!)?.toISOString()).toBe(now.toISOString());
    const { keep, remove } = planRetention(names, now);
    expect(keep).toContain(names[1]); // newest
    expect(keep.length).toBeLessThanOrEqual(7 + 4 + 6);
    expect(keep.length).toBeGreaterThanOrEqual(13);
    expect(remove).not.toContain('notes.txt');
    expect(keep).not.toContain('notes.txt');
    expect(keep.length + remove.length).toBe(names.length - 1);
    const oldestKept = keep.map((k) => parseBackupDate(k)!.getTime()).sort((a, b) => a - b)[0]!;
    expect((now.getTime() - oldestKept) / 86_400_000).toBeGreaterThan(120); // 6 monthly buckets incl. the current month
  });
});

describe('REQ-OPS per-school export, purge and restore', () => {
  it('export → purge removes exactly one school (other school byte-identical) → restore brings it back intact; users reset passwords', async () => {
    await seedMember(A.school.schoolId, 'multi@x.test', ['admin']);
    await seedMember(B.school.schoolId, 'multi@x.test', ['admin']);
    const aBefore = await schoolSnapshot(A.school.schoolId);
    const bBefore = await schoolSnapshot(B.school.schoolId);
    const ownerA = await loggedIn(app, A.school.ownerEmail);

    const exp = file();
    const ex = await exportSchool(db(), 'alpha', exp, PASS);
    expect(ex.counts.students).toBe(6);
    const raw = await readFile(exp);
    expect(raw.includes(Buffer.from('$argon2'))).toBe(false);
    let sawHash = false;
    const { readArchive } = await import('../src/core/backup/archive');
    await readArchive(exp, PASS, (l) => { if (l.type === 'doc' && l.c === 'users' && JSON.stringify(l.d).includes('passwordHash')) sawHash = true; });
    expect(sawHash).toBe(false); // credentials never leave the system
    const bExport = file();
    await exportSchool(db(), 'bravo', bExport, PASS);

    // guards: nothing is deleted unless every condition holds
    await expect(purgeSchool(db(), { code: 'alpha', confirmCode: 'alpha', exportFile: exp, passphrase: PASS })).rejects.toThrow(/deactivated/);
    await db().collection('schools').updateOne({ _id: A.school.schoolId }, { $set: { status: 'deactivated' } });
    await expect(purgeSchool(db(), { code: 'alpha', confirmCode: 'alpah', exportFile: exp, passphrase: PASS })).rejects.toThrow(/Confirmation/);
    await expect(purgeSchool(db(), { code: 'alpha', confirmCode: 'alpha', exportFile: bExport, passphrase: PASS })).rejects.toThrow(/not an export of this school/);
    expect(await db().collection('students').countDocuments({ schoolId: A.school.schoolId })).toBe(6);

    const purged = await purgeSchool(db(), { code: 'alpha', confirmCode: 'alpha', exportFile: exp, passphrase: PASS });
    expect(purged.deleted.students).toBe(6);
    for (const [, info] of modelRegistry) {
      if (info.kind === 'tenant') expect(await db().collection(info.collection).countDocuments({ schoolId: A.school.schoolId }), info.collection).toBe(0);
    }
    expect(await db().collection('auditlogs').countDocuments({ schoolId: A.school.schoolId })).toBe(0);
    expect(await db().collection('schools').countDocuments({ _id: A.school.schoolId })).toBe(0);
    expect(await db().collection('users').countDocuments({ email: A.school.ownerEmail })).toBe(0); // alpha-only person removed
    expect(await db().collection('users').countDocuments({ email: 'multi@x.test' })).toBe(1); // still a member of bravo
    expect((await ownerA.get('/schools/me')).status).toBe(401); // their session died with the school
    expect(await schoolSnapshot(B.school.schoolId)).toEqual(bBefore);
    expect(await db().collection('auditlogs').countDocuments({ action: 'platform.school_purged' })).toBe(1);

    const r = await restoreSchool(db(), exp, PASS);
    expect(r.verified).toBe(true);
    expect(r.usersExisting).toBe(1); // multi@x.test kept as is
    const aAfter = await schoolSnapshot(A.school.schoolId);
    expect(aAfter).toEqual(aBefore); // every tenant document AND the school row identical to before the export
    expect(await schoolSnapshot(B.school.schoolId)).toEqual(bBefore);
    await expect(restoreSchool(db(), exp, PASS)).rejects.toThrow(/already exists/);

    // restored people have no password: they regain access through "Forgot password"
    expect((await new Client(app).login(A.school.ownerEmail)).status).toBe(401);
    expect((await new Client(app).post('/auth/forgot-password', { identifier: A.school.ownerEmail })).status).toBe(202);
    const token = tokenFromEmail(A.school.ownerEmail)!;
    expect(token).toBeTruthy();
    expect((await new Client(app).post('/auth/reset-password', { token, password: 'Restored-Pass-77' })).status).toBe(204);
    const back = await loggedIn(app, A.school.ownerEmail, 'Restored-Pass-77');
    expect((await back.get('/students')).body.meta.total).toBe(6);
  });
});
