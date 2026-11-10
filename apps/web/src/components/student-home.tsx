'use client';

import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { AlertTriangle } from 'lucide-react';
import { errorText, get } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { inr } from '@/lib/fees';
import { Alert, Badge, Card, Skeleton } from '@/components/ui/primitives';

export interface StudentMe {
  profile: { name: string; admissionNo: string; dob: string; gender: string | null; admissionDate: string; phone: string | null; email: string | null };
  class: { className: string | null; sectionName: string | null; rollNo: number | null; session: string | null };
  attendance: { percentage: number | null; markedDays: number; present: number; absent: number; late: number; today: string | null; threshold: number; low: boolean };
  recentResults: Array<{ id: string; examName: string; percentage: number | null; grade: string | null; resultStatus: string; rank: number | null }>;
  fees: { balancePaise: number; overduePaise: number; advanceCreditPaise: number } | null;
}

const todayTone = (s: string | null) => (s === 'present' ? 'success' : s === 'absent' ? 'danger' : s ? 'warning' : 'muted') as 'success' | 'danger' | 'warning' | 'muted';

/** Student landing page (own record only). */
export function StudentHome() {
  const { me } = useAuth();
  const q = useQuery({ queryKey: ['student-me', me?.activeMembershipId], queryFn: async () => (await get<StudentMe>('/student/me')).data, retry: false });
  const unread = useQuery({ queryKey: ['notices-unread', me?.activeMembershipId], queryFn: async () => (await get<unknown[]>('/notices?limit=1')).meta as unknown as { unread: number } });
  const d = q.data;
  return (
    <div className="mx-auto max-w-3xl space-y-4" data-testid="student-home">
      <div>
        <h1 className="text-xl font-semibold">Hello, {d?.profile.name ?? me?.user.name}</h1>
        <p className="text-sm text-muted-foreground">{d ? `${d.class.className ?? 'Not enrolled'}${d.class.sectionName ? ` · Section ${d.class.sectionName}` : ''}${d.class.rollNo ? ` · Roll ${d.class.rollNo}` : ''} · ${d.profile.admissionNo}` : me?.school?.name}</p>
      </div>
      {unread.data && unread.data.unread > 0 ? <Link href="/app/notices" className="block"><Alert tone="info"><span data-testid="unread-notices">{unread.data.unread} new notice{unread.data.unread === 1 ? '' : 's'} →</span></Alert></Link> : null}
      {q.isLoading ? <Skeleton className="h-32" /> : null}
      {q.error ? <Alert>{errorText(q.error)}</Alert> : null}
      {d ? (
        <>
          {d.attendance.low ? (
            <Alert tone="danger"><span className="flex items-center gap-2" data-testid="low-attendance-warning"><AlertTriangle className="h-4 w-4" aria-hidden /> Your attendance is {d.attendance.percentage}%, below the school minimum of {d.attendance.threshold}%.</span></Alert>
          ) : null}
          <div className="grid gap-3 sm:grid-cols-3">
            <Card className="p-4"><p className="text-xs text-muted-foreground">Today</p><div className="mt-1"><Badge tone={todayTone(d.attendance.today)}>{d.attendance.today?.replace('_', ' ') ?? 'not marked'}</Badge></div></Card>
            <Card className="p-4"><p className="text-xs text-muted-foreground">Attendance</p><p className="text-2xl font-semibold" data-testid="student-attendance-pct">{d.attendance.percentage ?? '—'}{d.attendance.percentage !== null ? '%' : ''}</p><p className="text-xs text-muted-foreground">{d.attendance.present} present · {d.attendance.absent} absent · {d.attendance.late} late</p></Card>
            {d.fees ? <Card className="p-4"><p className="text-xs text-muted-foreground">Fees due</p><p className={`text-2xl font-semibold ${d.fees.overduePaise ? 'text-danger' : ''}`}>{inr(d.fees.balancePaise)}</p></Card> : <Card className="p-4"><p className="text-xs text-muted-foreground">Session</p><p className="text-2xl font-semibold">{d.class.session ?? '—'}</p></Card>}
          </div>
          <Card className="space-y-2 p-4">
            <div className="flex items-center justify-between"><h2 className="font-medium">Recent results</h2><Link href="/app/me" className="text-sm text-primary hover:underline">All records</Link></div>
            {d.recentResults.length === 0 ? <p className="text-sm text-muted-foreground">No published results yet.</p> : (
              <ul className="divide-y divide-border text-sm">
                {d.recentResults.map((r) => <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 py-2"><span>{r.examName}</span><span><strong>{r.percentage ?? '—'}%</strong> · grade {r.grade ?? '—'}{r.rank ? ` · rank ${r.rank}` : ''} <Badge tone={r.resultStatus === 'pass' ? 'success' : 'danger'}>{r.resultStatus}</Badge></span></li>)}
              </ul>
            )}
          </Card>
        </>
      ) : null}
    </div>
  );
}
