/**
 * Backup / restore / tenant-portability REHEARSAL (doc 12 §7 + §9 item 7). Synthetic data only.
 *   npx tsx scripts/backup-rehearsal.ts            (set MONGOMS_SYSTEM_BINARY to reuse a local mongod)
 *
 * Starts a throw-away replica set, seeds two schools through the real API, then drives the REAL CLI
 * (`scripts/cli.ts`) as separate processes exactly as an operator would:
 *   backup → restore-drill → restore into a new DB → export-school → deactivate → purge-school → restore-school
 * and checks the results with direct queries. Prints a timing table and writes it to .data/rehearsals/.
 */
import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';

const PASS = `rehearsal-${Date.now()}-passphrase`;
const rs = await MongoMemoryReplSet.create({ replSet: { count: 1, storageEngine: 'wiredTiger' } });
const uri = `${rs.getUri('edunex_rehearsal').replace(/\/edunex_rehearsal.*$/, '')}/edunex_rehearsal?replicaSet=${rs.replSetOpts.name}`;
const work = await mkdtemp(join(tmpdir(), 'edx-rehearsal-'));
const steps: Array<{ step: string; ms: number; ok: boolean; note: string }> = [];

/**
 * Runs the CLI as a separate process. MUST be async: the in-memory mongod's log pipe is drained by THIS process's event
 * loop — a blocking spawnSync lets that pipe fill up, mongod stalls, and the child waits forever (seen in rehearsal #1).
 */
function cli(args: string[]): Promise<string> {
  const started = Date.now();
  return new Promise((resolveP, reject) => {
    const child = spawn(process.execPath, ['--import', 'tsx', 'scripts/cli.ts', ...args], {
      env: { ...process.env, DATABASE_URL: uri, BACKUP_PASSPHRASE: PASS, LOG_LEVEL: 'warn', NODE_ENV: 'development' },
    });
    let out = '';
    child.stdout.on('data', (d) => (out += d));
    child.stderr.on('data', (d) => (out += d));
    const timer = setTimeout(() => child.kill(), 180_000);
    child.on('close', (code) => {
      clearTimeout(timer);
      out = out.trim();
      steps.push({ step: `cli ${args[0]}`, ms: Date.now() - started, ok: code === 0, note: out.split(/\r?\n/).slice(-1)[0]?.slice(0, 140) ?? '' });
      if (code !== 0) reject(new Error(`cli ${args.join(' ')} failed (${code}): ${out}`));
      else resolveP(out);
    });
  });
}
const check = (name: string, ok: boolean, note = '') => {
  steps.push({ step: `check: ${name}`, ms: 0, ok, note });
  if (!ok) throw new Error(`Check failed: ${name} ${note}`);
};

try {
  // ---- seed (through the real API, same as the E2E server)
  process.env.DATABASE_URL = uri;
  const { loadEnv } = await import('../src/config/env');
  const { connectDb, ensureIndexes } = await import('../src/core/db/connection');
  const { createApp } = await import('../src/app');
  const { createLogger } = await import('../src/core/logging/logger');
  const { DevEmailAdapter } = await import('../src/core/notifications/email');
  const { buildSchoolData } = await import('../test/helpers/fixtures');
  const env = loadEnv({ NODE_ENV: 'test', DATABASE_URL: uri, RATE_LIMIT_ENABLED: 'false', ALLOWED_ORIGINS: 'http://localhost:3000', LOG_LEVEL: 'silent' } as NodeJS.ProcessEnv);
  await connectDb(uri);
  await ensureIndexes();
  const { app } = createApp({ env, logger: createLogger('silent'), email: new DevEmailAdapter(undefined, null) });
  const t0 = Date.now();
  await buildSchoolData(app, 'alpha', { students: 40 });
  await buildSchoolData(app, 'bravo', { students: 40 });
  steps.push({ step: 'seed 2 schools × 80 students (API)', ms: Date.now() - t0, ok: true, note: '' });
  const db = mongoose.connection.db!;
  const count = (c: string, f: object = {}) => db.collection(c).countDocuments(f);
  const alphaId = (await db.collection('schools').findOne({ code: 'alpha' }))!._id;
  const before = { students: await count('students'), alpha: await count('students', { schoolId: alphaId }) };

  // ---- whole-database backup + drill + restore
  const dir = join(work, 'backups');
  await cli(['backup', '--dir', dir, '--prune']);
  const [backupFile] = (await readdir(dir)).filter((n) => n.endsWith('.edxbak'));
  check('backup file created', Boolean(backupFile), backupFile);
  const drill = await cli(['restore-drill', '--file', join(dir, backupFile!), '--report-dir', join(work, 'drills')]);
  check('restore drill passed', !drill.includes('FAIL'), drill.split('\n').filter((l) => l.startsWith('PASS') || l.startsWith('FAIL')).join(' | '));
  await cli(['restore', '--file', join(dir, backupFile!), '--target-db', 'edunex_restored']);
  check('restored DB has every student', (await mongoose.connection.getClient().db('edunex_restored').collection('students').countDocuments()) === before.students);
  let refused = false;
  try { await cli(['restore', '--file', join(dir, backupFile!), '--target-db', 'edunex_restored']); } catch { refused = true; steps.pop(); }
  check('restore refuses a non-empty target', refused);

  // ---- per-school export → purge → restore
  const exp = join(work, 'alpha-export.edxbak');
  await cli(['export-school', '--code', 'alpha', '--out', exp]);
  let purgeRefused = false;
  try { await cli(['purge-school', '--code', 'alpha', '--confirm', 'alpha', '--export-file', exp]); } catch { purgeRefused = true; steps.pop(); }
  check('purge refused while the school is not deactivated', purgeRefused);
  await cli(['deactivate-school', '--code', 'alpha']);
  await cli(['purge-school', '--code', 'alpha', '--confirm', 'alpha', '--export-file', exp]);
  check('alpha gone, bravo intact', (await count('students', { schoolId: alphaId })) === 0 && (await count('students')) === before.students - before.alpha);
  await cli(['restore-school', '--file', exp]);
  check('alpha restored', (await count('students', { schoolId: alphaId })) === before.alpha && (await count('students')) === before.students);

  const ok = steps.every((s) => s.ok);
  const table = steps.map((s) => `| ${s.step} | ${s.ms || ''} | ${s.ok ? 'pass' : 'FAIL'} | ${s.note.replace(/\|/g, '/')} |`).join('\n');
  const report = `# Backup/restore rehearsal ${new Date().toISOString()}\n\nResult: ${ok ? 'PASS' : 'FAIL'}\n\n| Step | ms | Result | Note |\n|---|---|---|---|\n${table}\n`;
  const outDir = resolve('.data/rehearsals');
  await mkdir(outDir, { recursive: true });
  const outFile = join(outDir, `rehearsal-${Date.now()}.md`);
  await writeFile(outFile, report);
  console.log(report);
  console.log(`Report: ${outFile}`);
} finally {
  await mongoose.disconnect().catch(() => undefined);
  await rs.stop();
  await rm(work, { recursive: true, force: true });
}
