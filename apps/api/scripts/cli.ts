/**
 * Vendor CLI (R1 has NO web Super-Admin console — doc 15 §1B). Run on the server / your machine:
 *   npm run cli -- <command> [--flag value]
 *
 * Commands:
 *   create-super-admin --email a@b.c --name "Name"        prints a one-time generated password
 *   create-school --code demo --name "Demo School" --owner-email o@x.y --owner-name "Owner" [--students 2000 --staff 200]
 *   set-limits --code demo --students 1500 --staff 120
 *   suspend-school --code demo   |   reactivate-school --code demo
 *   list-schools
 *   sync-indexes
 */
import { randomBytes } from 'node:crypto';
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
      case 'reactivate-school': {
        const status = cmd === 'suspend-school' ? 'suspended' : 'live';
        const r = await schools.updateOne({ code: need(f, 'code').toLowerCase() }, { $set: { status } }, `cli: ${cmd}`);
        if (r.matchedCount === 0) throw new Error('School not found');
        await AuditService.record({ action: `platform.${cmd.replace('-', '_')}`, entityType: 'school', meta: { code: f.code }, schoolId: null });
        console.log(`School ${f.code} is now ${status}. (Data is never deleted by suspension.)`);
        break;
      }
      case 'list-schools': {
        const rows = await schools.find({}, 'cli: list', { sort: { createdAt: -1 } });
        for (const s of rows) console.log(`${s.code}\t${s.status}\t${s.name}\tlimits=${JSON.stringify(s.limits)}`);
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
