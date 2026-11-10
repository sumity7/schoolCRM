import { z } from 'zod';
import type { Registrar } from '../../core/http/route';
import { getSchoolById, updateSchoolProfile } from './schools.service';

const toDto = (s: Awaited<ReturnType<typeof getSchoolById>>) => ({
  id: String(s._id),
  name: s.name,
  code: s.code,
  type: s.type,
  board: s.board,
  address: s.address,
  officialEmail: s.officialEmail,
  phone: s.phone,
  website: s.website,
  status: s.status,
  settings: s.settings,
  limits: s.limits,
});

const profilePatch = z
  .object({
    name: z.string().trim().min(2).max(160),
    phone: z.string().trim().max(30),
    website: z.string().trim().url().max(200),
    officialEmail: z.string().trim().email().max(200),
    address: z
      .object({ line1: z.string().max(200), line2: z.string().max(200), city: z.string().max(80), state: z.string().max(80), postalCode: z.string().max(12) })
      .partial()
      .strict(),
  })
  .partial()
  .strict();

const settingsPatch = z
  .object({
    workingDays: z.array(z.number().int().min(1).max(7)).min(1).max(7).refine((a) => new Set(a).size === a.length, 'duplicate days'),
    dateFormat: z.enum(['DD/MM/YYYY', 'MM/DD/YYYY', 'YYYY-MM-DD']),
    themeColor: z.string().regex(/^#[0-9a-fA-F]{6}$/),
    language: z.enum(['en', 'hi']),
    academicYearStartMonth: z.number().int().min(1).max(12),
    portalPolicy: z.object({ studentsSeeFees: z.boolean(), studentsSeeRank: z.boolean(), parentsSeeFees: z.boolean(), parentsSeeRank: z.boolean(), parentsSeeResults: z.boolean() }).partial().strict(),
    attendancePolicy: z
      .object({
        teacherEditWindowDays: z.number().int().min(0).max(30),
        lateCountsAsPresent: z.boolean(),
        halfDayWeight: z.number().min(0).max(1),
        lowAttendanceThresholdPct: z.number().min(1).max(100),
      })
      .partial()
      .strict(),
  })
  .partial()
  .strict();

export function registerSchoolRoutes(r: Registrar) {
  r.define({
    method: 'get', path: '/schools/me', summary: 'Own school profile', tenancy: 'school', auth: 'session', anyMember: true,
    async handler({ tenant }) {
      return { data: toDto(await getSchoolById(tenant.schoolId)) };
    },
  });

  r.define({
    method: 'patch', path: '/schools/me', summary: 'Update own school profile', tenancy: 'school', auth: 'session', permission: 'school.settings:update',
    body: profilePatch, audit: true,
    async handler({ tenant, body }) {
      const before = await getSchoolById(tenant.schoolId);
      const patch: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(body)) {
        if (k === 'address') for (const [ak, av] of Object.entries(v as object)) patch[`address.${ak}`] = av;
        else patch[k] = v;
      }
      const after = await updateSchoolProfile(tenant.schoolId, patch);
      return { data: toDto(after), audit: { action: 'school.profile_updated', entityType: 'school', entityId: tenant.schoolId, before: { name: before.name, phone: before.phone }, after: body } };
    },
  });

  r.define({
    method: 'get', path: '/schools/me/settings', summary: 'Own school settings', tenancy: 'school', auth: 'session', permission: 'school.settings:read',
    async handler({ tenant }) {
      return { data: (await getSchoolById(tenant.schoolId)).settings };
    },
  });

  r.define({
    method: 'patch', path: '/schools/me/settings', summary: 'Update own school settings (working days, policies, theme)', tenancy: 'school', auth: 'session', permission: 'school.settings:update',
    body: settingsPatch, audit: true,
    async handler({ tenant, body }) {
      const before = await getSchoolById(tenant.schoolId);
      const patch: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(body)) {
        if (k === 'attendancePolicy' || k === 'portalPolicy') {
          for (const [pk, pv] of Object.entries(v as object)) patch[`settings.${k}.${pk}`] = pv;
        } else patch[`settings.${k}`] = v;
      }
      const after = await updateSchoolProfile(tenant.schoolId, patch);
      return { data: after.settings, audit: { action: 'school.settings_updated', entityType: 'school', entityId: tenant.schoolId, before: before.settings, after: body } };
    },
  });

  r.define({
    method: 'get', path: '/schools/me/entitlements', summary: 'Plan limits and current usage (real counts)', tenancy: 'school', auth: 'session', anyMember: true,
    async handler({ tenant }) {
      const s = await getSchoolById(tenant.schoolId);
      return { data: { limits: s.limits } };
    },
  });
}
