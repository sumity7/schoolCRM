/**
 * Idempotent DEVELOPMENT seeding of the demo accounts (synthetic data only). Adds ONLY what is missing; it never
 * deletes or modifies existing users/schools, so it is safe to run against a long-lived development database.
 * Shared by `npm run seed:demo` and the E2E server. Never imported by application code.
 */
import type { Express } from 'express';
import { users, schools } from '../../src/modules/auth/auth.repository';
import { DEMO_PASSWORD, DEMO_SCHOOL_CODE } from '../../src/modules/auth/demo-accounts';
import { syncSystemRoles } from '../../src/modules/roles/role-seed';
import { createSuperAdmin } from '../../src/modules/schools/schools.service';
import { buildSchoolData, seedParent, seedStudentLogin, type SchoolData } from '../../test/helpers/fixtures';
import { loggedIn, seedMember } from '../../test/helpers/app';

export interface DemoSeedResult { created: string[]; existing: string[] }

export async function ensureDemoAccounts(app: Express): Promise<DemoSeedResult> {
  const created: string[] = [];
  const existing: string[] = [];
  const track = (label: string, was: boolean) => (was ? existing : created).push(label);
  await syncSystemRoles(); // schools created before newer permissions existed get them (additive)

  let school = await schools.findOne({ code: DEMO_SCHOOL_CODE }, 'demo seed: school exists?');
  track('school demo (owner owner@demo.test, teacher tina@demo.test, 25 students)', Boolean(school));
  if (!school) {
    await buildSchoolData(app, DEMO_SCHOOL_CODE, { students: 25 });
    school = await schools.findOne({ code: DEMO_SCHOOL_CODE }, 'demo seed: school created');
  }
  const owner = await loggedIn(app, 'owner@demo.test', DEMO_PASSWORD);
  const sd = { owner, school: { schoolId: school!._id } } as unknown as SchoolData;
  const found = await owner.get('/students?q=demo-A1&limit=1');
  const studentId = found.body.data?.[0]?.id as string | undefined;
  if (!studentId) throw new Error('Demo student demo-A1 not found — cannot seed parent/student demo accounts');

  const has = async (email: string) => Boolean(await users.findOne({ email }, 'demo seed: user exists?'));
  const ensure = async (label: string, email: string, make: () => Promise<unknown>) => {
    const was = await has(email);
    track(label, was);
    if (!was) await make();
  };
  await ensure('super admin root@demo.test (no two-factor yet: set it up on first use)', 'root@demo.test', () => createSuperAdmin({ email: 'root@demo.test', name: 'Demo Super Admin', password: DEMO_PASSWORD }));
  await ensure('accountant accountant@demo.test', 'accountant@demo.test', () => seedMember(school!._id, 'accountant@demo.test', ['accountant'], { name: 'Demo Accountant', password: DEMO_PASSWORD }));
  await ensure('parent parent@demo.test (child demo-A1)', 'parent@demo.test', () => seedParent(app, sd, studentId, 'parent@demo.test'));
  await ensure('student demo-a1@demo.student', 'demo-a1@demo.student', () => seedStudentLogin(app, sd, studentId, DEMO_PASSWORD));
  return { created, existing };
}
