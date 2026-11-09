import type { Types } from 'mongoose';
import { ROLE_TEMPLATES } from '@edunex/shared';
import { roles } from '../auth/auth.repository';

export const ROLE_TEMPLATE_VERSION = 1;

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
