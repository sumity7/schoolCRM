import type { SchoolSettings } from './school.model';

export const DEFAULT_SETTINGS: SchoolSettings = {
  timezone: 'Asia/Kolkata',
  currency: 'INR',
  language: 'en',
  dateFormat: 'DD/MM/YYYY',
  workingDays: [1, 2, 3, 4, 5, 6],
  academicYearStartMonth: 4,
  themeColor: '#2563eb',
  attendancePolicy: { teacherEditWindowDays: 0, lateCountsAsPresent: true, halfDayWeight: 0.5, lowAttendanceThresholdPct: 75 },
};
