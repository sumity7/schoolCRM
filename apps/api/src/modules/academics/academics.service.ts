import { Types } from 'mongoose';
import { isValidDay, type Scope } from '@edunex/shared';
import { conflict, forbidden, validationFailed } from '../../core/errors';
import { AuditService } from '../../core/audit/audit.service';
import { withTransaction } from '../../core/db/connection';
import { requireTenant, type TenantContext } from '../../core/tenancy/context';
import { toObjectId } from '../../core/tenancy/repository';
import { staffRepo } from '../staff/staff.repository';
import { enrollmentRepo } from '../students/students.repository';
import { assignmentRepo, calendarRepo, classRepo, sectionRepo, sessionRepo, subjectRepo } from './academics.repository';

export type SectionAccess = { all: true } | { all: false; sectionIds: Types.ObjectId[] };

export const AcademicsService = {
  // ---------------------------------------------------------------- sessions
  async requireActiveSession() {
    const s = await sessionRepo.findActive();
    if (!s) throw conflict('No active academic session. Create and activate one first.');
    return s;
  },

  async createSession(input: { name: string; startDate: string; endDate: string }) {
    if (!isValidDay(input.startDate) || !isValidDay(input.endDate)) throw validationFailed('Dates must be valid YYYY-MM-DD');
    if (input.startDate >= input.endDate) throw validationFailed('Start date must be before end date');
    return sessionRepo.create({ ...input, status: 'draft' });
  },

  async updateSession(id: string, patch: { name?: string; startDate?: string; endDate?: string }) {
    const s = await sessionRepo.getById(id, 'Session');
    if (s.status === 'closed') throw conflict('A closed session cannot be edited');
    const start = patch.startDate ?? s.startDate;
    const end = patch.endDate ?? s.endDate;
    if (!isValidDay(start) || !isValidDay(end) || start >= end) throw validationFailed('Start date must be before end date');
    return sessionRepo.updateById(id, patch, { what: 'Session' });
  },

  async activateSession(id: string) {
    const s = await sessionRepo.getById(id, 'Session');
    if (s.status === 'active') return s;
    if (s.status === 'closed') throw conflict('A closed session cannot be re-activated');
    const current = await sessionRepo.findActive();
    if (current) throw conflict(`Close the active session (${current.name}) before activating another`);
    const updated = await sessionRepo.updateById(id, { status: 'active' }, { what: 'Session' });
    await AuditService.record({ action: 'academics.session_activated', entityType: 'session', entityId: id });
    return updated;
  },

  async closeSession(id: string) {
    const s = await sessionRepo.getById(id, 'Session');
    if (s.status !== 'active') throw conflict('Only the active session can be closed');
    const updated = await sessionRepo.updateById(id, { status: 'closed' }, { what: 'Session' });
    await AuditService.record({ action: 'academics.session_closed', entityType: 'session', entityId: id });
    return updated;
  },

  // ---------------------------------------------------------------- classes
  async createClass(input: { sessionId: string; name: string; order?: number; stream?: string }) {
    const session = await sessionRepo.getById(input.sessionId, 'Session');
    if (session.status === 'closed') throw conflict('Cannot add classes to a closed session');
    return classRepo.create({ ...input, sessionId: session._id, order: input.order ?? 0 });
  },

  async deleteClass(id: string) {
    const c = await classRepo.getById(id, 'Class');
    if ((await sectionRepo.count({ classId: c._id })) > 0) throw conflict('Delete or move the sections of this class first');
    await classRepo.softDeleteById(id, 'Class');
    await AuditService.record({ action: 'academics.class_deleted', entityType: 'class', entityId: id, before: { name: c.name } });
  },

  // ---------------------------------------------------------------- sections
  async createSection(input: { classId: string; name: string; capacity?: number; classTeacherId?: string | null }) {
    const cls = await classRepo.getById(input.classId, 'Class');
    const classTeacherId = input.classTeacherId ? await this.assertTeachingStaff(input.classTeacherId) : null;
    const section = await sectionRepo.create({ sessionId: cls.sessionId, classId: cls._id, name: input.name, capacity: input.capacity, classTeacherId });
    if (classTeacherId) await this.upsertClassTeacherAssignment(cls.sessionId, classTeacherId, section._id);
    return section;
  },

  async updateSection(id: string, patch: { name?: string; capacity?: number; classTeacherId?: string | null }) {
    const sec = await sectionRepo.getById(id, 'Section');
    const set: Record<string, unknown> = {};
    if (patch.name !== undefined) set.name = patch.name;
    if (patch.capacity !== undefined) set.capacity = patch.capacity;
    if (patch.classTeacherId !== undefined) {
      set.classTeacherId = patch.classTeacherId ? await this.assertTeachingStaff(patch.classTeacherId) : null;
    }
    const updated = await sectionRepo.updateById(id, set, { what: 'Section' });
    if (set.classTeacherId) await this.upsertClassTeacherAssignment(sec.sessionId, set.classTeacherId as Types.ObjectId, sec._id);
    return updated;
  },

  async deleteSection(id: string) {
    const sec = await sectionRepo.getById(id, 'Section');
    if ((await enrollmentRepo.count({ sectionId: sec._id })) > 0) throw conflict('This section has enrolled students and cannot be deleted');
    await sectionRepo.softDeleteById(id, 'Section');
    await AuditService.record({ action: 'academics.section_deleted', entityType: 'section', entityId: id, before: { name: sec.name } });
  },

  // ---------------------------------------------------------------- assignments
  /** Refs are validated THROUGH the tenant repository, so another school's staff/section id is simply "not found". */
  async assertTeachingStaff(staffId: string): Promise<Types.ObjectId> {
    const staff = await staffRepo.getById(staffId, 'Staff member');
    if (staff.kind !== 'teaching' || staff.status !== 'active') throw validationFailed('Class teachers and assignments need an active teaching staff member');
    return staff._id;
  },

  async upsertClassTeacherAssignment(sessionId: Types.ObjectId, staffId: Types.ObjectId, sectionId: Types.ObjectId) {
    const existing = await assignmentRepo.findOne({ sessionId, staffId, sectionId, subjectId: null });
    if (existing) {
      if (!existing.isClassTeacher) await assignmentRepo.updateById(existing._id, { isClassTeacher: true });
      return;
    }
    await assignmentRepo.create({ sessionId, staffId, sectionId, subjectId: null, isClassTeacher: true });
  },

  async assignTeacher(input: { staffId: string; sectionId: string; subjectId?: string | null }) {
    const staffOid = await this.assertTeachingStaff(input.staffId);
    const section = await sectionRepo.getById(input.sectionId, 'Section');
    let subjectId: Types.ObjectId | null = null;
    if (input.subjectId) subjectId = (await subjectRepo.getById(input.subjectId, 'Subject'))._id;
    const dup = await assignmentRepo.findOne({ sessionId: section.sessionId, staffId: staffOid, sectionId: section._id, subjectId });
    if (dup) throw conflict('This assignment already exists');
    return assignmentRepo.create({ sessionId: section.sessionId, staffId: staffOid, sectionId: section._id, subjectId, isClassTeacher: false });
  },

  async removeAssignment(id: string) {
    const a = await assignmentRepo.getById(id, 'Assignment');
    await assignmentRepo.hardDeleteById(id, 'Assignment');
    await AuditService.record({ action: 'academics.assignment_removed', entityType: 'teacher_assignment', entityId: id, before: { staffId: String(a.staffId), sectionId: String(a.sectionId) } });
  },

  // ---------------------------------------------------------------- calendar
  async addEvent(input: { date: string; endDate?: string; type: 'holiday' | 'event' | 'exam' | 'ptm'; title: string }) {
    if (!isValidDay(input.date) || (input.endDate && (!isValidDay(input.endDate) || input.endDate < input.date))) throw validationFailed('Invalid dates');
    const session = await this.requireActiveSession();
    return calendarRepo.create({ ...input, sessionId: session._id });
  },

  async isHoliday(day: string): Promise<{ holiday: boolean; title?: string }> {
    const evs = await calendarRepo.find({ type: 'holiday', date: { $lte: day }, $or: [{ endDate: { $gte: day } }, { endDate: null }, { endDate: { $exists: false } }] });
    const hit = evs.find((e) => e.date === day || (e.endDate && e.date <= day && e.endDate >= day));
    return hit ? { holiday: true, title: hit.title } : { holiday: false };
  },

  // ---------------------------------------------------------------- scope (doc 03: Teacher `assigned`)
  /**
   * Which sections may this caller act on, given the scope of the permission that admitted them?
   *  - `school` → all sections;  - `assigned` → sections where the caller's staff record teaches or is class teacher
   *    in the ACTIVE session;  - `own` / none → no sections.
   */
  async sectionAccess(tenant: TenantContext, scope: Scope | undefined): Promise<SectionAccess> {
    if (scope === 'school') return { all: true };
    if (scope !== 'assigned' || tenant.personType !== 'staff' || !tenant.personId) return { all: false, sectionIds: [] };
    const session = await sessionRepo.findActive();
    if (!session) return { all: false, sectionIds: [] };
    const [assign, owned] = await Promise.all([
      assignmentRepo.find({ sessionId: session._id, staffId: tenant.personId }),
      sectionRepo.find({ sessionId: session._id, classTeacherId: tenant.personId }),
    ]);
    const ids = new Map<string, Types.ObjectId>();
    for (const a of assign) ids.set(String(a.sectionId), a.sectionId);
    for (const s of owned) ids.set(String(s._id), s._id);
    return { all: false, sectionIds: [...ids.values()] };
  },

  async assertSectionAccess(scope: Scope | undefined, sectionId: unknown): Promise<Awaited<ReturnType<typeof sectionRepo.getById>>> {
    const tenant = requireTenant('academics.assertSectionAccess');
    const section = await sectionRepo.getById(sectionId, 'Section'); // foreign/unknown → 404
    const access = await this.sectionAccess(tenant, scope);
    if (!access.all && !access.sectionIds.some((i) => i.equals(section._id))) throw forbidden('You are not assigned to this class');
    return section;
  },

  oid: toObjectId,
  withTransaction,
};
