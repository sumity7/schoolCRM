import type { Types } from 'mongoose';
import type { Scope } from '@edunex/shared';
import { conflict, forbidden, notFound, validationFailed } from '../../core/errors';
import { AuditService } from '../../core/audit/audit.service';
import { requireTenant } from '../../core/tenancy/context';
import { toObjectId } from '../../core/tenancy/repository';
import { JobQueue, registerJobHandler } from '../../core/jobs/job-queue';
import type { EmailAdapter } from '../../core/notifications/email';
import { AcademicsService } from '../academics/academics.service';
import { sectionRepo, sessionRepo } from '../academics/academics.repository';
import { enrollmentRepo, guardianRepo, studentGuardianRepo } from '../students/students.repository';
import { getSchoolById } from '../schools/schools.service';
import { isGuardian, isStudentUser, linkedChildren } from '../parent/parent-access';
import { studentRepo } from '../students/students.repository';
import { noticeDeliveryRepo, noticeReadRepo, noticeRepo } from './notices.repository';
import type { NoticeAudience } from './notices.model';

export interface NoticeInput { title: string; body: string; audience: NoticeAudience; sectionIds?: string[]; emailParents?: boolean }

async function activeSectionIdsOfChildren(): Promise<Types.ObjectId[]> {
  const kids = await linkedChildren();
  const session = await sessionRepo.findActive();
  if (!session || !kids.length) return [];
  const enr = await enrollmentRepo.find({ sessionId: session._id, studentId: { $in: kids.map((k) => k.studentId) }, status: 'active' }, { select: 'sectionId' });
  return enr.map((e) => e.sectionId);
}

export const NoticesService = {
  async create(createScope: Scope | undefined, input: NoticeInput, authorName: string) {
    const tenant = requireTenant('notices.create');
    const sectionIds = (input.sectionIds ?? []).map((s) => toObjectId(s)).filter((x): x is Types.ObjectId => x !== null);
    if (input.audience === 'sections') {
      if (!sectionIds.length) throw validationFailed('Choose at least one class/section');
      const found = await sectionRepo.findByIds(sectionIds);
      if (found.length !== sectionIds.length) throw notFound('Section');
    } else if (sectionIds.length) {
      throw validationFailed('Sections are only used with the "selected classes" audience');
    }
    if (createScope !== 'school') {
      // teachers post only to the sections they teach
      if (input.audience !== 'sections') throw forbidden('Teachers can post notices only to their own classes');
      const access = await AcademicsService.sectionAccess(tenant, createScope);
      const mine = new Set(access.all ? [] : access.sectionIds.map(String));
      if (!access.all && sectionIds.some((s) => !mine.has(String(s)))) throw forbidden('You can post only to classes you teach');
    }
    const n = await noticeRepo.create({
      title: input.title, body: input.body, audience: input.audience, sectionIds, emailParents: Boolean(input.emailParents) && input.audience !== 'staff',
      status: 'published', createdByName: authorName, publishedAt: new Date(),
    });
    if (n.emailParents) await JobQueue.enqueue('notice.email', { noticeId: String(n._id) }, { key: `notice-email:${n._id}` });
    await AuditService.record({ action: 'notices.published', entityType: 'notice', entityId: n._id, after: { title: n.title, audience: n.audience, sections: sectionIds.length, emailParents: n.emailParents } });
    return n;
  },

  /** Mongo filter of the notices the CURRENT member may read. */
  async visibleFilter(readScope: Scope | undefined, canManage: boolean): Promise<Record<string, unknown>> {
    const tenant = requireTenant('notices.visible');
    const base = { status: 'published' };
    if (isStudentUser()) {
      // students see everyone-notices and notices for their own class only — never staff/parent-only ones
      const s = await studentRepo.findById(tenant.personId);
      const session = await sessionRepo.findActive();
      const enr = s && session ? await enrollmentRepo.findOne({ studentId: s._id, sessionId: session._id, status: 'active' }) : null;
      return { ...base, $or: [{ audience: 'everyone' }, { audience: 'sections', sectionIds: { $in: enr ? [enr.sectionId] : [] } }] };
    }
    if (isGuardian()) {
      const secs = await activeSectionIdsOfChildren();
      return { ...base, $or: [{ audience: { $in: ['everyone', 'parents'] } }, { audience: 'sections', sectionIds: { $in: secs } }] };
    }
    if (canManage) return {}; // school-wide notice managers see everything incl. withdrawn
    const access = await AcademicsService.sectionAccess(tenant, readScope === 'school' ? 'assigned' : readScope);
    const secs = access.all ? [] : access.sectionIds;
    return { ...base, $or: [{ audience: { $in: ['everyone', 'staff'] } }, { audience: 'sections', sectionIds: { $in: secs } }] };
  },

  async list(readScope: Scope | undefined, canManage: boolean, page: number, limit: number) {
    const tenant = requireTenant('notices.list');
    const filter = await this.visibleFilter(readScope, canManage);
    const res = await noticeRepo.paginate(filter, page, limit, { publishedAt: -1 });
    const reads = await noticeReadRepo.find({ membershipId: tenant.membershipId, noticeId: { $in: res.data.map((n) => n._id) } }, { select: 'noticeId' });
    const readSet = new Set(reads.map((r) => String(r.noticeId)));
    const unread = await noticeRepo.count({ ...filter, status: 'published', _id: { $nin: (await noticeReadRepo.find({ membershipId: tenant.membershipId }, { select: 'noticeId' })).map((r) => r.noticeId) } });
    return { meta: res.meta, unread, data: res.data.map((n) => ({ ...toNoticeDto(n), read: readSet.has(String(n._id)) })) };
  },

  async getVisible(id: string, readScope: Scope | undefined, canManage: boolean) {
    const oid = toObjectId(id);
    const n = oid ? await noticeRepo.findOne({ ...(await this.visibleFilter(readScope, canManage)), _id: oid }) : null;
    if (!n) throw notFound('Notice');
    return n;
  },

  async markRead(id: string, readScope: Scope | undefined, canManage: boolean) {
    const tenant = requireTenant('notices.read');
    const n = await this.getVisible(id, readScope, canManage);
    if (!(await noticeReadRepo.exists({ noticeId: n._id, membershipId: tenant.membershipId }))) {
      try {
        await noticeReadRepo.create({ noticeId: n._id, membershipId: tenant.membershipId, readAt: new Date() });
      } catch (err) {
        if ((err as { code?: number }).code !== 11000) throw err; // a parallel tab marked it first
      }
    }
  },

  async withdraw(id: string, createScope: Scope | undefined) {
    const tenant = requireTenant('notices.withdraw');
    const n = await noticeRepo.getById(id, 'Notice');
    if (createScope !== 'school' && !n.createdBy?.equals(tenant.membershipId)) throw forbidden('Only the author or an administrator can withdraw this notice');
    if (n.status === 'withdrawn') throw conflict('Already withdrawn');
    const u = await noticeRepo.updateById(n._id, { status: 'withdrawn', withdrawnAt: new Date() });
    await AuditService.record({ action: 'notices.withdrawn', entityType: 'notice', entityId: n._id, after: { title: n.title } });
    return u;
  },

  async stats(id: string) {
    const n = await noticeRepo.getById(id, 'Notice');
    const [reads, deliveries] = await Promise.all([noticeReadRepo.count({ noticeId: n._id }), noticeDeliveryRepo.find({ noticeId: n._id }, { select: 'status' })]);
    const by: Record<string, number> = {};
    for (const d of deliveries) by[d.status] = (by[d.status] ?? 0) + 1;
    return { reads, emails: by };
  },

  /** Recipient e-mail addresses: guardians with a VERIFIED, not-ended link to an actively enrolled student in the audience. */
  async parentEmails(audience: NoticeAudience, sectionIds: Types.ObjectId[]): Promise<string[]> {
    const session = await sessionRepo.findActive();
    if (!session) return [];
    const ef: Record<string, unknown> = { sessionId: session._id, status: 'active' };
    if (audience === 'sections') ef.sectionId = { $in: sectionIds };
    const studentIds = (await enrollmentRepo.find(ef, { select: 'studentId' })).map((e) => e.studentId);
    if (!studentIds.length) return [];
    const links = await studentGuardianRepo.find({ studentId: { $in: studentIds }, verifiedAt: { $ne: null }, endedAt: null }, { select: 'guardianId' });
    const guardians = await guardianRepo.findByIds([...new Set(links.map((l) => String(l.guardianId)))], { select: 'email' });
    return [...new Set(guardians.map((g) => g.email?.trim().toLowerCase()).filter((e): e is string => Boolean(e)))].sort();
  },
};

export function toNoticeDto(n: Awaited<ReturnType<typeof noticeRepo.getById>>) {
  return {
    id: String(n._id), title: n.title, body: n.body, audience: n.audience, sectionIds: n.sectionIds.map(String), emailParents: n.emailParents,
    status: n.status, createdByName: n.createdByName, publishedAt: n.publishedAt, createdBy: n.createdBy ? String(n.createdBy) : null,
  };
}

/** Email fan-out job — idempotent: each (notice, address) is sent at most once, even if the job is retried. */
export function registerNoticeJobs(email: EmailAdapter) {
  registerJobHandler('notice.email', async (payload) => {
    const t = requireTenant('notice.email job');
    const n = await noticeRepo.getById(String(payload.noticeId), 'Notice');
    if (n.status !== 'published') return;
    const school = await getSchoolById(t.schoolId);
    for (const to of await NoticesService.parentEmails(n.audience, n.sectionIds)) {
      if (await noticeDeliveryRepo.exists({ noticeId: n._id, channel: 'email', destination: to })) continue;
      const res = await email.send({ to, subject: `${school.name}: ${n.title}`, text: `${n.body}\n\n— ${n.createdByName}, ${school.name}\n(Sent via EduNex. Log in to the parent portal to see all notices.)` });
      try {
        await noticeDeliveryRepo.create({ noticeId: n._id, channel: 'email', destination: to, status: res.status });
      } catch (err) {
        if ((err as { code?: number }).code !== 11000) throw err;
      }
    }
  });
}
