import { Types } from 'mongoose';
import { isValidDay, todayInTz, type Scope } from '@edunex/shared';
import { conflict, entitlementRequired, forbidden, notFound, validationFailed } from '../../core/errors';
import { AuditService } from '../../core/audit/audit.service';
import { withTransaction } from '../../core/db/connection';
import { requireTenant } from '../../core/tenancy/context';
import { toObjectId } from '../../core/tenancy/repository';
import { AcademicsService } from '../academics/academics.service';
import { sectionRepo, classRepo } from '../academics/academics.repository';
import { getSchoolById } from '../schools/schools.service';
import { enrollmentRepo, guardianRepo, studentGuardianRepo, studentRepo } from './students.repository';
import type { IStudent, StudentStatus } from './students.model';

export const normalizeName = (first: string, last?: string) => `${first} ${last ?? ''}`.toLowerCase().replace(/\s+/g, ' ').trim();
const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export interface GuardianInput {
  name: string;
  phone: string;
  email?: string;
  relationship: 'father' | 'mother' | 'guardian' | 'other';
  isPrimary?: boolean;
  canViewFees?: boolean;
}

export interface StudentCreateInput {
  admissionNo: string;
  firstName: string;
  lastName?: string;
  dob: string;
  gender?: 'm' | 'f' | 'o' | 'undisclosed';
  contact?: { phone?: string; email?: string };
  address?: IStudent['address'];
  emergencyContacts?: IStudent['emergencyContacts'];
  admissionDate?: string;
  enrollment?: { sectionId: string; rollNo?: number };
  guardians?: GuardianInput[];
}

export const StudentsService = {
  // ------------------------------------------------------------------ visibility (scope)
  /** Student ids this caller may see, or null for "all". `own` scope belongs to the parent/student portals (R3). */
  async visibleStudentIds(scope: Scope | undefined): Promise<Types.ObjectId[] | null> {
    const tenant = requireTenant('students.visible');
    if (scope === 'school') return null;
    if (scope === 'assigned') {
      const access = await AcademicsService.sectionAccess(tenant, scope);
      if (access.all) return null;
      const session = await AcademicsService.requireActiveSession();
      const rows = access.sectionIds.length ? await enrollmentRepo.find({ sessionId: session._id, sectionId: { $in: access.sectionIds }, status: 'active' }, { select: 'studentId' }) : [];
      return rows.map((r) => r.studentId);
    }
    throw forbidden('This view is for staff. Parents and students use their portals.');
  },

  async list(scope: Scope | undefined, q: { page: number; limit: number; status?: StudentStatus; sectionId?: string; classId?: string; q?: string }) {
    const visible = await this.visibleStudentIds(scope);
    const filter: Record<string, unknown> = {};
    if (q.status) filter.status = q.status;
    let ids: Types.ObjectId[] | null = visible;

    if (q.sectionId || q.classId) {
      const session = await AcademicsService.requireActiveSession();
      const ef: Record<string, unknown> = { sessionId: session._id, status: 'active' };
      if (q.sectionId) ef.sectionId = toObjectId(q.sectionId) ?? new Types.ObjectId();
      if (q.classId) ef.classId = toObjectId(q.classId) ?? new Types.ObjectId();
      const rows = await enrollmentRepo.find(ef, { select: 'studentId' });
      const set = new Set(rows.map((r) => String(r.studentId)));
      ids = ids ? ids.filter((i) => set.has(String(i))) : rows.map((r) => r.studentId);
    }
    if (ids) filter._id = { $in: ids };

    const text = q.q?.trim().toLowerCase();
    if (text) {
      const rx = new RegExp(`^${escapeRegex(text.replace(/\s+/g, ' '))}`);
      filter.$or = [{ normalizedName: rx }, { admissionNo: new RegExp(`^${escapeRegex(q.q!.trim())}`, 'i') }, { 'contact.phone': new RegExp(`^${escapeRegex(q.q!.trim())}`) }];
    }
    const res = await studentRepo.paginate(filter, q.page, q.limit, { normalizedName: 1 });
    const enrolls = await enrollmentRepo.find({ _id: { $in: res.data.map((s) => s.currentEnrollmentId).filter(Boolean) as Types.ObjectId[] } });
    const byId = new Map(enrolls.map((e) => [String(e._id), e]));
    return { meta: res.meta, data: res.data.map((s) => toStudentDto(s, byId.get(String(s.currentEnrollmentId)))) };
  },

  async getVisible(scope: Scope | undefined, id: string) {
    const student = await studentRepo.getById(id, 'Student');
    const visible = await this.visibleStudentIds(scope);
    if (visible && !visible.some((v) => v.equals(student._id))) throw notFound('Student'); // not yours → indistinguishable from absent
    const enr = student.currentEnrollmentId ? await enrollmentRepo.findById(student.currentEnrollmentId) : null;
    return { student, enrollment: enr };
  },

  // ------------------------------------------------------------------ create
  async create(input: StudentCreateInput) {
    const tenant = requireTenant('students.create');
    if (!isValidDay(input.dob)) throw validationFailed('Invalid date of birth');
    const school = await getSchoolById(tenant.schoolId);
    const today = todayInTz(school.settings.timezone);
    if (input.dob >= today) throw validationFailed('Date of birth must be in the past');
    const admissionDate = input.admissionDate ?? today;
    if (!isValidDay(admissionDate)) throw validationFailed('Invalid admission date');
    if ((await studentRepo.count({ status: 'active' })) >= school.limits.students) throw entitlementRequired('Student limit for your plan has been reached');
    if (await studentRepo.exists({ admissionNo: input.admissionNo })) throw conflict('Admission number already exists');

    const result = await withTransaction(async () => {
      const student = await studentRepo.create({
        admissionNo: input.admissionNo, firstName: input.firstName, lastName: input.lastName,
        normalizedName: normalizeName(input.firstName, input.lastName), dob: input.dob, gender: input.gender,
        contact: input.contact, address: input.address, emergencyContacts: input.emergencyContacts ?? [],
        status: 'active', admissionDate,
      });
      let enrollment = null;
      if (input.enrollment) enrollment = await this.enrollInternal(student._id, input.enrollment.sectionId, input.enrollment.rollNo, admissionDate);
      for (const g of input.guardians ?? []) await this.addGuardianInternal(student._id, g);
      return { student: enrollment ? await studentRepo.getById(student._id) : student, enrollment };
    });
    await AuditService.record({ action: 'students.created', entityType: 'student', entityId: result.student._id, after: { admissionNo: input.admissionNo } });
    return result;
  },

  /** Creates the enrollment row in the ACTIVE session and updates the student pointer. */
  async enrollInternal(studentId: Types.ObjectId, sectionId: string, rollNo: number | undefined, joinedOn: string) {
    const session = await AcademicsService.requireActiveSession();
    const section = await sectionRepo.getById(sectionId, 'Section');
    if (!section.sessionId.equals(session._id)) throw validationFailed('Section does not belong to the active academic session');
    if (section.capacity && (await enrollmentRepo.count({ sectionId: section._id, status: 'active' })) >= section.capacity) throw conflict('This section is full');
    if (rollNo !== undefined && (await enrollmentRepo.exists({ sectionId: section._id, rollNo, status: 'active' }))) throw conflict('Roll number already used in this section');
    const existing = await enrollmentRepo.findOne({ studentId, sessionId: session._id });
    const enrollment = existing
      // explicit nulls: Mongoose drops `undefined` from $set, which would keep a stale roll number alive
      ? await enrollmentRepo.updateById(existing._id, { classId: section.classId, sectionId: section._id, rollNo: rollNo ?? null, status: 'active', joinedOn, leftOn: null })
      : await enrollmentRepo.create({ studentId, sessionId: session._id, classId: section.classId, sectionId: section._id, rollNo, status: 'active', joinedOn });
    await studentRepo.updateById(studentId, { currentEnrollmentId: enrollment._id });
    return enrollment;
  },

  async update(id: string, patch: Partial<Pick<IStudent, 'firstName' | 'lastName' | 'dob' | 'gender' | 'contact' | 'address' | 'emergencyContacts'>>, expectedVersion?: number) {
    const s = await studentRepo.getById(id, 'Student');
    const set: Record<string, unknown> = { ...patch };
    if (patch.dob !== undefined && !isValidDay(patch.dob)) throw validationFailed('Invalid date of birth');
    if (patch.firstName !== undefined || patch.lastName !== undefined) {
      set.normalizedName = normalizeName(patch.firstName ?? s.firstName, patch.lastName ?? s.lastName);
    }
    const updated = await studentRepo.updateById(id, set, { expectedVersion, what: 'Student' });
    await AuditService.record({ action: 'students.updated', entityType: 'student', entityId: id, before: { firstName: s.firstName, lastName: s.lastName, dob: s.dob }, after: patch });
    return updated;
  },

  // ------------------------------------------------------------------ lifecycle
  async changeStatus(id: string, input: { status: 'transferred' | 'withdrawn' | 'graduated' | 'active'; effectiveOn?: string; reason?: string; sectionId?: string }) {
    const tenant = requireTenant('students.status');
    const s = await studentRepo.getById(id, 'Student');
    const school = await getSchoolById(tenant.schoolId);
    const on = input.effectiveOn ?? todayInTz(school.settings.timezone);
    if (!isValidDay(on)) throw validationFailed('Invalid date');
    if (input.status === 'active') {
      if (s.status === 'active') throw conflict('Student is already active');
      if (!input.sectionId) throw validationFailed('Choose a section to re-admit the student into');
      await withTransaction(async () => {
        await this.enrollInternal(s._id, input.sectionId!, undefined, on);
        await studentRepo.updateById(id, { status: 'active', statusReason: input.reason, statusChangedOn: on });
      });
    } else {
      if (s.status !== 'active') throw conflict('Only active students can be transferred, withdrawn or graduated');
      await withTransaction(async () => {
        const session = await AcademicsService.requireActiveSession();
        const enr = await enrollmentRepo.findOne({ studentId: s._id, sessionId: session._id, status: 'active' });
        if (enr) await enrollmentRepo.updateById(enr._id, { status: input.status as 'transferred' | 'withdrawn' | 'graduated', leftOn: on });
        await studentRepo.updateById(id, { status: input.status, statusReason: input.reason, statusChangedOn: on });
      });
    }
    await AuditService.record({ action: 'students.status_changed', entityType: 'student', entityId: id, before: { status: s.status }, after: { status: input.status, on, reason: input.reason } });
    return studentRepo.getById(id);
  },

  // ------------------------------------------------------------------ guardians
  async addGuardianInternal(studentId: Types.ObjectId, g: GuardianInput & { existingGuardianId?: string }) {
    let guardianId: Types.ObjectId;
    if (g.existingGuardianId) guardianId = (await guardianRepo.getById(g.existingGuardianId, 'Guardian'))._id; // sibling reuse — same-school only
    else guardianId = (await guardianRepo.create({ name: g.name, phone: g.phone, email: g.email })) ._id;
    if (await studentGuardianRepo.exists({ studentId, guardianId })) throw conflict('Guardian is already linked to this student');
    if (g.isPrimary) {
      const prim = await studentGuardianRepo.find({ studentId, isPrimary: true });
      for (const p of prim) await studentGuardianRepo.updateById(p._id, { isPrimary: false });
    }
    return studentGuardianRepo.create({
      studentId, guardianId, relationship: g.relationship, isPrimary: Boolean(g.isPrimary),
      canViewFees: g.canViewFees ?? true, canPickup: true, portalAccess: false, verifiedAt: null,
    });
  },

  async addGuardian(studentId: string, g: GuardianInput & { existingGuardianId?: string }) {
    const s = await studentRepo.getById(studentId, 'Student');
    const link = await withTransaction(() => this.addGuardianInternal(s._id, g));
    await AuditService.record({ action: 'students.guardian_linked', entityType: 'student', entityId: studentId, after: { relationship: g.relationship, linkId: String(link._id) } });
    return link;
  },

  async listGuardians(studentId: string) {
    const s = await studentRepo.getById(studentId, 'Student');
    const links = await studentGuardianRepo.find({ studentId: s._id });
    const guardians = await guardianRepo.findByIds(links.map((l) => l.guardianId));
    const by = new Map(guardians.map((g) => [String(g._id), g]));
    return links.map((l) => {
      const g = by.get(String(l.guardianId));
      return {
        linkId: String(l._id), guardianId: String(l.guardianId), name: g?.name, phone: g?.phone, email: g?.email,
        relationship: l.relationship, isPrimary: l.isPrimary, canViewFees: l.canViewFees, canPickup: l.canPickup,
        portalAccess: l.portalAccess, verified: Boolean(l.verifiedAt), ended: Boolean(l.endedAt), version: l.__v,
      };
    });
  },

  async updateLink(studentId: string, linkId: string, patch: { relationship?: GuardianInput['relationship']; isPrimary?: boolean; canViewFees?: boolean; canPickup?: boolean; portalAccess?: boolean; verified?: boolean; ended?: boolean }) {
    const tenant = requireTenant('students.updateLink');
    const s = await studentRepo.getById(studentId, 'Student');
    const link = await studentGuardianRepo.getById(linkId, 'Guardian link');
    if (!link.studentId.equals(s._id)) throw notFound('Guardian link');
    const set: Record<string, unknown> = {};
    for (const k of ['relationship', 'isPrimary', 'canViewFees', 'canPickup', 'portalAccess'] as const) if (patch[k] !== undefined) set[k] = patch[k];
    if (patch.verified === true) { set.verifiedAt = new Date(); set.verifiedBy = tenant.membershipId; }
    if (patch.verified === false) { set.verifiedAt = null; set.verifiedBy = null; set.portalAccess = false; }
    if (patch.ended === true) { set.endedAt = new Date(); set.portalAccess = false; }
    if (patch.ended === false) set.endedAt = null;
    if (set.portalAccess === true && !(link.verifiedAt || set.verifiedAt)) throw validationFailed('A guardian must be verified before portal access can be enabled');
    const updated = await studentGuardianRepo.updateById(linkId, set, { what: 'Guardian link' });
    await AuditService.record({ action: 'students.guardian_link_updated', entityType: 'student_guardian', entityId: linkId, before: { portalAccess: link.portalAccess, verified: Boolean(link.verifiedAt), ended: Boolean(link.endedAt) }, after: set });
    return updated;
  },

  // ------------------------------------------------------------------ roster
  async roster(sectionId: string, scope: Scope | undefined) {
    const section = await AcademicsService.assertSectionAccess(scope, sectionId);
    const enr = await enrollmentRepo.find({ sectionId: section._id, sessionId: section.sessionId, status: 'active' }, { sort: { rollNo: 1 } });
    const students = await studentRepo.findByIds(enr.map((e) => e.studentId));
    const by = new Map(students.map((s) => [String(s._id), s]));
    const cls = await classRepo.findById(section.classId);
    return {
      section: { id: String(section._id), name: section.name, classId: String(section.classId), className: cls?.name },
      students: enr
        .map((e) => ({ studentId: String(e.studentId), enrollmentId: String(e._id), rollNo: e.rollNo, joinedOn: e.joinedOn, name: [by.get(String(e.studentId))?.firstName, by.get(String(e.studentId))?.lastName].filter(Boolean).join(' '), admissionNo: by.get(String(e.studentId))?.admissionNo }))
        .sort((a, b) => (a.rollNo ?? 9999) - (b.rollNo ?? 9999) || a.name.localeCompare(b.name)),
    };
  },
};

export function toStudentDto(s: Awaited<ReturnType<typeof studentRepo.getById>>, e?: Awaited<ReturnType<typeof enrollmentRepo.getById>> | null) {
  return {
    id: String(s._id), admissionNo: s.admissionNo, firstName: s.firstName, lastName: s.lastName, dob: s.dob, gender: s.gender,
    contact: s.contact, address: s.address, emergencyContacts: s.emergencyContacts, status: s.status, admissionDate: s.admissionDate,
    statusReason: s.statusReason, statusChangedOn: s.statusChangedOn, version: s.__v,
    enrollment: e ? { id: String(e._id), sessionId: String(e.sessionId), classId: String(e.classId), sectionId: String(e.sectionId), rollNo: e.rollNo, status: e.status } : null,
  };
}
