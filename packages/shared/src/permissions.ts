/**
 * Permission catalogue — the single source of truth consumed by API, UI and tests.
 * Permission key = `resource:action`. A grant carries a SCOPE limiting which records it applies to.
 * See docs/phase-0/03-rbac-matrix.md.
 */

export const SCOPES = ['own', 'assigned', 'school'] as const;
export type Scope = (typeof SCOPES)[number];
const SCOPE_RANK: Record<Scope, number> = { own: 1, assigned: 2, school: 3 };

export const PERMISSION_KEYS = [
  'school.settings:read',
  'school.settings:update',
  'users:create',
  'users:read',
  'users:update',
  'roles:manage',
  'academics:create',
  'academics:read',
  'academics:update',
  'academics:delete',
  'academics:approve',
  'students:create',
  'students:read',
  'students:update',
  'students:delete',
  'students:export',
  'students:print',
  'students.medical:read',
  'students.medical:update',
  'students.documents:create',
  'students.documents:read',
  'students.documents:delete',
  'guardians:create',
  'guardians:read',
  'guardians:update',
  'staff:create',
  'staff:read',
  'staff:update',
  'staff:delete',
  'staff.salary:read',
  'staff.salary:update',
  'attendance:create',
  'attendance:read',
  'attendance:update',
  'attendance:approve',
  'attendance:export',
  'exams:create',
  'exams:read',
  'exams:update',
  'exams:approve',
  'marks:create',
  'marks:read',
  'marks:update',
  'results:read',
  'results:approve',
  'results:publish',
  'results:export',
  'results:print',
  'fees.config:create',
  'fees.config:read',
  'fees.config:update',
  'fees.config:approve',
  'invoices:create',
  'invoices:read',
  'payments:create',
  'payments:read',
  'payments:print',
  'refunds:request',
  'refunds:approve',
  'discounts:apply',
  'discounts:approve',
  'reports:read',
  'reports:export',
  'financial:view',
  'notices:create',
  'notices:read',
  'imports:create',
  'imports:approve',
  'audit:read',
] as const;

export type PermissionKey = (typeof PERMISSION_KEYS)[number];

export interface PermissionGrant {
  key: PermissionKey;
  scope: Scope;
}

export function isPermissionKey(k: string): k is PermissionKey {
  return (PERMISSION_KEYS as readonly string[]).includes(k);
}

export function maxScope(a: Scope | undefined, b: Scope): Scope {
  if (!a) return b;
  return SCOPE_RANK[a] >= SCOPE_RANK[b] ? a : b;
}

export function scopeAtLeast(have: Scope | undefined, need: Scope): boolean {
  if (!have) return false;
  return SCOPE_RANK[have] >= SCOPE_RANK[need];
}

/** Union of grants (multiple roles): highest scope wins per key. */
export function resolveGrants(grants: PermissionGrant[]): Map<PermissionKey, Scope> {
  const out = new Map<PermissionKey, Scope>();
  for (const g of grants) out.set(g.key, maxScope(out.get(g.key), g.scope));
  return out;
}

// ---------------------------------------------------------------------------
// System role templates (seeded per school; data, not code, once seeded)
// ---------------------------------------------------------------------------

export const SYSTEM_ROLE_KEYS = [
  'owner',
  'admin',
  'principal',
  'accountant',
  'teacher',
  'class_teacher',
  'librarian',
  'transport_manager',
  'receptionist',
  'parent',
  'student',
] as const;
export type SystemRoleKey = (typeof SYSTEM_ROLE_KEYS)[number];

export interface RoleTemplate {
  key: SystemRoleKey;
  name: string;
  description: string;
  grants: PermissionGrant[];
  /** Roles that may only be held by a person of this type (guards against misassignment). */
  personTypes: Array<'staff' | 'guardian' | 'student' | 'owner'>;
}

const g = (keys: PermissionKey[], scope: Scope): PermissionGrant[] => keys.map((key) => ({ key, scope }));

const ALL_SCHOOL_LEVEL: PermissionKey[] = [...PERMISSION_KEYS];

const ADMIN_KEYS: PermissionKey[] = PERMISSION_KEYS.filter(
  (k) => !['roles:manage', 'staff.salary:read', 'staff.salary:update', 'financial:view', 'refunds:approve', 'discounts:approve'].includes(k) &&
    !k.startsWith('fees.config') && !k.startsWith('invoices') && !k.startsWith('payments') && !k.startsWith('refunds') && !k.startsWith('discounts'),
);

export const ROLE_TEMPLATES: RoleTemplate[] = [
  {
    key: 'owner',
    name: 'School Owner',
    description: 'Full school-level authority',
    personTypes: ['owner', 'staff'],
    grants: g(ALL_SCHOOL_LEVEL, 'school'),
  },
  {
    key: 'admin',
    name: 'School Admin',
    description: 'Day-to-day operations: admissions, students, staff, academics, notices',
    personTypes: ['staff'],
    grants: [
      ...g(ADMIN_KEYS, 'school'),
      ...g(['audit:read'], 'school'),
    ],
  },
  {
    key: 'principal',
    name: 'Principal',
    description: 'Academic oversight, approvals and reports',
    personTypes: ['staff'],
    grants: g(
      [
        'school.settings:read', 'users:read', 'academics:read', 'academics:approve', 'students:read', 'students:export', 'students:print',
        'guardians:read', 'staff:read', 'attendance:read', 'attendance:approve', 'attendance:export', 'exams:read', 'exams:approve',
        'marks:read', 'results:read', 'results:approve', 'results:publish', 'results:export', 'results:print', 'reports:read', 'reports:export',
        'notices:create', 'notices:read', 'audit:read',
      ],
      'school',
    ),
  },
  {
    key: 'accountant',
    name: 'Accountant',
    description: 'Fee configuration, collection, receipts, financial reports',
    personTypes: ['staff'],
    grants: [
      ...g(['school.settings:read', 'academics:read', 'students:read', 'guardians:read', 'staff:read', 'staff.salary:read'], 'school'),
      ...g(
        [
          'fees.config:create', 'fees.config:read', 'fees.config:update', 'invoices:create', 'invoices:read', 'payments:create', 'payments:read',
          'payments:print', 'refunds:request', 'discounts:apply', 'reports:read', 'reports:export', 'financial:view', 'notices:create', 'notices:read',
        ],
        'school',
      ),
    ],
  },
  {
    key: 'teacher',
    name: 'Teacher',
    description: 'Assigned classes and subjects',
    personTypes: ['staff'],
    grants: [
      ...g(['school.settings:read', 'academics:read', 'exams:read', 'notices:read'], 'school'),
      ...g(
        ['students:read', 'guardians:read', 'attendance:create', 'attendance:read', 'attendance:update', 'marks:create', 'marks:read', 'marks:update', 'results:read', 'reports:read', 'notices:create'],
        'assigned',
      ),
      ...g(['staff:read'], 'own'),
    ],
  },
  {
    key: 'class_teacher',
    name: 'Class Teacher',
    description: 'Teacher plus oversight of the assigned class',
    personTypes: ['staff'],
    grants: [
      ...g(['school.settings:read', 'academics:read', 'exams:read', 'notices:read'], 'school'),
      ...g(
        [
          'students:read', 'students:update', 'students.medical:read', 'guardians:read', 'attendance:create', 'attendance:read', 'attendance:update',
          'attendance:approve', 'marks:create', 'marks:read', 'marks:update', 'results:read', 'results:print', 'reports:read', 'notices:create',
        ],
        'assigned',
      ),
      ...g(['staff:read'], 'own'),
    ],
  },
  {
    key: 'librarian',
    name: 'Librarian',
    description: 'Library operations (module arrives later)',
    personTypes: ['staff'],
    grants: [...g(['school.settings:read', 'academics:read', 'students:read', 'notices:read'], 'school'), ...g(['staff:read'], 'own')],
  },
  {
    key: 'transport_manager',
    name: 'Transport Manager',
    description: 'Transport operations (module arrives later)',
    personTypes: ['staff'],
    grants: [...g(['school.settings:read', 'academics:read', 'students:read', 'notices:read'], 'school'), ...g(['staff:read'], 'own')],
  },
  {
    key: 'receptionist',
    name: 'Receptionist / Admission Staff',
    description: 'Enquiries, admissions and student registration',
    personTypes: ['staff'],
    grants: [
      ...g(
        ['school.settings:read', 'academics:read', 'students:create', 'students:read', 'students:update', 'guardians:create', 'guardians:read', 'guardians:update', 'students.documents:create', 'students.documents:read', 'notices:read', 'reports:read'],
        'school',
      ),
      ...g(['staff:read'], 'own'),
    ],
  },
  {
    key: 'parent',
    name: 'Parent / Guardian',
    description: 'Linked children only',
    personTypes: ['guardian'],
    grants: g(['students:read', 'attendance:read', 'results:read', 'results:print', 'notices:read', 'invoices:read', 'payments:read', 'payments:print', 'students.documents:read'], 'own'),
  },
  {
    key: 'student',
    name: 'Student',
    description: 'Own academic information only',
    personTypes: ['student'],
    grants: g(['students:read', 'attendance:read', 'results:read', 'results:print', 'notices:read'], 'own'),
  },
];

export function roleTemplate(key: SystemRoleKey): RoleTemplate {
  const t = ROLE_TEMPLATES.find((r) => r.key === key);
  if (!t) throw new Error(`Unknown role template ${key}`);
  return t;
}
