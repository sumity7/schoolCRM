'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Printer } from 'lucide-react';
import { errorText, get, post } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { MODE_LABEL, inr, openReceipt, type Payment } from '@/lib/fees';
import { Alert, Badge, Button, Field, Input, PageHeader, Select, Skeleton, Table, Td, Th } from '@/components/ui/primitives';
import { Modal } from '@/components/ui/modal';

const todayInIndia = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date());

export default function PaymentsPage() {
  const { me, can } = useAuth();
  const [from, setFrom] = useState(todayInIndia());
  const [to, setTo] = useState(todayInIndia());
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);
  const [reverse, setReverse] = useState<Payment | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const p = new URLSearchParams({ page: String(page), limit: '25', from, to });
  if (status) p.set('status', status);
  const list = useQuery({ queryKey: ['payments', me?.activeMembershipId, p.toString()], queryFn: async () => get<Payment[]>(`/fees/payments?${p}`), placeholderData: (x) => x });
  const meta = list.data?.meta;

  return (
    <div className="mx-auto max-w-5xl space-y-4">
      <PageHeader title="Payments" description="Every receipt issued. Payments are never edited or deleted — mistakes and bounced cheques are reversed with a second person's approval." />
      <div className="grid gap-2 sm:grid-cols-[170px_170px_170px]">
        <Input type="date" aria-label="From" value={from} max={to} onChange={(e) => { setFrom(e.target.value); setPage(1); }} />
        <Input type="date" aria-label="To" value={to} min={from} max={todayInIndia()} onChange={(e) => { setTo(e.target.value); setPage(1); }} />
        <Select aria-label="Status" value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }}><option value="">All</option><option value="recorded">Valid</option><option value="reversed">Reversed</option></Select>
      </div>
      {err ? <Alert>{err}</Alert> : null}
      {list.isLoading ? <Skeleton className="h-40" /> : null}
      {list.error ? <Alert>{errorText(list.error)}</Alert> : null}
      {list.data && list.data.data.length === 0 ? <Alert tone="info">No payments in this period.</Alert> : null}
      {list.data && list.data.data.length > 0 ? (
        <Table minWidth={760} testId="payments-table">
          <thead className="border-b border-border"><tr><Th>Date</Th><Th>Receipt</Th><Th>Student</Th><Th className="text-right">Amount</Th><Th>Mode</Th><Th>By</Th><Th /></tr></thead>
          <tbody>
            {list.data.data.map((x) => (
              <tr key={x.id} className="border-b border-border last:border-0">
                <Td>{x.paidOn}</Td>
                <Td className="font-mono text-xs">{x.receiptNo} {x.status === 'reversed' ? <Badge tone="danger">reversed</Badge> : null}</Td>
                <Td>{x.student?.name}<span className="block text-xs text-muted-foreground">{x.student?.admissionNo}</span></Td>
                <Td className="text-right">{inr(x.amountPaise)}</Td>
                <Td>{MODE_LABEL[x.mode]}{x.reference ? <span className="block text-xs text-muted-foreground">{x.reference}</span> : null}</Td>
                <Td>{x.receivedByName}</Td>
                <Td className="whitespace-nowrap text-right">
                  {can('payments:print') ? <Button size="sm" variant="ghost" aria-label={`Print ${x.receiptNo}`} onClick={() => { setErr(null); openReceipt(x.id).catch((e) => setErr(errorText(e))); }}><Printer className="h-4 w-4" /></Button> : null}
                  {can('refunds:request') && x.status === 'recorded' ? <Button size="sm" variant="ghost" onClick={() => setReverse(x)}>Reverse…</Button> : null}
                </Td>
              </tr>
            ))}
          </tbody>
        </Table>
      ) : null}
      {meta && meta.totalPages > 1 ? (
        <div className="flex items-center justify-between text-sm">
          <span className="text-muted-foreground">{meta.total} payments · page {meta.page} of {meta.totalPages}</span>
          <div className="flex gap-2"><Button size="sm" variant="outline" disabled={page <= 1} onClick={() => setPage(page - 1)}>Previous</Button><Button size="sm" variant="outline" disabled={page >= meta.totalPages} onClick={() => setPage(page + 1)}>Next</Button></div>
        </div>
      ) : null}
      {reverse ? <ReverseModal payment={reverse} onClose={() => setReverse(null)} /> : null}
    </div>
  );
}

function ReverseModal({ payment, onClose }: { payment: Payment; onClose: () => void }) {
  const qc = useQueryClient();
  const [reason, setReason] = useState('');
  const m = useMutation({ mutationFn: async () => post(`/fees/payments/${payment.id}/reversal-requests`, { reason }), onSuccess: () => qc.invalidateQueries({ queryKey: ['fee-requests'] }) });
  return (
    <Modal open onOpenChange={(o) => { if (!o) onClose(); }} title={`Reverse ${payment.receiptNo}?`} description={`${inr(payment.amountPaise)} · ${payment.student?.name ?? ''}. Someone else must approve; the receipt will then print as CANCELLED.`}>
      {m.isSuccess ? (
        <div className="space-y-3"><Alert tone="success">Reversal requested. It appears under Fees → Approvals.</Alert><Button onClick={onClose}>Close</Button></div>
      ) : (
        <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); m.mutate(); }}>
          <Field label="Reason (e.g. cheque bounced, wrong student)" htmlFor="rv-reason"><Input id="rv-reason" required minLength={3} maxLength={300} value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
          {m.error ? <Alert>{errorText(m.error)}</Alert> : null}
          <Button type="submit" variant="danger" disabled={m.isPending}>Request reversal</Button>
        </form>
      )}
    </Modal>
  );
}
