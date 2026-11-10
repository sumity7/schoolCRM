'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { errorText, get } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { cn } from '@/lib/utils';
import { Alert, Button, Card, Skeleton } from '@/components/ui/primitives';

interface Att { records: Array<{ date: string; status: string; remark: string | null }>; summary: { markedDays: number; present: number; absent: number; late: number; halfDay: number; excused: number; percentage: number | null } }

const todayInIndia = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date());
const STYLE: Record<string, string> = { present: 'bg-success/20 text-success', absent: 'bg-danger/20 text-danger', late: 'bg-warning/20 text-warning', half_day: 'bg-warning/20 text-warning', excused: 'bg-muted text-muted-foreground' };
const LABEL: Record<string, string> = { present: 'Present', absent: 'Absent', late: 'Late', half_day: 'Half day', excused: 'Leave / excused' };

/** Month view of a child's/own attendance (read-only). `basePath` is the API route that accepts ?from&to. */
export function AttendanceCalendar({ basePath, testId = 'attendance-calendar' }: { basePath: string; testId?: string }) {
  const { me } = useAuth();
  const [month, setMonth] = useState(todayInIndia().slice(0, 7));
  const [y, m] = month.split('-').map(Number) as [number, number];
  const daysIn = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const firstWeekday = (new Date(Date.UTC(y, m - 1, 1)).getUTCDay() + 6) % 7; // Monday = 0
  const from = `${month}-01`;
  const to = `${month}-${String(daysIn).padStart(2, '0')}`;
  const q = useQuery({ queryKey: ['att-cal', me?.activeMembershipId, basePath, month], queryFn: async () => (await get<Att>(`${basePath}?from=${from}&to=${to}`)).data, retry: false });
  const byDay = new Map((q.data?.records ?? []).map((r) => [r.date, r]));
  const shift = (n: number) => { const d = new Date(Date.UTC(y, m - 1 + n, 1)); setMonth(d.toISOString().slice(0, 7)); };
  const title = new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString('en-IN', { month: 'long', year: 'numeric', timeZone: 'UTC' });

  return (
    <Card className="space-y-3 p-4" data-testid={testId}>
      <div className="flex items-center justify-between">
        <Button size="sm" variant="ghost" aria-label="Previous month" onClick={() => shift(-1)}><ChevronLeft className="h-4 w-4" /></Button>
        <h2 className="font-medium" aria-live="polite">{title}</h2>
        <Button size="sm" variant="ghost" aria-label="Next month" onClick={() => shift(1)} disabled={month >= todayInIndia().slice(0, 7)}><ChevronRight className="h-4 w-4" /></Button>
      </div>
      {q.isLoading ? <Skeleton className="h-40" /> : null}
      {q.error ? <Alert>{errorText(q.error)}</Alert> : null}
      {q.data ? (
        <>
          <div className="grid grid-cols-7 gap-1 text-center text-[11px] text-muted-foreground" aria-hidden>{['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((d) => <span key={d}>{d}</span>)}</div>
          <div className="grid grid-cols-7 gap-1" role="grid" aria-label={`Attendance for ${title}`}>
            {Array.from({ length: firstWeekday }, (_x, i) => <span key={`b${i}`} />)}
            {Array.from({ length: daysIn }, (_x, i) => {
              const date = `${month}-${String(i + 1).padStart(2, '0')}`;
              const rec = byDay.get(date);
              return (
                <span key={date} role="gridcell" data-status={rec?.status ?? 'none'} title={rec ? `${date}: ${LABEL[rec.status] ?? rec.status}${rec.remark ? ` (${rec.remark})` : ''}` : date}
                  className={cn('flex aspect-square items-center justify-center rounded-md border border-border text-xs', rec ? STYLE[rec.status] : 'text-muted-foreground')}>{i + 1}</span>
              );
            })}
          </div>
          <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
            {Object.entries(LABEL).map(([k, l]) => <span key={k} className="flex items-center gap-1"><span className={cn('h-3 w-3 rounded-sm', STYLE[k])} /> {l}</span>)}
          </div>
          <p className="text-sm" data-testid="calendar-summary">
            {q.data.summary.markedDays === 0 ? 'No attendance marked this month.' : `${q.data.summary.percentage ?? '—'}% · ${q.data.summary.present} present · ${q.data.summary.absent} absent · ${q.data.summary.late} late · ${q.data.summary.excused} leave`}
          </p>
        </>
      ) : null}
    </Card>
  );
}
