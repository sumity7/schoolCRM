/**
 * Exam result computation (R4, D-15 default: configurable bands; marks → percentage → grade). Pure & deterministic:
 * the same inputs always produce the same result (doc 11 "determinism test").
 *
 * Rules:
 *  - marks are numbers with at most 2 decimals; `null` means NOT ENTERED (≠ 0) → the result is `incomplete`;
 *  - `absent` counts as 0 and fails the subject when policy.absentIsFail (default) — otherwise it is excluded like exempt;
 *  - `exempt` subjects are excluded from totals and pass/fail;
 *  - percentage = totalObtained / totalMax × 100, rounded HALF-UP to 2 decimals;
 *  - grade = first band (highest minPct first) with percentage ≥ minPct; bands must cover 0;
 *  - a subject passes when obtained ≥ passMarks; the student passes when every counted subject passes.
 */
export interface GradeBand { minPct: number; grade: string; gradePoint?: number; remark?: string }
export interface SubjectInput { subjectId: string; maxMarks: number; passMarks: number; obtained: number | null; status: 'entered' | 'absent' | 'exempt' | 'not_entered' }
export interface SubjectResult { subjectId: string; obtained: number | null; max: number; status: SubjectInput['status']; passed: boolean | null; grade: string | null; percentage: number | null }
export interface ComputedResult {
  subjectResults: SubjectResult[];
  totalObtained: number;
  totalMax: number;
  percentage: number | null;
  grade: string | null;
  resultStatus: 'pass' | 'fail' | 'incomplete';
}

export const round2 = (x: number) => Math.round((x + Number.EPSILON) * 100) / 100;
const pct = (o: number, m: number) => (m > 0 ? Math.floor((o / m) * 10000 + 0.5 + 1e-9) / 100 : 0);

export function validateBands(bands: GradeBand[]): string | null {
  if (bands.length === 0 || bands.length > 15) return 'Define between 1 and 15 grade bands';
  const mins = bands.map((b) => b.minPct);
  if (mins.some((m) => !Number.isFinite(m) || m < 0 || m > 100)) return 'Band minimums must be between 0 and 100';
  if (new Set(mins).size !== mins.length) return 'Two bands have the same minimum';
  if (!mins.includes(0)) return 'One band must start at 0% so every percentage gets a grade';
  if (bands.some((b) => !b.grade.trim())) return 'Every band needs a grade';
  return null;
}

export function gradeFor(percentage: number, bands: GradeBand[]): string {
  const sorted = [...bands].sort((a, b) => b.minPct - a.minPct);
  return (sorted.find((b) => percentage >= b.minPct) ?? sorted[sorted.length - 1]!).grade;
}

export function computeResult(subjects: SubjectInput[], bands: GradeBand[], policy: { absentIsFail: boolean } = { absentIsFail: true }): ComputedResult {
  let incomplete = false;
  let failed = false;
  let totalObtained = 0;
  let totalMax = 0;
  const subjectResults: SubjectResult[] = subjects.map((s) => {
    if (s.status === 'exempt' || (s.status === 'absent' && !policy.absentIsFail)) {
      return { subjectId: s.subjectId, obtained: null, max: s.maxMarks, status: s.status, passed: null, grade: null, percentage: null };
    }
    if (s.status === 'not_entered' || (s.status === 'entered' && s.obtained === null)) {
      incomplete = true;
      return { subjectId: s.subjectId, obtained: null, max: s.maxMarks, status: 'not_entered', passed: null, grade: null, percentage: null };
    }
    const obtained = s.status === 'absent' ? 0 : round2(s.obtained!);
    const passed = obtained >= s.passMarks;
    if (!passed) failed = true;
    totalObtained = round2(totalObtained + obtained);
    totalMax += s.maxMarks;
    const p = pct(obtained, s.maxMarks);
    return { subjectId: s.subjectId, obtained, max: s.maxMarks, status: s.status, passed, grade: gradeFor(p, bands), percentage: p };
  });
  if (incomplete) return { subjectResults, totalObtained, totalMax, percentage: null, grade: null, resultStatus: 'incomplete' };
  const percentage = totalMax > 0 ? pct(totalObtained, totalMax) : null;
  return { subjectResults, totalObtained, totalMax, percentage, grade: percentage === null ? null : gradeFor(percentage, bands), resultStatus: totalMax === 0 ? 'incomplete' : failed ? 'fail' : 'pass' };
}

/** Standard competition ranking (1,2,2,4) by percentage; incomplete results get no rank. */
export function rankResults<T extends { percentage: number | null; resultStatus: string }>(rows: T[]): Array<T & { rank: number | null }> {
  const ranked = rows.filter((r) => r.resultStatus !== 'incomplete' && r.percentage !== null).sort((a, b) => b.percentage! - a.percentage!);
  const rankOf = new Map<T, number>();
  ranked.forEach((r, i) => rankOf.set(r, i > 0 && ranked[i - 1]!.percentage === r.percentage ? rankOf.get(ranked[i - 1]!)! : i + 1));
  return rows.map((r) => ({ ...r, rank: rankOf.get(r) ?? null }));
}

export const DEFAULT_BANDS: GradeBand[] = [
  { minPct: 91, grade: 'A1', gradePoint: 10 }, { minPct: 81, grade: 'A2', gradePoint: 9 }, { minPct: 71, grade: 'B1', gradePoint: 8 },
  { minPct: 61, grade: 'B2', gradePoint: 7 }, { minPct: 51, grade: 'C1', gradePoint: 6 }, { minPct: 41, grade: 'C2', gradePoint: 5 },
  { minPct: 33, grade: 'D', gradePoint: 4 }, { minPct: 0, grade: 'E', gradePoint: 0, remark: 'Needs improvement' },
];
