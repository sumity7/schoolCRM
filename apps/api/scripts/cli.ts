/**
 * Vendor CLI (R1 has NO web Super-Admin console — doc 15 §1B). Run on the server / your machine:
 *   npm run cli -- <command> [--flag value]
 *
 * Commands:
 *   create-super-admin --email a@b.c --name "Name"        prints a one-time generated password
 *   create-school --code demo --name "Demo School" --owner-email o@x.y --owner-name "Owner" [--students 2000 --staff 200]
 *   set-limits --code demo --students 1500 --staff 120
 *   suspend-school --code demo   |   reactivate-school --code demo   |   deactivate-school --code demo
 *   list-schools
 *   sync-indexes
 *
 * Backups & data portability (passphrase ALWAYS from env BACKUP_PASSPHRASE, ≥ 16 chars; never on the command line):
 *   backup [--dir ./.data/backups] [--prune]         encrypted whole-DB backup; --prune applies 7d/4w/6m retention
 *   restore --file F --target-db NAME                restores into a NEW, empty database on the same server
 *   restore-drill --file F [--report-dir DIR]        restore into scratch DB, verify, sanity checks, drop; writes a report
 *   export-school --code demo --out F                one school's data (no credentials), encrypted
 *   purge-school --code demo --confirm demo --export-file F   IRREVERSIBLE; school must be deactivated; export required
 *   restore-school --file F                          loads a school export (users reset passwords afterwards)
 * See docs/build/BACKUP-RESTORE.md.
 */
import { randomBytes } from 'node:crypto';
import { mkdir, readdir, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import mongoose from 'mongoose';
import '../src/app'; // registers every model (tenant tools need the full registry)
import { assertPassphrase } from '../src/core/backup/archive';
import { backupDatabase, backupFileName, planRetention, restoreArchive, restoreDrill } from '../src/core/backup/backup';
import { exportSchool, purgeSchool, restoreSchool } from '../src/core/backup/tenant';
import { loadEnv } from '../src/config/env';
import { connectDb, disconnectDb, ensureIndexes } from '../src/core/db/connection';
import { createLogger } from '../src/core/logging/logger';
import { DevEmailAdapter } from '../src/core/notifications/email';
import { AuditService } from '../src/core/audit/audit.service';
import { runWithRequestMeta } from '../src/core/http/request-context';
import { schools } from '../src/modules/auth/auth.repository';
import { createSuperAdmin, provisionSchool } from '../src/modules/schools/schools.service';

function flags(argv: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a.startsWith('--')) out[a.slice(2)] = argv[i + 1] && !argv[i + 1]!.startsWith('--') ? argv[++i]! : 'true';
  }
  return out;
}
const db = () => mongoose.connection.db!;
const need = (f: Record<string, string>, k: string) => {
  if (!f[k]) throw new Error(`Missing --${k}`);
  return f[k]!;
};

async function main() {
  const [cmd, ...rest] = process.argv.slice(2);
  const f = flags(rest);
  const env = loadEnv();
  await connectDb(env.DATABASE_URL);
  await runWithRequestMeta({ requestId: `cli-${Date.now()}` }, async () => {
    switch (cmd) {
      case 'create-super-admin': {
        const password = f.password ?? `${randomBytes(9).toString('base64url')}-9a`;
        const u = await createSuperAdmin({ email: need(f, 'email'), name: need(f, 'name'), password });
        console.log(`Created platform admin ${u.email}. One-time password (store it in a password manager; change it after first use):\n${password}`);
        break;
      }
      case 'create-school': {
        const res = await provisionSchool(
          { name: need(f, 'name'), code: need(f, 'code'), owner: { name: need(f, 'owner-name'), email: need(f, 'owner-email') }, limits: f.students || f.staff ? { students: Number(f.students ?? 2000), staff: Number(f.staff ?? 200) } : undefined },
          { email: new DevEmailAdapter(createLogger('info')), appBaseUrl: env.APP_BASE_URL },
        );
        console.log(`School "${res.school.name}" (${res.school.code}) created.\nOwner invitation link (single use, 7 days — also written to .data/mail in dev):\n${res.inviteLink}`);
        break;
      }
      case 'set-limits': {
        const r = await schools.updateOne({ code: need(f, 'code').toLowerCase() }, { $set: { 'limits.students': Number(need(f, 'students')), 'limits.staff': Number(need(f, 'staff')) } }, 'cli: set limits');
        if (r.matchedCount === 0) throw new Error('School not found');
        await AuditService.record({ action: 'platform.limits_set', entityType: 'school', meta: { code: f.code, students: f.students, staff: f.staff }, schoolId: null });
        console.log('Limits updated.');
        break;
      }
      case 'suspend-school':
      case 'deactivate-school':
      case 'reactivate-school': {
        const status = cmd === 'suspend-school' ? 'suspended' : cmd === 'deactivate-school' ? 'deactivated' : 'live';
        const r = await schools.updateOne({ code: need(f, 'code').toLowerCase() }, { $set: { status } }, `cli: ${cmd}`);
        if (r.matchedCount === 0) throw new Error('School not found');
        await AuditService.record({ action: `platform.${cmd.replace('-', '_')}`, entityType: 'school', meta: { code: f.code }, schoolId: null });
        console.log(`School ${f.code} is now ${status}. (This command never deletes data.)`);
        break;
      }
      case 'list-schools': {
        const rows = await schools.find({}, 'cli: list', { sort: { createdAt: -1 } });
        for (const s of rows) console.log(`${s.code}\t${s.status}\t${s.name}\tlimits=${JSON.stringify(s.limits)}`);
        break;
      }
      case 'backup': {
        const pass = assertPassphrase(process.env.BACKUP_PASSPHRASE);
        const dir = resolve(f.dir ?? './.data/backups');
        await mkdir(dir, { recursive: true });
        const file = join(dir, backupFileName());
        const st = await backupDatabase(db(), file, pass, { app: 'edunex-api' });
        console.log(`Backup written: ${file}\n${st.collections} collections, ${st.documents} documents, ${st.ms} ms`);
        if (f.prune === 'true') {
          const plan = planRetention(await readdir(dir), new Date());
          for (const n of plan.remove) await rm(join(dir, n));
          console.log(`Retention: kept ${plan.keep.length}, removed ${plan.remove.length}`);
        }
        console.log('Copy this file to OFF-SITE storage on a different provider, and run restore-drill regularly.');
        break;
      }
      case 'restore': {
        const pass = assertPassphrase(process.env.BACKUP_PASSPHRASE);
        const target = need(f, 'target-db');
        if (target === db().databaseName) throw new Error('Refusing to restore over the database this CLI is connected to. Choose a new --target-db name.');
        const r = await restoreArchive(mongoose.connection.getClient().db(target), resolve(need(f, 'file')), pass, { requireEmpty: true, expectKind: 'database' });
        console.log(`Restored ${r.documents} documents in ${r.collections} collections into "${target}" in ${r.ms} ms. Digests verified: ${r.verified}.\nPoint DATABASE_URL at it only after checking the data.`);
        break;
      }
      case 'restore-drill': {
        const pass = assertPassphrase(process.env.BACKUP_PASSPHRASE);
        const report = await restoreDrill(mongoose.connection.getClient(), resolve(need(f, 'file')), pass);
        const dir = resolve(f['report-dir'] ?? './.data/restore-drills');
        await mkdir(dir, { recursive: true });
        const out = join(dir, `drill-${report.drillAt.replace(/[:.]/g, '-')}.json`);
        await writeFile(out, JSON.stringify(report, null, 2));
        for (const c of report.checks) console.log(`${c.ok ? 'PASS' : 'FAIL'}  ${c.name}: ${c.detail}`);
        console.log(`Backup age (RPO achieved): ${report.backupAgeHours} h · restore time: ${report.restoreMs} ms · report: ${out}`);
        if (!report.ok) process.exitCode = 2;
        break;
      }
      case 'export-school': {
        const pass = assertPassphrase(process.env.BACKUP_PASSPHRASE);
        const st = await exportSchool(db(), need(f, 'code'), resolve(need(f, 'out')), pass);
        console.log(`Exported school ${f.code}: ${st.documents} documents (${JSON.stringify(st.counts)})`);
        break;
      }
      case 'purge-school': {
        const pass = assertPassphrase(process.env.BACKUP_PASSPHRASE);
        const r = await purgeSchool(db(), { code: need(f, 'code'), confirmCode: need(f, 'confirm'), exportFile: resolve(need(f, 'export-file')), passphrase: pass });
        console.log(`School ${f.code} purged. Deleted: ${JSON.stringify(r.deleted)}`);
        break;
      }
      case 'restore-school': {
        const pass = assertPassphrase(process.env.BACKUP_PASSPHRASE);
        const r = await restoreSchool(db(), resolve(need(f, 'file')), pass);
        console.log(`Restored school ${r.schoolId}: ${r.documents} documents; users created ${r.usersCreated}, already present ${r.usersExisting}. Restored users must use "Forgot password".`);
        break;
      }
      case 'sync-indexes':
        await ensureIndexes();
        console.log('Indexes synchronised.');
        break;
      default:
        console.log('Unknown command. See header of scripts/cli.ts');
        process.exitCode = 1;
    }
  });
  await disconnectDb();
}

main().catch(async (e) => {
  console.error(e instanceof Error ? e.message : e);
  await disconnectDb().catch(() => undefined);
  process.exit(1);
});
