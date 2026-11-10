import type { Types } from 'mongoose';
import type { Scope } from '@edunex/shared';
import type { Env } from '../../config/env';
import { conflict, forbidden, notFound, validationFailed } from '../../core/errors';
import { AuditService } from '../../core/audit/audit.service';
import { requireTenant } from '../../core/tenancy/context';
import { toObjectId } from '../../core/tenancy/repository';
import { newStorageKey, type FileStorage } from '../../core/storage/file-storage';
import { checkUpload } from '../../core/storage/file-policy';
import { AcademicsService } from '../academics/academics.service';
import { sectionRepo, sessionRepo, subjectRepo } from '../academics/academics.repository';
import { enrollmentRepo, studentRepo } from '../students/students.repository';
import { isGuardian, isStudentUser, linkedChildren, currentStudent, assertChild } from '../parent/parent-access';
import { assignmentRepo, storedFileRepo, submissionRepo } from './homework.repository';
import type { IAssignment, IStoredFile, ISubmission } from './homework.model';

type Lean<T> = T & { _id: Types.ObjectId };
const MAX_FILES = 5;
const MAX_UNATTACHED = 20;
const dup = (e: unknown) => (e as { code?: number })?.code === 11000;

export interface AssignmentInput { sectionId: string; subjectId: string; title: string; description: string; instructions?: string; dueAt: Date; maxMarks?: number | null; allowLate?: boolean; fileIds?: string[] }

export class HomeworkService {
  constructor(private readonly deps: { env: Env; storage: FileStorage }) {}

  // ------------------------------------------------------------------------------------------------ files
  async upload(purpose: 'assignment' | 'submission', filename: string, contentBase64: string) {
    const t = requireTenant('homework.upload');
    const max = this.deps.env.UPLOAD_MAX_BYTES;
    if (!/^[A-Za-z0-9+/]*={0,2}$/.test(contentBase64)) throw validationFailed('The file content is not valid base64');
    if (Math.floor((contentBase64.length * 3) / 4) > max + 3) throw validationFailed(`The file is too large (limit ${Math.floor(max / (1024 * 1024))} MB)`);
    const data = Buffer.from(contentBase64, 'base64');
    const info = checkUpload(filename, data, max);
    const pending = await storedFileRepo.count({ uploadedByMembershipId: t.membershipId, assignmentId: null, submissionId: null });
    if (pending >= MAX_UNATTACHED) throw conflict('You have too many unattached files. Attach or remove them first.');
    const key = newStorageKey(String(t.schoolId));
    await this.deps.storage.put(key, data);
    const f = await storedFileRepo.create({ purpose, storageKey: key, name: info.name, ext: info.ext, mime: info.mime, size: info.size, sha256: info.sha256, uploadedByMembershipId: t.membershipId });
    await AuditService.record({ action: 'homework.file_uploaded', entityType: 'file', entityId: f._id, after: { purpose, size: info.size, ext: info.ext } });
    return fileDto(f);
  }

  /** Files that may be linked now: uploaded by THIS member, of the right purpose, and not yet linked elsewhere. */
  private async claimable(ids: string[] | undefined, purpose: 'assignment' | 'submission', linkedTo?: Types.ObjectId): Promise<Array<Lean<IStoredFile>>> {
    const t = requireTenant('homework.claim');
    const uniq = [...new Set(ids ?? [])];
    if (uniq.length > MAX_FILES) throw validationFailed(`At most ${MAX_FILES} files can be attached`);
    if (!uniq.length) return [];
    const rows = await storedFileRepo.findByIds(uniq);
    if (rows.length !== uniq.length) throw notFound('File');
    for (const f of rows) {
      const attachedElsewhere = (f.assignmentId || f.submissionId) && !(linkedTo && (f.submissionId?.equals(linkedTo) || f.assignmentId?.equals(linkedTo)));
      if (f.purpose !== purpose || !f.uploadedByMembershipId.equals(t.membershipId) || attachedElsewhere) throw notFound('File');
    }
    return rows as Array<Lean<IStoredFile>>;
  }

  async download(fileId: string, scope: Scope | undefined) {
    const f = await storedFileRepo.getById(fileId, 'File');
    if (!(await this.canReadFile(f, scope))) throw notFound('File'); // 404, not 403: do not reveal that it exists
    const bytes = await this.deps.storage.get(f.storageKey);
    await AuditService.record({ action: 'homework.file_downloaded', entityType: 'file', entityId: f._id });
    return { file: f, bytes };
  }

  private async canReadFile(f: Lean<IStoredFile>, scope: Scope | undefined): Promise<boolean> {
    const t = requireTenant('homework.canReadFile');
    if (f.uploadedByMembershipId.equals(t.membershipId)) return true;
    let sectionId: Types.ObjectId | null = null;
    let studentId: Types.ObjectId | null = null;
    if (f.assignmentId) sectionId = (await assignmentRepo.findById(f.assignmentId))?.sectionId ?? null;
    else if (f.submissionId) {
      const s = await submissionRepo.findById(f.submissionId);
      sectionId = s?.sectionId ?? null;
      studentId = s?.studentId ?? null;
    }
    if (!sectionId) return false; // unattached files are visible to their uploader only
    if (isStudentUser()) {
      const me = await currentStudent();
      if (studentId) return me._id.equals(studentId); // my own submission files — never a classmate's
      return Boolean(await this.ownSection(me._id, sectionId));
    }
    if (isGuardian()) {
      const kids = await linkedChildren();
      if (studentId) return kids.some((k) => k.studentId.equals(studentId!));
      const enr = await enrollmentRepo.find({ studentId: { $in: kids.map((k) => k.studentId) }, sectionId, status: 'active' }, { select: 'studentId' });
      return enr.length > 0;
    }
    try { await AcademicsService.assertSectionAccess(scope, sectionId); return true; } catch { return false; }
  }

  // ------------------------------------------------------------------------------------------------ assignments (staff)
  async create(scope: Scope | undefined, input: AssignmentInput, byName: string) {
    const t = requireTenant('homework.create');
    const section = await AcademicsService.assertSectionAccess(scope, input.sectionId);
    const subject = await subjectRepo.getById(input.subjectId, 'Subject');
    if (input.dueAt.getTime() < Date.now() - 60_000) throw validationFailed('The due date must be in the future');
    if (input.maxMarks != null && input.maxMarks < 0) throw validationFailed('Marks cannot be negative');
    const files = await this.claimable(input.fileIds, 'assignment');
    const a = await assignmentRepo.create({
      sessionId: section.sessionId, sectionId: section._id, subjectId: subject._id, staffId: t.personType === 'staff' ? (t.personId ?? null) : null,
      title: input.title, description: input.description, instructions: input.instructions, dueAt: input.dueAt, maxMarks: input.maxMarks ?? null,
      allowLate: input.allowLate ?? true, status: 'published', createdByName: byName, publishedAt: new Date(),
    });
    for (const f of files) await storedFileRepo.updateById(f._id, { assignmentId: a._id });
    await AuditService.record({ action: 'homework.assignment_created', entityType: 'assignment', entityId: a._id, after: { sectionId: String(section._id), subjectId: String(subject._id), title: a.title, dueAt: a.dueAt, files: files.length } });
    return a;
  }

  async listForStaff(scope: Scope | undefined, q: { sectionId?: string; status?: 'published' | 'withdrawn'; page: number; limit: number }) {
    const t = requireTenant('homework.list');
    const access = await AcademicsService.sectionAccess(t, scope);
    const filter: Record<string, unknown> = {};
    if (q.status) filter.status = q.status;
    if (q.sectionId) {
      await AcademicsService.assertSectionAccess(scope, q.sectionId);
      filter.sectionId = q.sectionId;
    } else if (!access.all) filter.sectionId = { $in: access.sectionIds };
    const res = await assignmentRepo.paginate(filter, q.page, q.limit, { dueAt: -1 });
    return { data: await this.hydrate(res.data as Array<Lean<IAssignment>>, true), meta: res.meta };
  }

  async getForStaff(scope: Scope | undefined, id: string) {
    const a = await assignmentRepo.getById(id, 'Assignment');
    await AcademicsService.assertSectionAccess(scope, a.sectionId);
    const [dto] = await this.hydrate([a as Lean<IAssignment>], true);
    return dto!;
  }

  async withdraw(scope: Scope | undefined, id: string) {
    const t = requireTenant('homework.withdraw');
    const a = await assignmentRepo.getById(id, 'Assignment');
    await AcademicsService.assertSectionAccess(scope, a.sectionId);
    if (scope !== 'school' && !(a.staffId && t.personId && a.staffId.equals(t.personId))) throw forbidden('Only the teacher who set this homework or an administrator can withdraw it');
    if (a.status === 'withdrawn') return a;
    const u = await assignmentRepo.updateById(a._id, { status: 'withdrawn', withdrawnAt: new Date() });
    await AuditService.record({ action: 'homework.assignment_withdrawn', entityType: 'assignment', entityId: a._id });
    return u;
  }

  /** Every student of the class with their submission state — the teacher's marking sheet. */
  async submissionsOf(scope: Scope | undefined, assignmentId: string) {
    const a = await assignmentRepo.getById(assignmentId, 'Assignment');
    await AcademicsService.assertSectionAccess(scope, a.sectionId);
    const enr = await enrollmentRepo.find({ sectionId: a.sectionId, sessionId: a.sessionId, status: 'active' }, { select: 'studentId rollNo', sort: { rollNo: 1 }, limit: 600 });
    const [students, subs] = await Promise.all([
      studentRepo.findByIds(enr.map((e) => e.studentId)),
      submissionRepo.find({ assignmentId: a._id }, { limit: 600 }),
    ]);
    const sBy = new Map(students.map((s) => [String(s._id), s]));
    const subBy = new Map(subs.map((s) => [String(s.studentId), s]));
    const files = await storedFileRepo.find({ submissionId: { $in: subs.map((s) => s._id) } }, { limit: 3000 });
    const filesBy = new Map<string, Array<ReturnType<typeof fileDto>>>();
    for (const f of files) filesBy.set(String(f.submissionId), [...(filesBy.get(String(f.submissionId)) ?? []), fileDto(f as Lean<IStoredFile>)]);
    const rows = enr.map((e) => {
      const s = sBy.get(String(e.studentId));
      const sub = subBy.get(String(e.studentId));
      return {
        studentId: String(e.studentId), name: s ? [s.firstName, s.lastName].filter(Boolean).join(' ') : '', admissionNo: s?.admissionNo ?? '', rollNo: e.rollNo ?? null,
        state: sub ? (sub.status === 'reviewed' ? 'reviewed' : sub.late ? 'late' : 'submitted') : 'missing',
        submission: sub ? { ...submissionDto(sub as Lean<ISubmission>), files: filesBy.get(String(sub._id)) ?? [] } : null,
      };
    });
    const count = (st: string) => rows.filter((r) => r.state === st).length;
    return { assignment: (await this.hydrate([a as Lean<IAssignment>], true))[0], students: rows, summary: { total: rows.length, submitted: rows.length - count('missing'), late: count('late'), reviewed: count('reviewed'), missing: count('missing') } };
  }

  async review(scope: Scope | undefined, assignmentId: string, studentId: string, input: { marks?: number | null; feedback?: string | null }) {
    const t = requireTenant('homework.review');
    const a = await assignmentRepo.getById(assignmentId, 'Assignment');
    await AcademicsService.assertSectionAccess(scope, a.sectionId);
    const sid = toObjectId(studentId);
    const sub = sid ? await submissionRepo.findOne({ assignmentId: a._id, studentId: sid }) : null;
    if (!sub) throw notFound('Submission');
    if (input.marks != null) {
      if (a.maxMarks == null) throw validationFailed('This homework has no marks; give feedback only');
      if (input.marks < 0 || input.marks > a.maxMarks) throw validationFailed(`Marks must be between 0 and ${a.maxMarks}`);
    }
    if (input.marks == null && !input.feedback?.trim()) throw validationFailed('Give marks or feedback');
    const u = await submissionRepo.updateById(sub._id, { marks: input.marks ?? null, feedback: input.feedback?.trim() || null, status: 'reviewed', reviewedAt: new Date(), reviewedByName: t.userId ? await reviewerName() : null });
    await AuditService.record({ action: 'homework.submission_reviewed', entityType: 'submission', entityId: sub._id, after: { assignmentId: String(a._id), studentId: String(sub.studentId), marks: input.marks ?? null, hasFeedback: Boolean(input.feedback?.trim()) } });
    return u;
  }

  // ------------------------------------------------------------------------------------------------ students
  private async ownSection(studentId: Types.ObjectId, sectionId?: Types.ObjectId): Promise<Types.ObjectId | null> {
    const session = await sessionRepo.findActive();
    if (!session) return null;
    const enr = await enrollmentRepo.findOne({ studentId, sessionId: session._id, status: 'active' });
    if (!enr) return null;
    if (sectionId && !enr.sectionId.equals(sectionId)) return null;
    return enr.sectionId;
  }

  /** Assignments of one student's class with THAT student's submission state (read-only helper for student + parent views). */
  private async forStudent(studentId: Types.ObjectId) {
    const sectionId = await this.ownSection(studentId);
    if (!sectionId) return [];
    const items = await assignmentRepo.find({ sectionId, status: 'published' }, { sort: { dueAt: -1 }, limit: 200 });
    const subs = await submissionRepo.find({ studentId, assignmentId: { $in: items.map((i) => i._id) } }, { limit: 300 });
    const subBy = new Map(subs.map((s) => [String(s.assignmentId), s]));
    const dtos = await this.hydrate(items as Array<Lean<IAssignment>>, false);
    return dtos.map((d, i) => {
      const sub = subBy.get(String(items[i]!._id));
      return { ...d, mine: sub ? submissionDto(sub as Lean<ISubmission>) : null, state: sub ? (sub.status === 'reviewed' ? 'reviewed' : sub.late ? 'late' : 'submitted') : new Date(items[i]!.dueAt) < new Date() ? 'overdue' : 'pending' };
    });
  }

  async listMine() { return this.forStudent((await currentStudent())._id); }

  async listForChild(childId: string) {
    const link = await assertChild(childId);
    return this.forStudent(link.studentId);
  }

  async getMine(assignmentId: string) {
    const me = await currentStudent();
    const a = await assignmentRepo.findById(assignmentId);
    if (!a || a.status !== 'published' || !(await this.ownSection(me._id, a.sectionId))) throw notFound('Assignment');
    const [dto] = await this.hydrate([a as Lean<IAssignment>], false);
    const sub = await submissionRepo.findOne({ assignmentId: a._id, studentId: me._id });
    const files = sub ? (await storedFileRepo.find({ submissionId: sub._id })).map((f) => fileDto(f as Lean<IStoredFile>)) : [];
    return { ...dto!, mine: sub ? { ...submissionDto(sub as Lean<ISubmission>), files } : null };
  }

  async submit(assignmentId: string, input: { text?: string; fileIds?: string[] }) {
    const me = await currentStudent();
    const a = await assignmentRepo.findById(assignmentId);
    if (!a || a.status !== 'published' || !(await this.ownSection(me._id, a.sectionId))) throw notFound('Assignment');
    const now = new Date();
    const late = now > a.dueAt;
    if (late && !a.allowLate) throw conflict('The due date has passed and this homework does not accept late submissions');
    const text = input.text?.trim() || undefined;
    if (!text && !(input.fileIds?.length)) throw validationFailed('Write an answer or attach a file');

    for (let attempt = 0; attempt < 2; attempt++) {
      const existing = await submissionRepo.findOne({ assignmentId: a._id, studentId: me._id });
      if (existing) {
        if (existing.status === 'reviewed') throw conflict('This homework has already been reviewed, so it can no longer be changed');
        const files = await this.claimable(input.fileIds, 'submission', existing._id);
        const old = await storedFileRepo.find({ submissionId: existing._id });
        const keep = new Set(files.map((f) => String(f._id)));
        const u = await submissionRepo.updateById(existing._id, { text, submittedAt: now, late, attempts: (existing.attempts ?? 1) + 1 });
        for (const f of files) await storedFileRepo.updateById(f._id, { submissionId: existing._id });
        for (const f of old.filter((x) => !keep.has(String(x._id)))) { await this.deps.storage.remove(f.storageKey); await storedFileRepo.hardDeleteById(f._id); }
        await AuditService.record({ action: 'homework.submission_resubmitted', entityType: 'submission', entityId: existing._id, after: { assignmentId: String(a._id), late, attempts: u.attempts } });
        return u;
      }
      const files = await this.claimable(input.fileIds, 'submission');
      try {
        const s = await submissionRepo.create({ assignmentId: a._id, studentId: me._id, sectionId: a.sectionId, text, submittedAt: now, late, attempts: 1, status: 'submitted' });
        for (const f of files) await storedFileRepo.updateById(f._id, { submissionId: s._id });
        await AuditService.record({ action: 'homework.submitted', entityType: 'submission', entityId: s._id, after: { assignmentId: String(a._id), late, files: files.length } });
        return s;
      } catch (e) { if (!dup(e)) throw e; /* a concurrent submit won: loop and treat this one as a resubmission */ }
    }
    throw conflict('Please try again');
  }

  // ------------------------------------------------------------------------------------------------ dto
  private async hydrate(items: Array<Lean<IAssignment>>, forStaff: boolean) {
    const [subjects, sections, files] = await Promise.all([
      subjectRepo.findByIds([...new Set(items.map((i) => String(i.subjectId)))]),
      sectionRepo.findByIds([...new Set(items.map((i) => String(i.sectionId)))]),
      storedFileRepo.find({ assignmentId: { $in: items.map((i) => i._id) } }, { limit: 1000 }),
    ]);
    const sub = new Map(subjects.map((s) => [String(s._id), s.name]));
    const sec = new Map(sections.map((s) => [String(s._id), s.name]));
    const filesBy = new Map<string, Array<ReturnType<typeof fileDto>>>();
    for (const f of files) filesBy.set(String(f.assignmentId), [...(filesBy.get(String(f.assignmentId)) ?? []), fileDto(f as Lean<IStoredFile>)]);
    return items.map((a) => ({
      id: String(a._id), sectionId: String(a.sectionId), sectionName: sec.get(String(a.sectionId)) ?? '', subjectId: String(a.subjectId), subject: sub.get(String(a.subjectId)) ?? '',
      title: a.title, description: a.description, instructions: a.instructions ?? null, dueAt: a.dueAt, maxMarks: a.maxMarks ?? null, allowLate: a.allowLate, status: a.status,
      createdByName: a.createdByName, publishedAt: a.publishedAt, files: filesBy.get(String(a._id)) ?? [], ...(forStaff ? { staffId: a.staffId ? String(a.staffId) : null } : {}),
    }));
  }
}

async function reviewerName(): Promise<string | null> {
  const { users } = await import('../auth/auth.repository');
  const t = requireTenant('homework.reviewer');
  const u = (await users.findById(t.userId, 'homework: reviewer name')) as { name?: string } | null;
  return u?.name ?? null;
}

export function fileDto(f: Lean<IStoredFile>) {
  return { id: String(f._id), name: f.name, size: f.size, mime: f.mime };
}
export function submissionDto(s: Lean<ISubmission>) {
  return { id: String(s._id), text: s.text ?? null, submittedAt: s.submittedAt, late: s.late, attempts: s.attempts, status: s.status, marks: s.marks ?? null, feedback: s.feedback ?? null, reviewedAt: s.reviewedAt ?? null, reviewedByName: s.reviewedByName ?? null };
}
