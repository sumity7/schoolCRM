export type AttendanceStatusValue = 'present' | 'absent' | 'late' | 'half_day' | 'excused';

export interface AttendancePolicy {
  lateCountsAsPresent: boolean;
  halfDayWeight: number; // 0..1
}

export interface AttendanceSummary {
  markedDays: number;
  present: number;
  absent: number;
  late: number;
  halfDay: number;
  excused: number;
  /** present-equivalent units per policy */
  presentUnits: number;
  /** null when there is nothing to divide by */
  percentage: number | null;
}

/**
 * Attendance percentage = present-equivalent units / (marked days − excused days).
 * - present = 1; late = 1 or 0 per policy; half-day = policy weight; absent = 0.
 * - excused days are removed from the denominator (they are neither attended nor held against the student).
 * Rounded to 2 decimals (half-up). Pure and deterministic: used by API reports and UI.
 */
export function summariseAttendance(statuses: AttendanceStatusValue[], policy: AttendancePolicy): AttendanceSummary {
  const c = { present: 0, absent: 0, late: 0, halfDay: 0, excused: 0 };
  for (const s of statuses) {
    if (s === 'present') c.present++;
    else if (s === 'absent') c.absent++;
    else if (s === 'late') c.late++;
    else if (s === 'half_day') c.halfDay++;
    else c.excused++;
  }
  const presentUnits = c.present + (policy.lateCountsAsPresent ? c.late : 0) + c.halfDay * policy.halfDayWeight;
  const denom = statuses.length - c.excused;
  const percentage = denom > 0 ? Math.round((presentUnits / denom) * 10000 + Number.EPSILON) / 100 : null;
  return { markedDays: statuses.length, ...c, presentUnits, percentage };
}
