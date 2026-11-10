import type { Types } from 'mongoose';
import { ROLE_TEMPLATES } from '@edunex/shared';
import { roles } from '../auth/auth.repository';

export const ROLE_TEMPLATE_VERSION = 2;

/** Seeds the system roles for a school from the shared templates (idempotent). */
export async function seedSystemRoles(schoolId: Types.ObjectId): Promise<void> {
  for (const t of ROLE_TEMPLATES) {
    const exists = await roles.findOne({ schoolId, key: t.key }, 'provision: check role');
    if (exists) continue;
    await roles.create(
      {
        schoolId,
        key: t.key,
        name: t.name,
        description: t.description,
        isSystem: true,
        permissions: t.grants.map((g) => ({ key: g.key, scope: g.scope })),
        templateVersion: ROLE_TEMPLATE_VERSION,
      },
      'provision: seed system roles',
    );
  }
}

/**
 * Additive role sync for schools provisioned BEFORE new permission keys existed: adds missing template grants (and
 * missing system roles) to every school. It never removes a grant and never lowers a scope. Idempotent; runs at server
 * start and via `cli sync-roles`. (System roles are not editable in the UI yet, so nothing of a school's is overwritten.)
 */
export async function syncSystemRoles(): Promise<{ schools: number; rolesCreated: number; grantsAdded: number }> {
  const { schools } = await import('../auth/auth.repository');
  let rolesCreated = 0;
  let grantsAdded = 0;
  const all = await schools.find({}, 'roles sync: list schools');
  for (const school of all) {
    for (const t of ROLE_TEMPLATES) {
      const row = await roles.findOne({ schoolId: school._id, key: t.key }, 'roles sync: find role');
      if (!row) {
        await seedSystemRoles(school._id);
        rolesCreated++;
        continue;
      }
      if ((row.templateVersion ?? 0) >= ROLE_TEMPLATE_VERSION) continue;
      const have = new Set((row.permissions as Array<{ key: string }>).map((p) => p.key));
      const missing = t.grants.filter((g) => !have.has(g.key));
      const update: Record<string, unknown> = { $set: { templateVersion: ROLE_TEMPLATE_VERSION } };
      if (missing.length) update.$push = { permissions: { $each: missing.map((g) => ({ key: g.key, scope: g.scope })) } };
      await roles.updateOne({ _id: row._id }, update, 'roles sync: add grants');
      grantsAdded += missing.length;
    }
  }
  return { schools: all.length, rolesCreated, grantsAdded };
}
