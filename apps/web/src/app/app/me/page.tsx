'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Download } from 'lucide-react';
import { errorText, get } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { AttendanceCalendar } from '@/components/attendance-calendar';
import type { StudentMe } from '@/components/student-home';
import { markCell, resultTone, type ResultRow } from '@/lib/exams';
import { openReceipt } from '@/lib/fees';
import { cn } from '@/lib/utils';
import { Alert, Badge, Button, Card, PageHeader, Skeleton } from '@/components/ui/primitives';

type Tab = 'profile' | 'attendance' | 'results' | 'history';
interface Hist { session: string; className: string; sectionName: string; rollNo: number | null; status: string; joinedOn: string; leftOn: string | null }

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return <div className="grid grid-cols-[130px_1fr] gap-2 py-1.5 text-sm"><dt className="text-muted-foreground">{label}</dt><dd className="min-w-0 break-words">{children || '—'}</dd></div>;
}

/** The student's own academic record: profile, attendance calendar, published results + report cards, class history. */
export default function MyRecordsPage() {
  const { me } = useAuth();
  const [tab, setTab] = useState<Tab>('profile');
  const [err, setErr] = useState<string | null>(null);
  const profile = useQuery({ queryKey: ['student-me', me?.activeMembershipId], queryFn: async () => (await get<StudentMe>('/student/me')).data, retry: false });
  const results = useQuery({ queryKey: ['student-results', me?.activeMembershipId], enabled: tab === 'results', queryFn: async () => (await get<ResultRow[]>('/student/me/results')).data });
  const history = useQuery({ queryKey: ['student-history', me?.activeMembershipId], enabled: tab === 'history', queryFn: async () => (await get<Hist[]>('/student/me/history')).data });
  const p = profile.data;
  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <PageHeader title="My records" description="Your own information. You can view it but not change it; ask the school office to correct anything." />
      <div role="tablist" className="flex gap-1 overflow-x-auto border-b border-border">
        {(['profile', 'attendance', 'results', 'history'] as Tab[]).map((k) => (
          <button key={k} role="tab" aria-selected={tab === k} onClick={() => setTab(k)} className={cn('min-h-11 whitespace-nowrap border-b-2 px-3 text-sm capitalize', tab === k ? 'border-primary font-medium' : 'border-transparent text-muted-foreground')}>{k === 'history' ? 'Class history' : k}</button>
        ))}
      </div>
      {err ? <Alert>{err}</Alert> : null}

      {tab === 'profile' ? (
        profile.isLoading ? <Skeleton className="h-40" /> : profile.error ? <Alert>{errorText(profile.error)}</Alert> : p ? (
          <Card className="p-4">
            <dl>
              <Row label="Name">{p.profile.name}</Row><Row label="Admission no.">{p.profile.admissionNo}</Row>
              <Row label="Class">{p.class.className ? `${p.class.className} ${p.class.sectionName ?? ''}${p.class.rollNo ? ` · Roll ${p.class.rollNo}` : ''}` : null}</Row>
              <Row label="Session">{p.class.session}</Row><Row label="Date of birth">{p.profile.dob}</Row><Row label="Admitted on">{p.profile.admissionDate}</Row>
              <Row label="Phone">{p.profile.phone}</Row><Row label="Email">{p.profile.email}</Row>
            </dl>
          </Card>
        ) : null
      ) : null}

      {tab === 'attendance' ? <AttendanceCalendar basePath="/student/me/attendance" testId="student-calendar" /> : null}

      {tab === 'results' ? (
        results.isLoading ? <Skeleton className="h-32" /> : results.error ? <Alert>{errorText(results.error)}</Alert> : (
          <div className="space-y-3">
            {(results.data ?? []).length === 0 ? <Alert tone="info">No published results yet.</Alert> : null}
            {(results.data ?? []).map((r) => (
              <Card key={r.id} className="space-y-2 p-4" data-testid="my-result">
                <div className="flex flex-wrap items-center justify-between gap-2"><h2 className="font-medium">{r.examName}</h2><Badge tone={resultTone(r.resultStatus)}>{r.resultStatus}</Badge></div>
                <p className="text-sm">{r.percentage ?? '—'}% · grade {r.grade ?? '—'}{r.rank ? ` · rank ${r.rank}` : ''}{r.correction ? ' · corrected' : ''}</p>
                <ul className="grid grid-cols-2 gap-1 text-sm sm:grid-cols-3">{r.subjects.map((s) => <li key={s.subjectId}>{s.subject}: <strong>{markCell(s)}</strong>/{s.max} {s.grade ?? ''}</li>)}</ul>
                <Button size="sm" variant="outline" onClick={() => { setErr(null); openReceipt(r.id, `/student/me/results/${r.id}/report-card.pdf`).catch((e) => setErr(errorText(e))); }}><Download className="h-4 w-4" aria-hidden /> Report card</Button>
              </Card>
            ))}
          </div>
        )
      ) : null}

      {tab === 'history' ? (
        history.isLoading ? <Skeleton className="h-32" /> : history.error ? <Alert>{errorText(history.error)}</Alert> : (
          <Card className="divide-y divide-border">
            {(history.data ?? []).map((h, i) => (
              <div key={i} className="flex flex-wrap items-center justify-between gap-2 p-3 text-sm">
                <span><strong>{h.session}</strong> · {h.className} {h.sectionName}{h.rollNo ? ` · Roll ${h.rollNo}` : ''}</span>
                <span className="text-muted-foreground">{h.joinedOn}{h.leftOn ? ` → ${h.leftOn}` : ''} <Badge tone={h.status === 'active' ? 'success' : 'muted'}>{h.status}</Badge></span>
              </div>
            ))}
            {(history.data ?? []).length === 0 ? <p className="p-3 text-sm text-muted-foreground">No history yet.</p> : null}
          </Card>
        )
      ) : null}
    </div>
  );
}
