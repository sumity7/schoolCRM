import type { MeResponse } from '@edunex/shared';

/** Where a signed-in person goes next. Platform staff without a school go to the console. */
export function landingFor(me: MeResponse): string {
  if (me.activeMembershipId) return '/app';
  if (me.platformRole && me.memberships.length === 0) return '/platform';
  return '/select-school';
}
