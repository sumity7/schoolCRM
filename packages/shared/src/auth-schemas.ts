import { z } from 'zod';
import { objectIdSchema } from './common';

/** Password policy (doc 02 AUTH): length ≥ 10; breach-list check arrives later. */
export const passwordSchema = z
  .string()
  .min(10, 'Password must be at least 10 characters')
  .max(128, 'Password must be at most 128 characters')
  .refine((p) => /[A-Za-z]/.test(p) && /[\d\W_]/.test(p), 'Use letters and at least one number or symbol');

export const loginSchema = z
  .object({
    identifier: z.string().trim().min(3).max(254),
    password: z.string().min(1).max(128),
    rememberMe: z.boolean().optional(),
  })
  .strict();
export type LoginInput = z.infer<typeof loginSchema>;

export const selectSchoolSchema = z.object({ membershipId: objectIdSchema }).strict();

export const forgotPasswordSchema = z.object({ identifier: z.string().trim().min(3).max(254) }).strict();

export const resetPasswordSchema = z.object({ token: z.string().min(20).max(200), password: passwordSchema }).strict();

export const changePasswordSchema = z
  .object({ currentPassword: z.string().min(1).max(128), newPassword: passwordSchema })
  .strict();

export const acceptInviteSchema = z
  .object({ token: z.string().min(20).max(200), password: passwordSchema, name: z.string().trim().min(1).max(120).optional() })
  .strict();

export interface MembershipSummary {
  membershipId: string;
  schoolId: string;
  schoolName: string;
  schoolCode: string;
  roleKeys: string[];
}

export interface MeResponse {
  user: { id: string; name: string; email?: string; phone?: string };
  activeMembershipId: string | null;
  school: { id: string; name: string; code: string; timezone: string } | null;
  roleKeys: string[];
  /** For UI hints only — the server re-checks every request. */
  permissions: Array<{ key: string; scope: string }>;
  memberships: MembershipSummary[];
}
