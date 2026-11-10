export const DAY_NAMES = ['', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'] as const;

export interface Period { no: number; label: string; start: string; end: string; kind: 'lesson' | 'break' }
export interface Lesson { id: string; sectionId: string; section: string; day: number; periodNo: number; subjectId: string; subject: string; staffId: string; teacher: string; room: string | null }
export interface TimetableView {
  version: { id: string; versionNo: number; name: string; status: 'draft' | 'published' | 'archived'; publishedAt: string | null } | null;
  section?: string;
  teacher?: string;
  periods: Period[];
  workingDays: number[];
  lessons: Lesson[];
}
export interface VersionRow {
  id: string; sessionId: string; versionNo: number; name: string; status: 'draft' | 'published' | 'archived'; workingDays: number[]; periods: Period[];
  basedOnVersionId: string | null; createdByName: string; publishedAt: string | null; publishedByName: string | null; archivedAt: string | null; lessonCount: number;
}

const pad = (n: number) => String(n).padStart(2, '0');
const toMin = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));
const toHHMM = (m: number) => `${pad(Math.floor(m / 60))}:${pad(m % 60)}`;

/** Builds a period grid: N lessons of `minutes` starting at `start`, with an optional break (of `breakMinutes`) after lesson `breakAfter`. */
export function buildPeriods(o: { lessons: number; start: string; minutes: number; breakAfter?: number; breakMinutes?: number }): Period[] {
  const out: Period[] = [];
  let t = toMin(o.start);
  let lesson = 0;
  for (let i = 0; i < o.lessons; i++) {
    lesson++;
    out.push({ no: out.length + 1, label: `Period ${lesson}`, start: toHHMM(t), end: toHHMM(t + o.minutes), kind: 'lesson' });
    t += o.minutes;
    if (o.breakAfter && lesson === o.breakAfter && o.breakMinutes) {
      out.push({ no: out.length + 1, label: 'Break', start: toHHMM(t), end: toHHMM(t + o.breakMinutes), kind: 'break' });
      t += o.breakMinutes;
    }
  }
  return out;
}
