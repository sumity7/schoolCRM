import { describe, it, expect } from 'vitest';
import { PERMISSION_KEYS, ROLE_TEMPLATES, SYSTEM_ROLE_KEYS, addDays, classifyIdentifier, isPermissionKey, isValidDay, isoWeekday, normalizePhone, resolveGrants, scopeAtLeast, todayInTz } from '@edunex/shared';

describe('shared: identifiers (D-03)', () => {
  it('classifies and normalises email and Indian phone numbers', () => {
    expect(classifyIdentifier(' Foo@Bar.COM ')).toEqual({ kind: 'email', value: 'foo@bar.com' });
    expect(classifyIdentifier('98123 45678')).toEqual({ kind: 'phone', value: '+919812345678' });
    expect(classifyIdentifier('+91-98123-45678')?.value).toBe('+919812345678');
    expect(classifyIdentifier('09812345678')?.value).toBe('+919812345678');
    expect(classifyIdentifier('not an identifier')).toBeNull();
    expect(normalizePhone('123')).toBeNull();
  });
});

describe('shared: calendar days', () => {
  it('validates real dates only', () => {
    expect(isValidDay('2026-02-28')).toBe(true);
    expect(isValidDay('2026-02-30')).toBe(false);
    expect(isValidDay('2028-02-29')).toBe(true);
    expect(isValidDay('2026-13-01')).toBe(false);
  });
  it('computes ISO weekday and day arithmetic without timezone drift', () => {
    expect(isoWeekday('2026-11-09')).toBe(1); // Monday
    expect(isoWeekday('2026-11-15')).toBe(7); // Sunday
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
  });
  it("derives 'today' in the school's timezone (IST ahead of UTC)", () => {
    const lateUtc = new Date('2026-11-09T20:00:00Z'); // 01:30 next day in IST
    expect(todayInTz('Asia/Kolkata', lateUtc)).toBe('2026-11-10');
    expect(todayInTz('UTC', lateUtc)).toBe('2026-11-09');
  });
});

describe('shared: permission catalogue and role templates', () => {
  it('has unique, well-formed permission keys', () => {
    expect(new Set(PERMISSION_KEYS).size).toBe(PERMISSION_KEYS.length);
    for (const k of PERMISSION_KEYS) expect(k).toMatch(/^[a-z.]+:[a-z]+$/);
  });
  it('every role template references valid keys, and all 11 system roles exist', () => {
    expect(ROLE_TEMPLATES.map((r) => r.key).sort()).toEqual([...SYSTEM_ROLE_KEYS].sort());
    for (const t of ROLE_TEMPLATES) for (const g of t.grants) expect(isPermissionKey(g.key), `${t.key}:${g.key}`).toBe(true);
  });
  it('encodes the separation-of-duties facts from doc 03', () => {
    const grants = (role: string) => resolveGrants(ROLE_TEMPLATES.find((r) => r.key === role)!.grants);
    expect(grants('teacher').has('financial:view')).toBe(false);
    expect(grants('accountant').has('marks:update')).toBe(false); // accountant cannot change marks
    expect(grants('teacher').get('attendance:create')).toBe('assigned');
    expect(grants('parent').get('students:read')).toBe('own');
    expect(grants('admin').has('roles:manage')).toBe(false);
    expect(grants('admin').has('staff.salary:read')).toBe(false);
    expect(grants('owner').size).toBe(PERMISSION_KEYS.length);
  });
  it('union of roles takes the highest scope; scope ordering is own < assigned < school', () => {
    const merged = resolveGrants([{ key: 'students:read', scope: 'own' }, { key: 'students:read', scope: 'school' }]);
    expect(merged.get('students:read')).toBe('school');
    expect(scopeAtLeast('school', 'assigned')).toBe(true);
    expect(scopeAtLeast('own', 'assigned')).toBe(false);
    expect(scopeAtLeast(undefined, 'own')).toBe(false);
  });
});

describe('attendance summary from counts', () => {
  it('summariseCounts gives exactly the same result as summariseAttendance for every policy', async () => {
    const { summariseAttendance, summariseCounts } = await import('@edunex/shared');
    const all = ['present', 'absent', 'late', 'half_day', 'excused'] as const;
    for (let seed = 1; seed < 200; seed++) {
      const statuses = Array.from({ length: seed % 37 }, (_, i) => all[(i * seed + seed) % 5]!);
      const c = { present: 0, absent: 0, late: 0, halfDay: 0, excused: 0 };
      for (const s of statuses) c[s === 'half_day' ? 'halfDay' : s]++;
      for (const policy of [{ lateCountsAsPresent: true, halfDayWeight: 0.5 }, { lateCountsAsPresent: false, halfDayWeight: 1 }, { lateCountsAsPresent: false, halfDayWeight: 0 }]) {
        expect(summariseCounts(c, policy)).toEqual(summariseAttendance(statuses, policy));
      }
    }
  });
});
