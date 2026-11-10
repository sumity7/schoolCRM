'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, Download } from 'lucide-react';
import { errorText, get } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { MODE_LABEL, inr, invoiceTone, openReceipt, type Invoice } from '@/lib/fees';
import type { ParentChild } from '@/components/parent-home';
import { markCell, resultTone, type ResultRow } from '@/lib/exams';
import { cn } from '@/lib/utils';
import { Alert, Badge, Button, Card, PageHeader, Skeleton } from '@/components/ui/primitives';

interface Att { records: Array<{ date: string; status: string; remark: string | null }>; summary: { markedDays: number; present: number; absent: number; late: number; halfDay: number; excused: number; percentage: number | null } }
interface Fees { totals: { billedPaise: number; paidPaise: number; balancePaise: number; overduePaise: number; advanceCreditPaise: number }; invoices: Invoice[]; payments: Array<{ id: string; receiptNo: string; paidOn: string; amountPaise: number; mode: string; status: string }> }

const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date());
const daysAgo = (n: number) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date(Date.now() - n * 86_400_000));
const dot: Record<string, string> = { present: 'bg-success', absent: 'bg-danger', late: 'bg-warning', half_day: 'bg-warning', excused: 'bg-muted-foreground' };

export default function ChildPage() {
  const { id } = useParams<{ id: string }>();
  const { me } = useAuth();
  const [tab, setTab] = useState<'attendance' | 'fees' | 'results'>('attendance');
  const [err, setErr] = useState<string | null>(null);
  const kids = useQuery({ queryKey: ['parent-children', me?.activeMembershipId], queryFn: async () => (await get<ParentChild[]>('/parent/children')).data });
  const child = kids.data?.find((c) => c.id === id);
  const att = useQuery({ queryKey: ['parent-att', me?.activeMembershipId, id], queryFn: async () => (await get<Att>(`/parent/children/${id}/attendance?from=${daysAgo(60)}&to=${today()}`)).data, retry: false });
  const results = useQuery({ queryKey: ['parent-results', me?.activeMembershipId, id], enabled: tab === 'results', queryFn: async () => (await get<ResultRow[]>(`/parent/children/${id}/results`)).data, retry: false });
  const fees = useQuery({ queryKey: ['parent-fees', me?.activeMembershipId, id], enabled: Boolean(child?.fees), queryFn: async () => (await get<Fees>(`/parent/children/${id}/fees`)).data, retry: false });

  if (kids.isLoading) return <Skeleton className="mx-auto h-40 max-w-3xl" />;
  if (!child) return <div className="mx-auto max-w-3xl space-y-3"><Alert>Child not found.</Alert><Link href="/app" className="text-sm text-primary">Back</Link></div>;

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <Link href="/app" className="inline-flex min-h-11 items-center gap-1 text-sm text-muted-foreground hover:text-foreground"><ArrowLeft className="h-4 w-4" aria-hidden /> My children</Link>
      <PageHeader title={child.name} description={`${child.className ?? 'Not enrolled'}${child.rollNo ? ` · Roll ${child.rollNo}` : ''} · ${child.admissionNo}`} />
      <div role="tablist" className="flex gap-1 border-b border-border">
        {(['attendance', 'results', ...(child.fees ? ['fees'] : [])] as Array<'attendance' | 'fees' | 'results'>).map((k) => (
          <button key={k} role="tab" aria-selected={tab === k} onClick={() => setTab(k)} className={cn('min-h-11 border-b-2 px-3 text-sm capitalize', tab === k ? 'border-primary font-medium' : 'border-transparent text-muted-foreground')}>{k}</button>
        ))}
      </div>
      {err ? <Alert>{err}</Alert> : null}

      {tab === 'attendance' ? (
        att.isLoading ? <Skeleton className="h-32" /> : att.error ? <Alert>{errorText(att.error)}</Alert> : att.data ? (
          <Card className="space-y-3 p-4">
            <p className="text-3xl font-semibold" data-testid="child-attendance-pct">{att.data.summary.percentage ?? '—'}{att.data.summary.percentage !== null ? '%' : ''}</p>
            <p className="text-sm text-muted-foreground">Last 60 days: {att.data.summary.present} present · {att.data.summary.absent} absent · {att.data.summary.late} late · {att.data.summary.halfDay} half-day · {att.data.summary.excused} excused</p>
            <ul className="grid grid-cols-7 gap-1 sm:grid-cols-10" aria-label="Daily attendance">
              {att.data.records.map((r) => (
                <li key={r.date} className="flex flex-col items-center rounded-md border border-border p-1 text-[10px]" title={`${r.date}: ${r.status}${r.remark ? ` (${r.remark})` : ''}`}>
                  <span className="text-muted-foreground">{r.date.slice(8)}/{r.date.slice(5, 7)}</span>
                  <span className={`mt-1 h-3 w-3 rounded-full ${dot[r.status] ?? 'bg-muted'}`} aria-label={r.status} />
                </li>
              ))}
            </ul>
            {att.data.records.length === 0 ? <p className="text-sm text-muted-foreground">No attendance marked in this period.</p> : null}
          </Card>
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
