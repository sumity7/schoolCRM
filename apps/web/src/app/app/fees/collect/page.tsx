'use client';

import { useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, Printer, Search } from 'lucide-react';
import { PAYMENT_MODES, allocateOldestFirst, amountInWords, parseRupees, type PaymentMode } from '@edunex/shared';
import { errorText, get, newIdempotencyKey, post } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { MODE_LABEL, inr, invoiceTone, openReceipt, type Payment, type StudentFeeSummary } from '@/lib/fees';
import type { StudentRow } from '@/lib/students';
import { Alert, Badge, Button, Card, Field, Input, PageHeader, Select, Skeleton, Table, Td, Th } from '@/components/ui/primitives';
import { Modal } from '@/components/ui/modal';

const todayInIndia = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date());

export default function CollectPage() {
  return (
    <Suspense fallback={<Skeleton className="mx-auto h-40 max-w-4xl" />}>
      <Collect />
    </Suspense>
  );
}

function Collect() {
  const params = useSearchParams();
  const { me } = useAuth();
  const qc = useQueryClient();
  const [q, setQ] = useState('');
  const [studentId, setStudentId] = useState<string | null>(params.get('studentId'));
  const [amount, setAmount] = useState('');
  const [mode, setMode] = useState<PaymentMode>('cash');
  const [reference, setReference] = useState('');
  const [paidOn, setPaidOn] = useState(todayInIndia());
  const [note, setNote] = useState('');
  const [keepAdvance, setKeepAdvance] = useState(false);
  const [confirmKey, setConfirmKey] = useState<string | null>(null);
  const [done, setDone] = useState<Payment | null>(null);
  const [printError, setPrintError] = useState<string | null>(null);

  const search = useQuery({
    queryKey: ['fee-search', me?.activeMembershipId, q],
    enabled: q.trim().length >= 2,
    queryFn: async () => (await get<StudentRow[]>(`/students?q=${encodeURIComponent(q.trim())}&limit=8&status=active`)).data,
  });
  const summary = useQuery({
    queryKey: ['fee-summary', me?.activeMembershipId, studentId],
    enabled: Boolean(studentId),
    queryFn: async () => (await get<StudentFeeSummary>(`/fees/students/${studentId}/summary`)).data,
  });
  const s = summary.data;
  const open = useMemo(() => (s?.invoices ?? []).filter((i) => i.status === 'open' || i.status === 'partially_paid'), [s]);

  useEffect(() => {
    if (s) setAmount(s.totals.balancePaise > 0 ? (s.totals.balancePaise / 100).toFixed(2) : '');
  }, [s]);

  const amountPaise = parseRupees(amount);
  const preview = useMemo(() => {
    if (!amountPaise || amountPaise <= 0) return null;
    return allocateOldestFirst(open.map((i) => ({ id: i.id, dueDate: i.dueDate, balancePaise: i.balancePaise })), amountPaise);
  }, [amountPaise, open]);
  const needsRef = mode === 'cheque' || mode === 'bank_transfer';
  const overpay = (preview?.remainderPaise ?? 0) > 0;
  const formError = !amountPaise || amountPaise <= 0 ? 'Enter the amount received' : needsRef && !reference.trim() ? `Enter the ${mode === 'cheque' ? 'cheque number' : 'UTR / transaction id'}` : overpay && !keepAdvance ? `This is ${inr(preview!.remainderPaise)} more than the dues — tick "keep as advance" or reduce the amount` : null;

  const record = useMutation({
    mutationFn: async () => (await post<{ payment: Payment }>('/fees/payments', {
      studentId, amountPaise, mode, paidOn, ...(reference.trim() ? { reference: reference.trim() } : {}), ...(note.trim() ? { note: note.trim() } : {}), ...(overpay ? { keepAdvance: true } : {}),
    }, { idempotencyKey: confirmKey! })).data,
    onSuccess: async (r) => {
      setDone(r.payment);
      setConfirmKey(null);
      await qc.invalidateQueries({ queryKey: ['fee-summary'] });
    },
  });

  function choose(id: string) {
    setStudentId(id);
    setQ('');
    setDone(null);
    setReference('');
    setNote('');
    setKeepAdvance(false);
    record.reset();
  }

  return (
    <div className="mx-auto max-w-4xl space-y-4">
      <PageHeader title="Collect fee" description="Find the student, check the dues, record the payment and print the receipt." />
      <Card className="p-3">
        <div className="relative">
          <Search className="absolute left-3 top-3.5 h-4 w-4 text-muted-foreground" aria-hidden />
          <Input className="pl-9" placeholder="Student name, admission number or phone" aria-label="Find student" value={q} onChange={(e) => setQ(e.target.value)} data-testid="fee-student-search" autoFocus />
        </div>
        {search.data && q.trim().length >= 2 ? (
          <ul className="mt-2 divide-y divide-border rounded-lg border border-border" role="listbox" aria-label="Matching students">
            {search.data.length === 0 ? <li className="p-3 text-sm text-muted-foreground">No active student matches.</li> : null}
            {search.data.map((st) => (
              <li key={st.id}>
                <button type="button" className="flex min-h-11 w-full items-center justify-between gap-2 px-3 text-left text-sm hover:bg-muted" onClick={() => choose(st.id)} data-testid={`pick-${st.admissionNo}`}>
                  <span className="font-medium">{st.firstName} {st.lastName}</span><span className="text-muted-foreground">{st.admissionNo}</span>
                </button>
              </li>
            ))}
          </ul>
        ) : null}
      </Card>

      {summary.isLoading && studentId ? <Skeleton className="h-48" /> : null}
      {summary.error ? <Alert>{errorText(summary.error)}</Alert> : null}

      {done ? (
        <Card className="space-y-3 border-success/40 p-4" data-testid="payment-done">
          <div className="flex items-center gap-2 text-success"><CheckCircle2 className="h-5 w-5" aria-hidden /><span className="font-semibold">Payment recorded</span></div>
          <p className="text-sm">Receipt <span className="font-mono font-semibold" data-testid="receipt-no">{done.receiptNo}</span> · {inr(done.amountPaise)} · {MODE_LABEL[done.mode]}</p>
          {printError ? <Alert>{printError}</Alert> : null}
          <div className="flex flex-wrap gap-2">
            <Button onClick={() => { setPrintError(null); openReceipt(done.id).catch((e) => setPrintError(errorText(e))); }} data-testid="print-receipt"><Printer className="h-4 w-4" aria-hidden /> Print receipt</Button>
            <Button variant="outline" onClick={() => { setDone(null); setStudentId(null); }}>Collect from another student</Button>
          </div>
        </Card>
      ) : null}

      {s && !done ? (
        <>
          <Card className="p-4">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div>
                <h2 className="text-lg font-semibold" data-testid="fee-student-name">{s.student.name}</h2>
                <p className="text-sm text-muted-foreground">{s.student.admissionNo}{s.className ? ` · ${s.className}` : ''}</p>
              </div>
              <div className="grid grid-cols-3 gap-3 text-right text-sm">
                <div><p className="text-xs text-muted-foreground">Balance</p><p className="text-lg font-semibold" data-testid="fee-balance">{inr(s.totals.balancePaise)}</p></div>
                <div><p className="text-xs text-muted-foreground">Overdue</p><p className={`text-lg font-semibold ${s.totals.overduePaise ? 'text-danger' : ''}`}>{inr(s.totals.overduePaise)}</p></div>
                <div><p className="text-xs text-muted-foreground">Advance</p><p className="text-lg font-semibold">{inr(s.totals.advanceCreditPaise)}</p></div>
              </div>
            </div>
          </Card>

          {open.length === 0 ? <Alert tone="info">No dues. Payments can still be kept as advance credit.</Alert> : (
            <Table minWidth={560} testId="open-invoices">
              <thead className="border-b border-border"><tr><Th>Invoice</Th><Th>Instalment</Th><Th>Due</Th><Th className="text-right">Total</Th><Th className="text-right">Paid</Th><Th className="text-right">Balance</Th></tr></thead>
              <tbody>
                {open.map((i) => (
                  <tr key={i.id} className="border-b border-border last:border-0">
                    <Td className="font-mono text-xs">{i.invoiceNo}</Td><Td>{i.installmentLabel} <Badge tone={invoiceTone(i.status)}>{i.status.replace('_', ' ')}</Badge></Td>
                    <Td className={i.dueDate < todayInIndia() ? 'text-danger' : ''}>{i.dueDate}</Td>
                    <Td className="text-right">{inr(i.totalPaise)}</Td><Td className="text-right">{inr(i.paidPaise)}</Td><Td className="text-right font-medium">{inr(i.balancePaise)}</Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}

          <Card className="p-4">
            <form className="grid gap-3 sm:grid-cols-2" onSubmit={(e) => { e.preventDefault(); if (!formError) setConfirmKey(newIdempotencyKey()); }}>
              <Field label="Amount received (₹)" htmlFor="amount"><Input id="amount" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} data-testid="fee-amount" /></Field>
              <Field label="Mode" htmlFor="mode">
                <Select id="mode" value={mode} onChange={(e) => setMode(e.target.value as PaymentMode)} data-testid="fee-mode">
                  {PAYMENT_MODES.map((m) => <option key={m} value={m}>{MODE_LABEL[m]}</option>)}
                </Select>
              </Field>
              <Field label={needsRef ? `${mode === 'cheque' ? 'Cheque no.' : 'UTR / transaction id'} *` : 'Reference (optional)'} htmlFor="ref"><Input id="ref" maxLength={80} value={reference} onChange={(e) => setReference(e.target.value)} /></Field>
              <Field label="Date received" htmlFor="paidOn"><Input id="paidOn" type="date" max={todayInIndia()} value={paidOn} onChange={(e) => setPaidOn(e.target.value)} /></Field>
              <div className="sm:col-span-2"><Field label="Note (optional)" htmlFor="note"><Input id="note" maxLength={300} value={note} onChange={(e) => setNote(e.target.value)} /></Field></div>
              {overpay ? (
                <label className="flex min-h-11 items-center gap-2 text-sm sm:col-span-2"><input type="checkbox" className="h-5 w-5" checked={keepAdvance} onChange={(e) => setKeepAdvance(e.target.checked)} data-testid="keep-advance" /> Keep the extra {inr(preview!.remainderPaise)} as advance for future fees</label>
              ) : null}
              {amountPaise ? <p className="text-sm text-muted-foreground sm:col-span-2">{amountInWords(amountPaise)}</p> : null}
              {formError && amount ? <div className="sm:col-span-2"><Alert tone="info">{formError}</Alert></div> : null}
              <div className="sm:col-span-2"><Button type="submit" className="w-full sm:w-auto" disabled={Boolean(formError)} data-testid="fee-review">Review payment</Button></div>
            </form>
          </Card>

          {s.payments.length > 0 ? (
            <section className="space-y-2">
              <h2 className="font-medium">Earlier payments</h2>
              <Table minWidth={520}>
                <thead className="border-b border-border"><tr><Th>Date</Th><Th>Receipt</Th><Th className="text-right">Amount</Th><Th>Mode</Th><Th /></tr></thead>
                <tbody>
                  {s.payments.slice(0, 10).map((p) => (
                    <tr key={p.id} className="border-b border-border last:border-0">
                      <Td>{p.paidOn}</Td><Td className="font-mono text-xs">{p.receiptNo} {p.status === 'reversed' ? <Badge tone="danger">reversed</Badge> : null}</Td>
                      <Td className="text-right">{inr(p.amountPaise)}</Td><Td>{MODE_LABEL[p.mode]}</Td>
                      <Td className="text-right"><Button size="sm" variant="ghost" onClick={() => openReceipt(p.id).catch((e) => setPrintError(errorText(e)))} aria-label={`Print ${p.receiptNo}`}><Printer className="h-4 w-4" /></Button></Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            </section>
          ) : null}
        </>
      ) : null}

      {confirmKey && s && preview ? (
        <Modal open onOpenChange={(o) => { if (!o && !record.isPending) setConfirmKey(null); }} title="Confirm payment" description={`${s.student.name} · ${s.student.admissionNo}`}>
          <div className="space-y-3 text-sm">
            <p className="text-2xl font-semibold" data-testid="confirm-amount">{inr(amountPaise!)}</p>
            <p className="text-muted-foreground">{amountInWords(amountPaise!)} · {MODE_LABEL[mode]}{reference ? ` · ${reference}` : ''} · {paidOn}</p>
            <ul className="divide-y divide-border rounded-lg border border-border">
              {preview.allocations.map((a) => { const inv = open.find((i) => i.id === a.id)!; return <li key={a.id} className="flex justify-between p-2"><span>{inv.invoiceNo} · {inv.installmentLabel}</span><span>{inr(a.amountPaise)}</span></li>; })}
              {preview.remainderPaise > 0 ? <li className="flex justify-between p-2"><span>Advance credit</span><span>{inr(preview.remainderPaise)}</span></li> : null}
            </ul>
            {record.error ? <Alert>{errorText(record.error)}</Alert> : null}
            <div className="flex gap-2">
              <Button onClick={() => record.mutate()} disabled={record.isPending} data-testid="fee-confirm">{record.isPending ? 'Saving…' : 'Record payment'}</Button>
              <Button variant="ghost" onClick={() => setConfirmKey(null)} disabled={record.isPending}>Back</Button>
            </div>
          </div>
        </Modal>
      ) : null}
    </div>
  );
}
