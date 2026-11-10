/**
 * DEVELOPMENT-ONLY demo accounts (synthetic school "demo"). These are created by `npm run seed:demo` (never in
 * production: the script refuses) and listed on the login page only when the SERVER flag DEMO_LOGIN_ENABLED is on —
 * which env validation refuses in production/staging. The login page never grants anything: it only fills the form;
 * the person still signs in with the normal password check, session, CSRF and rate limits.
 */
export const DEMO_PASSWORD = 'Correct-Horse-9';
export const DEMO_SCHOOL_CODE = 'demo';

export type DemoRoleKey = 'super_admin' | 'school_admin' | 'teacher' | 'accountant' | 'parent' | 'student';
export interface DemoAccountDef {
  key: DemoRoleKey;
  label: string;
  description: string;
  identifier: string;
  /** Account must be a platform user (super_admin) or a school member. */
  platform?: boolean;
}

export const DEMO_ACCOUNTS: DemoAccountDef[] = [
  { key: 'super_admin', label: 'Super Admin', description: 'Platform console: schools, usage and audit (asks you to set up two-factor on first use).', identifier: 'root@demo.test', platform: true },
  { key: 'school_admin', label: 'School Admin', description: 'Owner of the demo school: students, staff, fees, exams and settings.', identifier: 'owner@demo.test' },
  { key: 'teacher', label: 'Teacher', description: 'Marks attendance and enters marks for the assigned class.', identifier: 'tina@demo.test' },
  { key: 'accountant', label: 'Accountant', description: 'Fee desk: collect fees, receipts, dues and day close.', identifier: 'accountant@demo.test' },
  { key: 'parent', label: 'Parent', description: 'Child dashboard: attendance, results, fees and notices.', identifier: 'parent@demo.test' },
  { key: 'student', label: 'Student', description: 'Own dashboard: attendance, results and report cards.', identifier: 'demo-a1@demo.student' },
];
