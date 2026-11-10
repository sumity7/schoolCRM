import type { Types } from 'mongoose';
import { PlatformRepository } from '../../core/tenancy/platform-repository';
import { StudentModel, type IStudent } from '../students/students.model';
import { MembershipModel, type IMembership } from '../memberships/membership.model';
import { PaymentModel, type IPayment } from '../fees/fees.model';

/** Cross-tenant, read-only usage counts for the platform console. Every call states its reason (audited pattern). */
const students = new PlatformRepository<IStudent>(StudentModel);
const memberships = new PlatformRepository<IMembership>(MembershipModel);
const payments = new PlatformRepository<IPayment>(PaymentModel);

const bySchool = async (repo: PlatformRepository<never>, match: Record<string, unknown>, reason: string) =>
  new Map((await repo.aggregate<{ _id: Types.ObjectId; n: number }>([{ $match: match }, { $group: { _id: '$schoolId', n: { $sum: 1 } } }], reason)).map((r) => [String(r._id), r.n]));

export const PlatformUsage = {
  activeStudents: () => bySchool(students as never, { status: 'active' }, 'platform: active students per school'),
  activeStaff: () => bySchool(memberships as never, { status: 'active', personType: { $in: ['staff', 'owner'] } }, 'platform: active staff per school'),
  parents: () => bySchool(memberships as never, { status: 'active', personType: 'guardian' }, 'platform: parent logins per school'),
  receiptsLast30Days: (since: string) => bySchool(payments as never, { status: 'recorded', paidOn: { $gte: since } }, 'platform: receipts per school (30 days)'),
};
