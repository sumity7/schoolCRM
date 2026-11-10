'use client';

import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { ChevronRight } from 'lucide-react';
import { errorText, get } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { inr } from '@/lib/fees';
import { Alert, Badge, Card, Skeleton } from '@/components/ui/primitives';

export interface ParentChild {
  id: string; name: string; admissionNo: string; relationship: string; className: string | null; rollNo: number | null;
  attendance: { percentage: number | null; markedDays: number; today: string | null };
  fees: { balancePaise: number; overduePaise: number; advanceCreditPaise: number } | null;
}

const todayTone = (s: string | null) => (s === 'present' ? 'success' : s === 'absent' ? 'danger' : s ? 'warning' : 'muted') as 'success' | 'danger' | 'warning' | 'muted';

/** Parent landing page: one card per linked child — today's attendance, attendance %, dues. Mobile-first. */
export function ParentHome() {
  const { me } = useAuth();
  const kids = useQuery({ queryKey: ['parent-children', me?.activeMembershipId], queryFn: async () => (await get<ParentChild[]>('/parent/children')).data });
  const notices = useQuery({ queryKey: ['notices-unread', me?.activeMembershipId], queryFn: async () => (await get<unknown[]>('/notices?limit=1')).meta as unknown as { unread: number } });
  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <div>
        <h1 className="text-xl font-semibold">Hello, {me?.user.name}</h1>
        <p className="text-sm text-muted-foreground">{me?.school?.name}</p>
      </div>
      {notices.data && notices.data.unread > 0 ? (
        <Link href="/app/notices" className="block"><Alert tone="info"><span data-testid="unread-notices">{notices.data.unread} new notice{notices.data.unread === 1 ? '' : 's'} from school</span> →</Alert></Link>
      ) : null}
      {kids.isLoading ? <Skeleton className="h-32" /> : null}
      {kids.error ? <Alert>{errorText(kids.error)}</Alert> : null}
      {kids.data && kids.data.length === 0 ? <Alert tone="info">No children are linked to your account. Please contact the school office.</Alert> : null}
      {(kids.data ?? []).map((c) => (
        <Link key={c.id} href={`/app/children/${c.id}`} className="block" data-testid={`child-${c.admissionNo}`}>
          <Card className="p-4 hover:bg-muted/40">
            <div className="flex items-start justify-between gap-2">
              <div>
                <h2 className="text-lg font-semibold">{c.name}</h2>
                <p className="text-sm text-muted-foreground">{c.className ?? 'Not enrolled'}{c.rollNo ? ` · Roll ${c.rollNo}` : ''} · {c.admissionNo}</p>
              </div>
              <ChevronRight className="mt-1 h-5 w-5 text-muted-foreground" aria-hidden />
            </div>
            <div className="mt-3 grid grid-cols-3 gap-2 text-sm">
              <div><p className="text-xs text-muted-foreground">Today</p><Badge tone={todayTone(c.attendance.today)}>{c.attendance.today?.replace('_', ' ') ?? 'not marked'}</Badge></div>
              <div><p className="text-xs text-muted-foreground">Attendance</p><p className="font-semibold">{c.attendance.percentage ?? '—'}{c.attendance.percentage !== null ? '%' : ''}</p></div>
              <div><p className="text-xs text-muted-foreground">Fees due</p><p className={`font-semibold ${c.fees?.overduePaise ? 'text-danger' : ''}`}>{c.fees ? inr(c.fees.balancePaise) : '—'}</p></div>
            </div>
          </Card>
        </Link>
      ))}
    </div>
  );
}
