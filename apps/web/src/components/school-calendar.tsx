'use client';

import { useQuery } from '@tanstack/react-query';
import { errorText, get } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { Alert, Badge, Card, Skeleton } from '@/components/ui/primitives';

interface CalendarData {
  session: string | null;
  events: Array<{ id: string; date: string; endDate: string | null; type: 'holiday' | 'event' | 'exam' | 'ptm'; title: string }>;
  exams: Array<{ id: string; name: string; type: string; subjects: Array<{ subject: string; date: string | null; maxMarks: number }> }>;
}

const TYPE_LABEL: Record<string, string> = { holiday: 'Holiday', event: 'Event', exam: 'Exam', ptm: 'Parent-teacher meeting' };
const TONE: Record<string, 'success' | 'primary' | 'warning' | 'muted'> = { holiday: 'success', event: 'primary', exam: 'warning', ptm: 'primary' };
const fmt = (d: string) => new Date(`${d}T00:00:00`).toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date());

/** Read-only calendar + exam schedule. `path` decides whose (the server derives the class; nothing is trusted from the client). */
export function SchoolCalendar({ path, testId = 'school-calendar' }: { path: string; testId?: string }) {
  const { me } = useAuth();
  const q = useQuery({ queryKey: ['school-calendar', me?.activeMembershipId, path], queryFn: async () => (await get<CalendarData>(path)).data, retry: false });
  if (q.isLoading) return <Skeleton className="h-40" />;
  if (q.error) return <Alert>{errorText(q.error)}</Alert>;
  if (!q.data) return null;
  const t = today();
  const upcoming = q.data.events.filter((e) => (e.endDate ?? e.date) >= t);
  const past = q.data.events.filter((e) => (e.endDate ?? e.date) < t);
  return (
    <div className="space-y-4" data-testid={testId}>
      <section className="space-y-2" aria-labelledby="exams-h">
        <h2 id="exams-h" className="font-medium">Exam schedule</h2>
        {q.data.exams.length === 0 ? <p className="text-sm text-muted-foreground">No exams have been scheduled for this class yet.</p> : null}
        {q.data.exams.map((e) => (
          <Card key={e.id} className="p-3" data-testid="exam-schedule">
            <p className="font-medium">{e.name} <span className="text-xs font-normal capitalize text-muted-foreground">· {e.type}</span></p>
            <ul className="mt-2 divide-y divide-border text-sm">
              {e.subjects.map((s) => (
                <li key={s.subject} className="flex flex-wrap justify-between gap-2 py-1.5"><span>{s.subject}</span><span className="text-muted-foreground">{s.date ? fmt(s.date) : 'Date to be announced'} · {s.maxMarks} marks</span></li>
              ))}
            </ul>
          </Card>
        ))}
      </section>
      <section className="space-y-2" aria-labelledby="events-h">
        <h2 id="events-h" className="font-medium">Holidays & events{q.data.session ? ` · ${q.data.session}` : ''}</h2>
        {upcoming.length === 0 ? <p className="text-sm text-muted-foreground">Nothing upcoming.</p> : null}
        <ul className="space-y-2">
          {upcoming.map((e) => (
            <li key={e.id}><Card className="flex flex-wrap items-center justify-between gap-2 p-3 text-sm" data-testid="calendar-event"><span><span className="font-medium">{e.title}</span><span className="block text-muted-foreground">{fmt(e.date)}{e.endDate && e.endDate !== e.date ? ` – ${fmt(e.endDate)}` : ''}</span></span><Badge tone={TONE[e.type] ?? 'muted'}>{TYPE_LABEL[e.type] ?? e.type}</Badge></Card></li>
          ))}
        </ul>
        {past.length ? <details className="text-sm"><summary className="min-h-11 cursor-pointer py-2 text-muted-foreground">Earlier this session ({past.length})</summary><ul className="space-y-1">{past.map((e) => <li key={e.id} className="text-muted-foreground">{fmt(e.date)} — {e.title}</li>)}</ul></details> : null}
      </section>
    </div>
  );
}
