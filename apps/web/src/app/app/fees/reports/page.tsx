'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Download } from 'lucide-react';
import { parseRupees } from '@edunex/shared';
import { downloadFile, errorText, get, post } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { MODE_LABEL, inr } from '@/lib/fees';
import { sectionLabel, sortSections, useSections } from '@/lib/lookups';
import { Alert, Badge, Button, Card, Field, Input, PageHeader, Select, Skeleton, Table, Td, Th } from '@/components/ui/primitives';

interface Collection { from: string; to: string; totalPaise: number; count: number; reversedCount: number; byMode: Array<{ key: string; amountPaise: number }>; byDay: Array<{ key: string; amountPaise: number }>; byCashier: Array<{ key: string; amountPaise: number }> }
interface Outstanding { asOf: string; totalPaise: number; overduePaise: number; students: number; rows: Array<{ studentId: string; name: string; admissionNo: string; className: string; balancePaise: number; overduePaise: number; oldestDue: string; invoices: number }> }
interface Closing { id: string; date: string; cashTotalPaise: number; nonCashTotalPaise: number; countedCashPaise: number | null; note: string | null; reopened: boolean }

const todayInIndia = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date());
const monthStart = () => `${todayInIndia().slice(0, 7)}-01`;

export default function FeeReportsPage() {
  const { me, can } = useAuth();
  const [from, setFrom] = useState(monthStart());
  const [to, setTo] = useState(todayInIndia());
  const [sectionId, setSectionId] = useState('');
  const [dlErr, setDlErr] = useState<string | null>(null);
  const sections = useSections();
  const col = useQuery({ queryKey: ['fee-col', me?.activeMembershipId, from, to], queryFn: async () => (await get<Collection>(`/fees/reports/collection?from=${from}&to=${to}`)).data });
  const out = useQuery({ queryKey: ['fee-out', me?.activeMembershipId, sectionId], queryFn: async () => (await get<Outstanding>(`/fees/reports/outstanding${sectionId ? `?sectionId=${sectionId}` : ''}`)).data });
  const dl = (path: string, name: string) => { setDlErr(null); downloadFile(path, name).catch((e) => setDlErr(errorText(e))); };

  return (
    <div className="mx-auto max-w-5xl space-y-4">
      <PageHeader title="Fee reports" description="Collections, dues and day closing — computed from the ledger, never typed in." />
      {dlErr ? <Alert>{dlErr}</Alert> : null}
      <Card className="space-y-3 p-4">
        <div className="flex flex-wrap items-end justify-between gap-2">
          <h2 className="font-medium">Collection</h2>
          {can('reports:export') ? <Button size="sm" variant="outline" onClick={() => dl(`/fees/reports/collection.csv?from=${from}&to=${to}`, 'collection.csv')}><Download className="h-4 w-4" aria-hidden /> CSV</Button> : null}
        </div>
        <div className="grid gap-2 sm:grid-cols-[170px_170px]">
          <Input type="date" aria-label="From" value={from} max={to} onChange={(e) => setFrom(e.target.value)} />
          <Input type="date" aria-label="To" value={to} min={from} max={todayInIndia()} onChange={(e) => setTo(e.target.value)} />
        </div>
        {col.isLoading ? <Skeleton className="h-24" /> : null}
        {col.error ? <Alert>{errorText(col.error)}</Alert> : null}
        {col.data ? (
          <>
            <div className="grid gap-3 sm:grid-cols-3">
              <div><p className="text-xs text-muted-foreground">Collected</p><p className="text-2xl font-semibold" data-testid="collected-total">{inr(col.data.totalPaise)}</p><p className="text-xs text-muted-foreground">{col.data.count} receipts{col.data.reversedCount ? ` · ${col.data.reversedCount} reversed (excluded)` : ''}</p></div>
              <div><p className="text-xs text-muted-foreground">By mode</p>{col.data.byMode.map((m) => <p key={m.key} className="text-sm">{MODE_LABEL[m.key] ?? m.key}: <strong>{inr(m.amountPaise)}</strong></p>)}</div>
              <div><p className="text-xs text-muted-foreground">By cashier</p>{col.data.byCashier.map((m) => <p key={m.key} className="text-sm">{m.key}: <strong>{inr(m.amountPaise)}</strong></p>)}</div>
            </div>
            {col.data.byDay.length > 1 ? (
              <div className="flex h-24 items-end gap-1" aria-label="Collection per day">
                {(() => { const max = Math.max(...col.data.byDay.map((d) => d.amountPaise)); return col.data.byDay.map((d) => <div key={d.key} title={`${d.key}: ${inr(d.amountPaise)}`} className="flex-1 rounded-t bg-primary/70" style={{ height: `${Math.max(4, (d.amountPaise / max) * 100)}%` }} />); })()}
              </div>
            ) : null}
          </>
        ) : null}
      </Card>

      <Card className="space-y-3 p-4">
        <div className="flex flex-wrap items-end justify-between gap-2">
          <h2 className="font-medium">Outstanding dues</h2>
          {can('reports:export') ? <Button size="sm" variant="outline" onClick={() => dl(`/fees/reports/outstanding.csv${sectionId ? `?sectionId=${sectionId}` : ''}`, 'outstanding.csv')}><Download className="h-4 w-4" aria-hidden /> CSV</Button> : null}
        </div>
        <Select aria-label="Section" className="max-w-60" value={sectionId} onChange={(e) => setSectionId(e.target.value)}>
          <option value="">Whole school</option>
          {sortSections(sections.data ?? []).map((s) => <option key={s.id} value={s.id}>{sectionLabel(s)}</option>)}
        </Select>
        {out.isLoading ? <Skeleton className="h-24" /> : null}
        {out.data ? (
          <>
            <p className="text-sm">Total due <strong data-testid="outstanding-total">{inr(out.data.totalPaise)}</strong> · overdue <strong className="text-danger">{inr(out.data.overduePaise)}</strong> · {out.data.students} students</p>
            {out.data.rows.length > 0 ? (
              <Table minWidth={620} testId="outstanding-table">
                <thead className="border-b border-border"><tr><Th>Student</Th><Th>Class</Th><Th className="text-right">Balance</Th><Th className="text-right">Overdue</Th><Th>Oldest due</Th></tr></thead>
                <tbody>
                  {out.data.rows.slice(0, 100).map((r) => (
                    <tr key={r.studentId} className="border-b border-border last:border-0">
                      <Td>{r.name}<span className="block text-xs text-muted-foreground">{r.admissionNo}</span></Td><Td>{r.className}</Td>
                      <Td className="text-right">{inr(r.balancePaise)}</Td><Td className={`text-right ${r.overduePaise ? 'font-medium text-danger' : ''}`}>{inr(r.overduePaise)}</Td><Td>{r.oldestDue}</Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            ) : <Alert tone="success">No dues.</Alert>}
          </>
        ) : null}
      </Card>

      {can('payments:read') ? <DayClose /> : null}
    </div>
  );
}

function DayClose() {
  const { me, can } = useAuth();
  const qc = useQueryClient();
  const [date, setDate] = useState(todayInIndia());
  const [counted, setCounted] = useState('');
  const [note, setNote] = useState('');
  const closings = useQuery({ queryKey: ['day-closings', me?.activeMembershipId], queryFn: async () => (await get<Closing[]>('/fees/day-closings')).data });
  const close = useMutation({
    mutationFn: async () => post('/fees/day-closings', { date, ...(counted ? { countedCashPaise: parseRupees(counted) ?? 0 } : {}), ...(note ? { note } : {}) }),
    onSuccess: async () => { setCounted(''); setNote(''); await qc.invalidateQueries({ queryKey: ['day-closings'] }); },
  });
  const reopen = useMutation({ mutationFn: async (d: string) => post('/fees/day-closings/reopen', { date: d, reason: window.prompt('Reason for re-opening?') || 'not given' }), onSuccess: () => qc.invalidateQueries({ queryKey: ['day-closings'] }) });
  return (
    <Card className="space-y-3 p-4">
      <h2 className="font-medium">Day close</h2>
      <p className="text-sm text-muted-foreground">Closing a day locks it: no more payments can be dated that day unless an owner re-opens it.</p>
      {can('payments:create') ? (
        <form className="grid gap-2 sm:grid-cols-[170px_170px_1fr_auto]" onSubmit={(e) => { e.preventDefault(); close.mutate(); }}>
          <Field label="Date" htmlFor="dc-date"><Input id="dc-date" type="date" max={todayInIndia()} value={date} onChange={(e) => setDate(e.target.value)} /></Field>
          <Field label="Cash counted (₹)" htmlFor="dc-cash"><Input id="dc-cash" inputMode="decimal" value={counted} onChange={(e) => setCounted(e.target.value)} /></Field>
          <Field label="Note" htmlFor="dc-note"><Input id="dc-note" maxLength={300} value={note} onChange={(e) => setNote(e.target.value)} /></Field>
          <div className="self-end"><Button type="submit" disabled={close.isPending} data-testid="close-day">Close day</Button></div>
        </form>
      ) : null}
      {close.error ? <Alert>{errorText(close.error)}</Alert> : null}
      {reopen.error ? <Alert>{errorText(reopen.error)}</Alert> : null}
      {(closings.data ?? []).length > 0 ? (
        <Table minWidth={560}>
          <thead className="border-b border-border"><tr><Th>Date</Th><Th className="text-right">Cash</Th><Th className="text-right">Non-cash</Th><Th className="text-right">Counted</Th><Th>Status</Th><Th /></tr></thead>
          <tbody>
            {(closings.data ?? []).map((c) => {
              const diff = c.countedCashPaise !== null ? c.countedCashPaise - c.cashTotalPaise : null;
              return (
                <tr key={c.id} className="border-b border-border last:border-0">
                  <Td>{c.date}</Td><Td className="text-right">{inr(c.cashTotalPaise)}</Td><Td className="text-right">{inr(c.nonCashTotalPaise)}</Td>
                  <Td className={`text-right ${diff ? 'text-danger' : ''}`}>{inr(c.countedCashPaise)}{diff ? ` (${diff > 0 ? '+' : ''}${inr(diff)})` : ''}</Td>
                  <Td><Badge tone={c.reopened ? 'muted' : 'success'}>{c.reopened ? 're-opened' : 'closed'}</Badge></Td>
                  <Td className="text-right">{!c.reopened && can('fees.config:approve') ? <Button size="sm" variant="ghost" onClick={() => reopen.mutate(c.date)}>Re-open</Button> : null}</Td>
                </tr>
              );
            })}
          </tbody>
        </Table>
      ) : null}
    </Card>
  );
}
