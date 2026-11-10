'use client';

import Link from 'next/link';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, Download } from 'lucide-react';
import { errorText, get } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { MODE_LABEL, inr, invoiceTone, openReceipt, type Invoice } from '@/lib/fees';
import type { ParentChild } from '@/components/parent-home';
import { AttendanceCalendar } from '@/components/attendance-calendar';
import { markCell, resultTone, type ResultRow } from '@/lib/exams';
import { cn } from '@/lib/utils';
import { OwnTimetable } from '@/components/own-timetable';
import { HomeworkCards } from '@/components/homework-list';
import type { Homework } from '@/lib/homework';
import { Alert, Badge, Button, Card, PageHeader, Skeleton } from '@/components/ui/primitives';

interface Profile { id: string; name: string; admissionNo: string; dob: string | null; gender: string | null; admissionDate: string | null; relationship: string; className: string | null; sectionName: string | null; rollNo: number | null; session: string | null }
interface Contact { name: string; phone: string | null; email: string | null; address: string | null }
interface Att { records: Array<{ date: string; status: string; remark: string | null }>; summary: { markedDays: number; present: number; absent: number; late: number; halfDay: number; excused: number; percentage: number | null } }
interface Fees { totals: { billedPaise: number; paidPaise: number; balancePaise: number; overduePaise: number; advanceCreditPaise: number }; invoices: Invoice[]; payments: Array<{ id: string; receiptNo: string; paidOn: string; amountPaise: number; mode: string; status: string }> }

const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date());
const daysAgo = (n: number) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date(Date.now() - n * 86_400_000));

/** The only tab values the page accepts from the URL. Anything else (or a tab the child's access does not include) falls back to attendance. */
const CHILD_TABS = ['attendance', 'results', 'fees', 'timetable', 'homework', 'profile'] as const;
type Tab = (typeof CHILD_TABS)[number];
const isTab = (v: string | null): v is Tab => v !== null && (CHILD_TABS as readonly string[]).includes(v);

export default function ChildPage() {
  return <Suspense fallback={<Skeleton className="mx-auto h-40 max-w-3xl" />}><ChildView /></Suspense>;
}

function ChildView() {
  const { id } = useParams<{ id: string }>();
  const { me } = useAuth();
  const router = useRouter();
  const search = useSearchParams();
  const requested = search.get('tab');
  const [err, setErr] = useState<string | null>(null);
  const kids = useQuery({ queryKey: ['parent-children', me?.activeMembershipId], queryFn: async () => (await get<ParentChild[]>('/parent/children')).data });
  const child = kids.data?.find((c) => c.id === id);
  const tab: Tab = isTab(requested) && (requested !== 'fees' || Boolean(child?.fees)) ? requested : 'attendance';
  const setTab = (t: Tab) => router.replace(`/app/children/${id}?tab=${t}`, { scroll: false });
  const att = useQuery({ queryKey: ['parent-att', me?.activeMembershipId, id], queryFn: async () => (await get<Att>(`/parent/children/${id}/attendance?from=${daysAgo(60)}&to=${today()}`)).data, retry: false });
  const results = useQuery({ queryKey: ['parent-results', me?.activeMembershipId, id], enabled: tab === 'results', queryFn: async () => (await get<ResultRow[]>(`/parent/children/${id}/results`)).data, retry: false });
  const homework = useQuery({ queryKey: ['parent-homework', me?.activeMembershipId, id], enabled: tab === 'homework', queryFn: async () => (await get<Homework[]>(`/parent/children/${id}/homework`)).data, retry: false });
  const profile = useQuery({ queryKey: ['parent-profile', me?.activeMembershipId, id], enabled: tab === 'profile', queryFn: async () => (await get<Profile>(`/parent/children/${id}/profile`)).data, retry: false });
  const contact = useQuery({ queryKey: ['parent-school-contact', me?.activeMembershipId], enabled: tab === 'profile', queryFn: async () => (await get<Contact>('/parent/school-contact')).data, retry: false });
  const fees = useQuery({ queryKey: ['parent-fees', me?.activeMembershipId, id], enabled: Boolean(child?.fees), queryFn: async () => (await get<Fees>(`/parent/children/${id}/fees`)).data, retry: false });

  if (kids.isLoading) return <Skeleton className="mx-auto h-40 max-w-3xl" />;
  if (!child) return <div className="mx-auto max-w-3xl space-y-3"><Alert>Child not found.</Alert><Link href="/app" className="text-sm text-primary">Back</Link></div>;

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <Link href="/app" className="inline-flex min-h-11 items-center gap-1 text-sm text-muted-foreground hover:text-foreground"><ArrowLeft className="h-4 w-4" aria-hidden /> My children</Link>
      {kids.data && kids.data.length > 1 ? (
        <nav aria-label="Switch child" className="flex flex-wrap gap-2" data-testid="child-switcher">
          {kids.data.map((k) => (
            <Link key={k.id} href={`/app/children/${k.id}?tab=${tab}`} onClick={() => setErr(null)} aria-current={k.id === id ? 'page' : undefined} data-testid={`switch-${k.admissionNo}`}
              className={cn('inline-flex min-h-11 items-center rounded-full border px-4 text-sm', k.id === id ? 'border-primary bg-primary/10 font-medium' : 'border-input hover:bg-muted')}>{k.name.split(' ')[0]}</Link>
          ))}
        </nav>
      ) : null}
      <PageHeader title={child.name} description={`${child.className ?? 'Not enrolled'}${child.rollNo ? ` · Roll ${child.rollNo}` : ''} · ${child.admissionNo}`} />
      <div role="tablist" className="flex gap-1 overflow-x-auto border-b border-border" data-testid="child-tabs">
        {(CHILD_TABS.filter((t) => t !== 'fees' || child.fees)).map((k) => (
          <button key={k} role="tab" aria-selected={tab === k} onClick={() => setTab(k)} className={cn('min-h-11 shrink-0 whitespace-nowrap border-b-2 px-3 text-sm capitalize', tab === k ? 'border-primary font-medium' : 'border-transparent text-muted-foreground')}>{k}</button>
        ))}
      </div>
      {err ? <Alert>{err}</Alert> : null}

      {tab === 'attendance' ? (
        att.isLoading ? <Skeleton className="h-32" /> : att.error ? <Alert>{errorText(att.error)}</Alert> : att.data ? (
          <Card className="space-y-3 p-4">
            <p className="text-3xl font-semibold" data-testid="child-attendance-pct">{att.data.summary.percentage ?? '—'}{att.data.summary.percentage !== null ? '%' : ''}</p>
            <p className="text-sm text-muted-foreground">Last 60 days: {att.data.summary.present} present · {att.data.summary.absent} absent · {att.data.summary.late} late · {att.data.summary.halfDay} half-day · {att.data.summary.excused} excused</p>
          </Card>
        ) : null
      ) : null}
      {tab === 'attendance' ? <AttendanceCalendar basePath={`/parent/children/${id}/attendance`} testId="child-calendar" /> : null}

      {tab === 'timetable' ? <div data-testid="child-timetable"><OwnTimetable key={id} path={`/parent/children/${id}/timetable`} show="teacher" testId="child-timetable-grid" /></div> : null}
      {tab === 'homework' ? (
        homework.isLoading ? <Skeleton className="h-32" /> : homework.error ? <Alert>{errorText(homework.error)}</Alert> : (
          <div data-testid="child-homework"><HomeworkCards items={homework.data ?? []} empty="No homework has been set for this class yet." /></div>
        )
      ) : null}
      {tab === 'profile' ? (
        profile.isLoading ? <Skeleton className="h-32" /> : profile.error ? <Alert>{errorText(profile.error)}</Alert> : profile.data ? (
          <div className="space-y-3">
            <Card className="p-4" data-testid="child-profile">
              <dl className="grid grid-cols-2 gap-3 text-sm">
                {([['Name', profile.data.name], ['Admission no.', profile.data.admissionNo], ['Class', [profile.data.className, profile.data.sectionName].filter(Boolean).join(' ') || 'Not enrolled'], ['Roll no.', profile.data.rollNo ?? '—'], ['Session', profile.data.session ?? '—'], ['Date of birth', profile.data.dob ?? '—'], ['Admitted on', profile.data.admissionDate ?? '—'], ['Your relationship', profile.data.relationship]] as Array<[string, string | number]>).map(([k, v]) => (
                  <div key={k}><dt className="text-xs text-muted-foreground">{k}</dt><dd className="font-medium">{v}</dd></div>
                ))}
              </dl>
            </Card>
            {contact.data ? (
              <Card className="space-y-1 p-4 text-sm" data-testid="school-contact">
                <h2 className="font-medium">Contact the school</h2>
                <p>{contact.data.name}</p>
                {contact.data.phone ? <p>Phone: <a className="text-primary underline" href={`tel:${contact.data.phone}`}>{contact.data.phone}</a></p> : null}
                {contact.data.email ? <p>E-mail: <a className="text-primary underline" href={`mailto:${contact.data.email}`}>{contact.data.email}</a></p> : null}
                {contact.data.address ? <p className="text-muted-foreground">{contact.data.address}</p> : null}
                {!contact.data.phone && !contact.data.email && !contact.data.address ? <p className="text-muted-foreground">The school has not added contact details yet.</p> : null}
              </Card>
            ) : null}
          </div>
        ) : null
      ) : null}

      {tab === 'results' ? (
        results.isLoading ? <Skeleton className="h-32" /> : results.error ? <Alert>{errorText(results.error)}</Alert> : (
          <div className="space-y-3">
            {(results.data ?? []).length === 0 ? <Alert tone="info">No published results yet.</Alert> : null}
            {(results.data ?? []).map((r) => (
              <Card key={r.id} className="space-y-2 p-4" data-testid="child-result">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h2 className="font-medium">{r.examName}</h2>
                  <Badge tone={resultTone(r.resultStatus)}>{r.resultStatus}</Badge>
                </div>
                <p className="text-sm">{r.percentage ?? '—'}% · grade {r.grade ?? '—'}{r.rank ? ` · rank ${r.rank}` : ''}{r.correction ? ' · corrected' : ''}</p>
                <ul className="grid grid-cols-2 gap-1 text-sm sm:grid-cols-3">{r.subjects.map((s) => <li key={s.subjectId}>{s.subject}: <strong>{markCell(s)}</strong>/{s.max} {s.grade ?? ''}</li>)}</ul>
                <Button size="sm" variant="outline" onClick={() => { setErr(null); openReceipt(r.id, `/parent/children/${id}/results/${r.id}/report-card.pdf`).catch((e) => setErr(errorText(e))); }}><Download className="h-4 w-4" aria-hidden /> Report card</Button>
              </Card>
            ))}
          </div>
        )
      ) : null}

      {tab === 'fees' && child.fees ? (
        fees.isLoading ? <Skeleton className="h-32" /> : fees.error ? <Alert>{errorText(fees.error)}</Alert> : fees.data ? (
          <div className="space-y-3">
            <Card className="grid grid-cols-3 gap-2 p-4 text-sm">
              <div><p className="text-xs text-muted-foreground">Due</p><p className="text-lg font-semibold" data-testid="child-balance">{inr(fees.data.totals.balancePaise)}</p></div>
              <div><p className="text-xs text-muted-foreground">Overdue</p><p className={`text-lg font-semibold ${fees.data.totals.overduePaise ? 'text-danger' : ''}`}>{inr(fees.data.totals.overduePaise)}</p></div>
              <div><p className="text-xs text-muted-foreground">Paid</p><p className="text-lg font-semibold">{inr(fees.data.totals.paidPaise)}</p></div>
            </Card>
            <Card className="divide-y divide-border">
              {fees.data.invoices.length === 0 ? <p className="p-3 text-sm text-muted-foreground">No fee invoices yet.</p> : null}
              {fees.data.invoices.map((i) => (
                <div key={i.id} className="flex flex-wrap items-center justify-between gap-2 p-3 text-sm">
                  <span>{i.installmentLabel} · due {i.dueDate} <Badge tone={invoiceTone(i.status)}>{i.status.replace('_', ' ')}</Badge></span>
                  <span className="font-medium">{inr(i.balancePaise)} <span className="text-xs font-normal text-muted-foreground">of {inr(i.totalPaise)}</span></span>
                </div>
              ))}
            </Card>
            <h2 className="font-medium">Receipts</h2>
            <Card className="divide-y divide-border">
              {fees.data.payments.length === 0 ? <p className="p-3 text-sm text-muted-foreground">No payments yet.</p> : null}
              {fees.data.payments.map((p) => (
                <div key={p.id} className="flex flex-wrap items-center justify-between gap-2 p-3 text-sm">
                  <span>{p.paidOn} · {inr(p.amountPaise)} · {MODE_LABEL[p.mode]} {p.status === 'reversed' ? <Badge tone="danger">cancelled</Badge> : null}</span>
                  <Button size="sm" variant="outline" onClick={() => { setErr(null); openReceipt(p.id, `/parent/children/${id}/payments/${p.id}/receipt.pdf`).catch((e) => setErr(errorText(e))); }} data-testid={`receipt-${p.receiptNo}`}><Download className="h-4 w-4" aria-hidden /> {p.receiptNo}</Button>
                </div>
              ))}
            </Card>
            <p className="text-xs text-muted-foreground">Please pay at the school office. Online payment is not available yet.</p>
          </div>
        ) : null
      ) : null}
    </div>
  );
}
