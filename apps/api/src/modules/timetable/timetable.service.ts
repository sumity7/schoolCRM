import type { Types } from 'mongoose';
import { conflict, forbidden, notFound, validationFailed } from '../../core/errors';
import { AuditService } from '../../core/audit/audit.service';
import { requireTenant } from '../../core/tenancy/context';
import { classRepo, sectionRepo, sessionRepo, subjectRepo } from '../academics/academics.repository';
import { staffRepo } from '../staff/staff.repository';
import { enrollmentRepo } from '../students/students.repository';
import { timetableSlotRepo, timetableVersionRepo } from './timetable.repository';
import type { ITimetablePeriod, ITimetableSlot, ITimetableVersion } from './timetable.model';

type Lean<T> = T & { _id: Types.ObjectId };
const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
export const DAY_NAMES = ['', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'] as const;

export interface PeriodInput { no: number; label: string; start: string; end: string; kind: 'lesson' | 'break' }

/** Period grid rules: numbered 1..N in order, valid HH:MM, each starts after the previous ends, at least one lesson. */
export function validatePeriods(periods: PeriodInput[]): void {
  if (periods.length === 0) throw validationFailed('Add at least one period');
  let prevEnd = '';
  periods.forEach((p, i) => {
    if (p.no !== i + 1) throw validationFailed('Periods must be numbered 1, 2, 3 … in order');
    if (!HHMM.test(p.start) || !HHMM.test(p.end)) throw validationFailed(`Period ${p.no}: use 24-hour HH:MM times`);
    if (p.end <= p.start) throw validationFailed(`Period ${p.no}: it must end after it starts`);
    if (prevEnd && p.start < prevEnd) throw validationFailed(`Period ${p.no} starts before period ${p.no - 1} ends`);
    prevEnd = p.end;
  });
  if (!periods.some((p) => p.kind === 'lesson')) throw validationFailed('At least one period must be a lesson');
}
function validateDays(days: number[]): number[] {
  const u = [...new Set(days)].sort((a, b) => a - b);
  if (u.length === 0 || u.some((d) => !Number.isInteger(d) || d < 1 || d > 7)) throw validationFailed('Working days must be 1 (Monday) to 7 (Sunday)');
  return u;
}

const dupKey = (e: unknown) => (e as { code?: number })?.code === 11000;
const keyName = (e: unknown) => String((e as { message?: string })?.message ?? '');

export const TimetableService = {
  // ----------------------------------------------------------------------------------------------- versions
  async createVersion(input: { sessionId?: string; name: string; workingDays: number[]; periods: PeriodInput[] }, byName: string) {
    requireTenant('timetable.createVersion');
    const session = input.sessionId ? await sessionRepo.getById(input.sessionId, 'Academic session') : await sessionRepo.findActive();
    if (!session) throw validationFailed('There is no active academic session. Create or activate one first.');
    validatePeriods(input.periods);
    const workingDays = validateDays(input.workingDays);
    for (let attempt = 0; attempt < 3; attempt++) {
      const last = await timetableVersionRepo.find({ sessionId: session._id }, { sort: { versionNo: -1 }, limit: 1 });
      try {
        const v = await timetableVersionRepo.create({ sessionId: session._id, versionNo: (last[0]?.versionNo ?? 0) + 1, name: input.name, status: 'draft', workingDays, periods: input.periods, createdByName: byName });
        await AuditService.record({ action: 'timetable.version_created', entityType: 'timetable_version', entityId: v._id, after: { versionNo: v.versionNo, name: v.name } });
        return v;
      } catch (e) { if (!dupKey(e)) throw e; }
    }
    throw conflict('Could not allocate a version number; please retry');
  },

  async listVersions(sessionId?: string) {
    const rows = await timetableVersionRepo.find(sessionId ? { sessionId } : {}, { sort: { sessionId: 1, versionNo: -1 }, limit: 200 });
    const counts = new Map<string, number>();
    for (const v of rows) counts.set(String(v._id), await timetableSlotRepo.count({ versionId: v._id }));
    return rows.map((v) => ({ ...versionDto(v), lessonCount: counts.get(String(v._id)) ?? 0 }));
  },

  async getVersion(id: string) {
    const v = await timetableVersionRepo.getById(id, 'Timetable version');
    return { ...versionDto(v), lessonCount: await timetableSlotRepo.count({ versionId: v._id }) };
  },

  async updateVersion(id: string, patch: { name?: string; workingDays?: number[]; periods?: PeriodInput[] }) {
    const v = await timetableVersionRepo.getById(id, 'Timetable version');
    if (v.status !== 'draft') throw conflict('Only a draft timetable can be edited. Create a new draft from it instead.');
    const set: Record<string, unknown> = {};
    if (patch.name !== undefined) set.name = patch.name;
    if (patch.periods) {
      validatePeriods(patch.periods);
      const lessons = new Set(patch.periods.filter((p) => p.kind === 'lesson').map((p) => p.no));
      const used = await timetableSlotRepo.find({ versionId: v._id }, { select: 'periodNo' });
      if (used.some((s) => !lessons.has(s.periodNo))) throw conflict('Some lessons are placed in periods you are removing or turning into breaks. Remove those lessons first.');
      set.periods = patch.periods;
    }
    if (patch.workingDays) {
      const days = validateDays(patch.workingDays);
      const usedDays = await timetableSlotRepo.find({ versionId: v._id }, { select: 'day' });
      if (usedDays.some((s) => !days.includes(s.day))) throw conflict('Some lessons are placed on days you are removing. Remove those lessons first.');
      set.workingDays = days;
    }
    const updated = await timetableVersionRepo.updateById(v._id, set, { what: 'Timetable version' });
    await AuditService.record({ action: 'timetable.version_updated', entityType: 'timetable_version', entityId: v._id, after: { fields: Object.keys(set) } });
    return updated;
  },

  async clone(id: string, byName: string, name?: string) {
    const src = await timetableVersionRepo.getById(id, 'Timetable version');
    const last = await timetableVersionRepo.find({ sessionId: src.sessionId }, { sort: { versionNo: -1 }, limit: 1 });
    const copy = await timetableVersionRepo.create({
      sessionId: src.sessionId, versionNo: (last[0]?.versionNo ?? 0) + 1, name: name ?? `${src.name} (copy)`.slice(0, 80), status: 'draft',
      workingDays: src.workingDays, periods: src.periods, basedOnVersionId: src._id, createdByName: byName,
    });
    const slots = await timetableSlotRepo.find({ versionId: src._id }, { limit: 5000 });
    if (slots.length) await timetableSlotRepo.createMany(slots.map((s) => ({ versionId: copy._id, sessionId: s.sessionId, sectionId: s.sectionId, day: s.day, periodNo: s.periodNo, subjectId: s.subjectId, staffId: s.staffId, room: s.room ?? null })));
    await AuditService.record({ action: 'timetable.version_cloned', entityType: 'timetable_version', entityId: copy._id, after: { from: String(src._id), lessons: slots.length } });
    return copy;
  },

  async publish(id: string, byName: string) {
    const v = await timetableVersionRepo.getById(id, 'Timetable version');
    if (v.status !== 'draft') throw conflict('Only a draft timetable can be published');
    const lessons = await timetableSlotRepo.count({ versionId: v._id });
    if (lessons === 0) throw validationFailed('Add at least one lesson before publishing');
    const current = await timetableVersionRepo.findOne({ sessionId: v.sessionId, status: 'published' });
    const now = new Date();
    if (current) await timetableVersionRepo.updateById(current._id, { status: 'archived', archivedAt: now });
    try {
      const pub = await timetableVersionRepo.updateById(v._id, { status: 'published', publishedAt: now, publishedByName: byName });
      await AuditService.record({
        action: 'timetable.published', entityType: 'timetable_version', entityId: v._id,
        before: { replaced: current ? { id: String(current._id), versionNo: current.versionNo } : null }, after: { versionNo: v.versionNo, lessons },
      });
      return pub;
    } catch (e) {
      if (current) await timetableVersionRepo.updateById(current._id, { status: 'published', archivedAt: null }); // never leave the school without a timetable
      throw dupKey(e) ? conflict('Another timetable was published at the same time. Reload and try again.') : e;
    }
  },

  // ----------------------------------------------------------------------------------------------- lessons
  async setSlot(versionId: string, input: { sectionId: string; day: number; periodNo: number; subjectId: string; staffId: string; room?: string | null }) {
    const v = await timetableVersionRepo.getById(versionId, 'Timetable version');
    if (v.status !== 'draft') throw conflict('Published and archived timetables are read-only. Create a new draft from it to make changes.');
    if (!v.workingDays.includes(input.day)) throw validationFailed(`${DAY_NAMES[input.day] ?? 'That day'} is not a working day in this timetable`);
    const period = v.periods.find((p) => p.no === input.periodNo);
    if (!period || period.kind !== 'lesson') throw validationFailed('Lessons can only be placed in lesson periods (not breaks)');
    const section = await sectionRepo.getById(input.sectionId, 'Section');
    if (!section.sessionId.equals(v.sessionId)) throw validationFailed('That section belongs to a different academic session');
    const subject = await subjectRepo.getById(input.subjectId, 'Subject');
    const teacher = await staffRepo.getById(input.staffId, 'Teacher');
    if (teacher.status !== 'active') throw validationFailed(`${teacher.name} is not an active staff member`);
    const room = input.room?.trim() ? input.room.trim().toUpperCase() : null;

    // friendly pre-checks (the unique indexes below are the actual guarantee under concurrency)
    const base = { versionId: v._id, day: input.day, periodNo: input.periodNo };
    const where = `on ${DAY_NAMES[input.day]}, period ${input.periodNo}`;
    const teacherClash = await timetableSlotRepo.findOne({ ...base, staffId: teacher._id, sectionId: { $ne: section._id } });
    if (teacherClash) throw conflict(`${teacher.name} is already teaching ${await sectionLabel(teacherClash.sectionId)} ${where}`);
    if (room) {
      const roomClash = await timetableSlotRepo.findOne({ ...base, room, sectionId: { $ne: section._id } });
      if (roomClash) throw conflict(`Room ${room} is already used by ${await sectionLabel(roomClash.sectionId)} ${where}`);
    }
    const existing = await timetableSlotRepo.findOne({ ...base, sectionId: section._id });
    const data = { subjectId: subject._id, staffId: teacher._id, room };
    try {
      const slot = existing ? await timetableSlotRepo.updateById(existing._id, data) : await timetableSlotRepo.create({ ...base, sessionId: v.sessionId, sectionId: section._id, ...data });
      await AuditService.record({ action: existing ? 'timetable.lesson_changed' : 'timetable.lesson_added', entityType: 'timetable_slot', entityId: slot._id, after: { versionId: String(v._id), sectionId: String(section._id), day: input.day, periodNo: input.periodNo, staffId: String(teacher._id), room } });
      return slot;
    } catch (e) {
      if (dupKey(e)) {
        const m = keyName(e);
        throw conflict(m.includes('teacher_period_unique') ? `${teacher.name} is already teaching another class ${where}` : m.includes('room_period_unique') ? `Room ${room} is already in use ${where}` : `This class already has a lesson ${where}`);
      }
      throw e;
    }
  },

  async removeSlot(versionId: string, slotId: string) {
    const v = await timetableVersionRepo.getById(versionId, 'Timetable version');
    if (v.status !== 'draft') throw conflict('Published and archived timetables are read-only');
    const slot = await timetableSlotRepo.findOne({ _id: slotId, versionId: v._id });
    if (!slot) throw notFound('Lesson');
    await timetableSlotRepo.hardDeleteById(slot._id, 'Lesson'); // draft content only; history lives in archived versions
    await AuditService.record({ action: 'timetable.lesson_removed', entityType: 'timetable_slot', entityId: slot._id, before: { versionId: String(v._id), sectionId: String(slot.sectionId), day: slot.day, periodNo: slot.periodNo } });
  },

  // ----------------------------------------------------------------------------------------------- views
  /** The published version of a session (or, for editors, a specific version). */
  async resolveVersion(sessionId: Types.ObjectId | null, versionId: string | undefined, canSeeDrafts: boolean): Promise<Lean<ITimetableVersion> | null> {
    if (versionId) {
      if (!canSeeDrafts) throw forbidden();
      return timetableVersionRepo.getById(versionId, 'Timetable version') as Promise<Lean<ITimetableVersion>>;
    }
    const sid = sessionId ?? (await sessionRepo.findActive())?._id;
    return sid ? ((await timetableVersionRepo.findOne({ sessionId: sid, status: 'published' })) as Lean<ITimetableVersion> | null) : null;
  },

  async sectionView(sectionId: string, versionId: string | undefined, canSeeDrafts: boolean) {
    const section = await sectionRepo.getById(sectionId, 'Section');
    const v = await this.resolveVersion(section.sessionId, versionId, canSeeDrafts);
    if (!v) return { version: null, periods: [], workingDays: [], lessons: [] };
    const slots = await timetableSlotRepo.find({ versionId: v._id, sectionId: section._id }, { limit: 500 });
    return { version: versionMeta(v), section: await sectionLabel(section._id), periods: v.periods, workingDays: v.workingDays, lessons: await hydrate(slots) };
  },

  async teacherView(staffId: string, versionId: string | undefined, canSeeDrafts: boolean) {
    const teacher = await staffRepo.getById(staffId, 'Teacher');
    const v = await this.resolveVersion(null, versionId, canSeeDrafts);
    if (!v) return { version: null, teacher: teacher.name, periods: [], workingDays: [], lessons: [] };
    const slots = await timetableSlotRepo.find({ versionId: v._id, staffId: teacher._id }, { limit: 500 });
    return { version: versionMeta(v), teacher: teacher.name, periods: v.periods, workingDays: v.workingDays, lessons: await hydrate(slots) };
  },

  /** The section a student sits in this session (null when not enrolled). */
  async sectionOfStudent(studentId: Types.ObjectId): Promise<Types.ObjectId | null> {
    const session = await sessionRepo.findActive();
    if (!session) return null;
    const enr = await enrollmentRepo.findOne({ studentId, sessionId: session._id });
    return enr?.sectionId ?? null;
  },

  /** Who is free / which rooms are busy in one period — the "availability" helper while building a draft. */
  async availability(versionId: string, day: number, periodNo: number) {
    const v = await timetableVersionRepo.getById(versionId, 'Timetable version');
    const busy = await timetableSlotRepo.find({ versionId: v._id, day, periodNo });
    const busyStaff = new Set(busy.map((s) => String(s.staffId)));
    const teachers = await staffRepo.find({ status: 'active', kind: 'teaching' }, { sort: { name: 1 }, limit: 500 });
    return {
      day, periodNo,
      freeTeachers: teachers.filter((t) => !busyStaff.has(String(t._id))).map((t) => ({ id: String(t._id), name: t.name })),
      busyTeachers: teachers.filter((t) => busyStaff.has(String(t._id))).map((t) => ({ id: String(t._id), name: t.name })),
      busyRooms: [...new Set(busy.map((s) => s.room).filter((r): r is string => Boolean(r)))].sort(),
    };
  },
};

function versionMeta(v: Lean<ITimetableVersion>) {
  return { id: String(v._id), versionNo: v.versionNo, name: v.name, status: v.status, publishedAt: v.publishedAt ?? null };
}
export function versionDto(v: Lean<ITimetableVersion>) {
  return {
    id: String(v._id), sessionId: String(v.sessionId), versionNo: v.versionNo, name: v.name, status: v.status, workingDays: v.workingDays, periods: v.periods as ITimetablePeriod[],
    basedOnVersionId: v.basedOnVersionId ? String(v.basedOnVersionId) : null, createdByName: v.createdByName, publishedAt: v.publishedAt ?? null, publishedByName: v.publishedByName ?? null, archivedAt: v.archivedAt ?? null,
  };
}

async function sectionLabel(sectionId: Types.ObjectId): Promise<string> {
  const sec = await sectionRepo.findById(sectionId);
  if (!sec) return 'another class';
  const cls = await classRepo.findById(sec.classId);
  return `${cls?.name ?? ''} ${sec.name}`.trim();
}

/** Adds subject / teacher / class names to slots in three batched queries (no N+1). */
export async function hydrate(slots: Array<Lean<ITimetableSlot>>) {
  const [subjects, staff, sections] = await Promise.all([
    subjectRepo.findByIds([...new Set(slots.map((s) => String(s.subjectId)))]),
    staffRepo.findByIds([...new Set(slots.map((s) => String(s.staffId)))]),
    sectionRepo.findByIds([...new Set(slots.map((s) => String(s.sectionId)))]),
  ]);
  const classes = await classRepo.findByIds([...new Set(sections.map((s) => String(s.classId)))]);
  const sub = new Map(subjects.map((s) => [String(s._id), s.name]));
  const stf = new Map(staff.map((s) => [String(s._id), s.name]));
  const cls = new Map(classes.map((c) => [String(c._id), c.name]));
  const sec = new Map(sections.map((s) => [String(s._id), `${cls.get(String(s.classId)) ?? ''} ${s.name}`.trim()]));
  return slots
    .map((s) => ({ id: String(s._id), sectionId: String(s.sectionId), section: sec.get(String(s.sectionId)) ?? '', day: s.day, periodNo: s.periodNo, subjectId: String(s.subjectId), subject: sub.get(String(s.subjectId)) ?? '', staffId: String(s.staffId), teacher: stf.get(String(s.staffId)) ?? '', room: s.room ?? null }))
    .sort((a, b) => a.day - b.day || a.periodNo - b.periodNo);
}

