'use client';

import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { AttendanceStatusValue } from '@edunex/shared';
import { ApiError, get, put } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { cn } from '@/lib/utils';
import { Alert, Button, Card, Input, Skeleton } from '@/components/ui/primitives';

interface SectionRow { id: string; name: string; className?: string; classOrder: number; strength: number }
interface SheetStudent { studentId: string; rollNo?: number; admissionNo?: string; name: string; status: AttendanceStatusValue | null; remark?: string }
interface Sheet { date: string; today: string; isWorkingDay: boolean; notice?: string; locked: boolean; students: SheetStudent[] }

const STATUSES: Array<{ value: AttendanceStatusValue; label: string; short: string; tone: string }> = [
  { value: 'present', label: 'Present', short: 'P', tone: 'bg-success text-white' },
  { value: 'absent', label: 'Absent', short: 'A', tone: 'bg-danger text-white' },
  { value: 'late', label: 'Late', short: 'L', tone: 'bg-warning text-white' },
  { value: 'half_day', label: 'Half day', short: 'H', tone: 'bg-primary text-primary-foreground' },
  { value: 'excused', label: 'Excused', short: 'E', tone: 'bg-muted-foreground text-white' },
];

const todayInIndia = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date());

export default function AttendancePage() {
  const { me, can } = useAuth();
  const qc = useQueryClient();
  const [sectionId, setSectionId] = useState('');
  const [date, setDate] = useState(todayInIndia());
  const [marks, setMarks] = useState<Record<string, AttendanceStatusValue>>({});
  const [saved, setSaved] = useState<string | null>(null);

  const sections = useQuery({
    queryKey: ['sections', me?.activeMembershipId],
    // teachers (assigned scope) are offered only their own sections; the API enforces this regardless
    queryFn: async () => (await get<SectionRow[]>(me?.permissions.find((p) => p.key === 'attendance:create')?.scope === 'assigned' ? '/sections?mine=true' : '/sections')).data,
  });
  useEffect(() => {
    if (!sectionId && sections.data?.length) setSectionId(sections.data[0]!.id);
  }, [sections.data, sectionId]);

  const sheet = useQuery({
    queryKey: ['sheet', sectionId, date],
    enabled: Boolean(sectionId),
    queryFn: async () => (await get<Sheet>(`/attendance/sections/${sectionId}?date=${date}`)).data,
    retry: false,
  });
  useEffect(() => {
    if (!sheet.data) return;
    const next: Record<string, AttendanceStatusValue> = {};
    for (const s of sheet.data.students) if (s.status) next[s.studentId] = s.status;
    setMarks(next);
    setSaved(null);
  }, [sheet.data]);

  const save = useMutation({
    mutationFn: async () => {
      const entries = Object.entries(marks).map(([studentId, status]) => ({ studentId, status }));
      return (await put<{ saved: number; created: number; edited: number }>(`/attendance/sections/${sectionId}`, { date, entries })).data;
    },
    onSuccess: (r) => {
      setSaved(`Saved ${r.saved} students`);
      void qc.invalidateQueries({ queryKey: ['sheet', sectionId, date] });
    },
  });

  const students = sheet.data?.students ?? [];
  const unmarked = useMemo(() => students.filter((s) => !marks[s.studentId]).length, [students, marks]);
  const canSave = can('attendance:create') && sheet.data?.isWorkingDay && !sheet.data.locked && students.length > 0 && unmarked === 0;
  const errorMessage = save.error instanceof ApiError ? save.error.message : sheet.error instanceof ApiError ? sheet.error.message : null;

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <h1 className="text-xl font-semibold">Attendance</h1>
      <Card className="grid gap-3 p-3 sm:grid-cols-2 sm:p-4">
        <div>
          <label htmlFor="section" className="mb-1.5 block text-sm font-medium">Class &amp; section</label>
          {sections.isLoading ? <Skeleton className="h-11 w-full" /> : (
            <select id="section" data-testid="section-select" value={sectionId} onChange={(e) => setSectionId(e.target.value)} className="min-h-11 w-full rounded-lg border border-input bg-card px-3 text-sm">
              {(sections.data ?? []).map((s) => <option key={s.id} value={s.id}>{s.className} – {s.name} ({s.strength})</option>)}
            </select>
          )}
        </div>
        <div>
          <label htmlFor="date" className="mb-1.5 block text-sm font-medium">Date</label>
          <Input id="date" type="date" value={date} max={todayInIndia()} onChange={(e) => setDate(e.target.value)} data-testid="date-input" />
        </div>
      </Card>

      {!sections.isLoading && (sections.data?.length ?? 0) === 0 ? <Alert tone="info">No sections available. Ask your administrator to set up classes and assign you to a section.</Alert> : null}
      {sheet.data && !sheet.data.isWorkingDay ? <Alert tone="info">{sheet.data.notice ?? 'Not a working day'} — attendance cannot be marked.</Alert> : null}
      {sheet.data?.locked ? <Alert tone="info">This date is locked for teachers. Ask the class teacher or admin for a correction.</Alert> : null}
      {errorMessage ? <Alert>{errorMessage}</Alert> : null}
      {saved ? <Alert tone="success"><span data-testid="saved-msg">{saved}</span></Alert> : null}

      {sheet.isLoading && sectionId ? <Skeleton className="h-48 w-full" /> : null}
      {students.length > 0 ? (
        <Card className="overflow-hidden">
          <div className="flex items-center justify-between gap-2 border-b border-border p-3">
            <p className="text-sm text-muted-foreground">{students.length} students · {unmarked} unmarked</p>
            <Button size="sm" variant="outline" disabled={sheet.data?.locked || !sheet.data?.isWorkingDay} onClick={() => setMarks(Object.fromEntries(students.map((s) => [s.studentId, 'present' as const])))} data-testid="mark-all-present">
              Mark all present
            </Button>
          </div>
          <ul className="divide-y divide-border">
            {students.map((s) => (
              <li key={s.studentId} className="flex flex-col gap-2 p-3 sm:flex-row sm:items-center sm:justify-between" data-testid={`row-${s.admissionNo}`}>
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{s.rollNo ? `${s.rollNo}. ` : ''}{s.name}</p>
                  <p className="text-xs text-muted-foreground">{s.admissionNo}</p>
                </div>
                <div className="flex gap-1.5" role="group" aria-label={`Attendance for ${s.name}`}>
                  {STATUSES.map((st) => (
                    <button key={st.value} type="button" aria-pressed={marks[s.studentId] === st.value} aria-label={`${st.label} for ${s.name}`} title={st.label}
                      disabled={sheet.data?.locked || !sheet.data?.isWorkingDay}
                      onClick={() => setMarks((m) => ({ ...m, [s.studentId]: st.value }))}
                      className={cn('min-h-11 min-w-11 rounded-lg border border-input text-sm font-semibold disabled:opacity-50', marks[s.studentId] === st.value ? st.tone : 'bg-card text-foreground')}
                      data-testid={`mark-${s.admissionNo}-${st.value}`}>
                      {st.short}
                    </button>
                  ))}
                </div>
              </li>
            ))}
          </ul>
          <div className="sticky bottom-0 border-t border-border bg-card p-3">
            <Button className="w-full" disabled={!canSave || save.isPending} onClick={() => save.mutate()} data-testid="save-attendance">
              {save.isPending ? 'Saving…' : unmarked > 0 ? `Mark the remaining ${unmarked} to save` : 'Save attendance'}
            </Button>
          </div>
        </Card>
      ) : null}
    </div>
  );
}
