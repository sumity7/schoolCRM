'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { PAYMENT_MODES } from '@edunex/shared';
import { errorText, get, post } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { MODE_LABEL, inr, type FinanceRequest } from '@/lib/fees';
import { Alert, Badge, Button, Card, Field, Input, PageHeader, Select, Skeleton, Table, Td, Th } from '@/components/ui/primitives';
import { Modal } from '@/components/ui/modal';

interface ConcessionRow { id: string; kind: string; valueType: 'percent' | 'flat'; value: number; reason: string; status: string; requestedBy: string; student?: { name: string; admissionNo: string } | null }
const todayInIndia = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date());

export default function ApprovalsPage() {
  const { me, can } = useAuth();
  const qc = useQueryClient();
  const [payOut, setPayOut] = useState<FinanceRequest | null>(null);
  const requests = useQuery({ queryKey: ['fee-requests', me?.activeMembershipId], queryFn: async () => (await get<FinanceRequest[]>('/fees/requests')).data });
  const concessions = useQuery({ queryKey: ['concessions', me?.activeMembershipId, 'pending_approval'], enabled: can('discounts:apply'), queryFn: async () => (await get<ConcessionRow[]>('/fees/concessions?status=pending_approval')).data });
  const decide = useMutation({
    mutationFn: async (v: { path: string }) => post(v.path, {}),
    onSuccess: async () => { await qc.invalidateQueries({ queryKey: ['fee-requests'] }); await qc.invalidateQueries({ queryKey: ['concessions'] }); },
  });
  const mine = (requestedBy: string) => requestedBy === me?.activeMembershipId;
  const canApprove = can('refunds:approve');
  const pending = (requests.data ?? []).filter((r) => r.status === 'requested');
  const toPay = (requests.data ?? []).filter((r) => r.kind === 'refund' && r.status === 'approved');
  const history = (requests.data ?? []).filter((r) => r.status !== 'requested' && !(r.kind === 'refund' && r.status === 'approved')).slice(0, 30);

  return (
    <div className="mx-auto max-w-5xl space-y-4">
      <PageHeader title="Approvals" description="Reversals, refunds and large concessions need a second person. You can never approve your own request." />
      {decide.error ? <Alert>{errorText(decide.error)}</Alert> : null}
      {requests.isLoading ? <Skeleton className="h-24" /> : null}

      <section className="space-y-2">
        <h2 className="font-medium">Waiting for a decision</h2>
        {pending.length === 0 && (concessions.data ?? []).length === 0 ? <Alert tone="info">Nothing is waiting.</Alert> : null}
        {pending.length > 0 ? (
          <Table minWidth={680} testId="pending-requests">
            <thead className="border-b border-border"><tr><Th>Type</Th><Th>Student</Th><Th>Receipt</Th><Th className="text-right">Amount</Th><Th>Reason</Th><Th /></tr></thead>
            <tbody>
              {pending.map((r) => (
                <tr key={r.id} className="border-b border-border last:border-0">
                  <Td><Badge tone={r.kind === 'reversal' ? 'danger' : 'warning'}>{r.kind}</Badge></Td>
                  <Td>{r.student?.name}<span className="block text-xs text-muted-foreground">{r.student?.admissionNo}</span></Td>
                  <Td className="font-mono text-xs">{r.receiptNo ?? '—'}</Td><Td className="text-right">{inr(r.amountPaise)}</Td><Td className="max-w-56 break-words">{r.reason}</Td>
                  <Td className="whitespace-nowrap text-right">
                    {canApprove && !mine(r.requestedBy) ? (
                      <div className="flex justify-end gap-1">
                        <Button size="sm" disabled={decide.isPending} onClick={() => { if (window.confirm(r.kind === 'reversal' ? 'Reverse this payment? Balances return and the receipt is cancelled.' : 'Approve this refund?')) decide.mutate({ path: `/fees/requests/${r.id}/approve` }); }} data-testid={`approve-${r.id}`}>Approve</Button>
                        <Button size="sm" variant="outline" disabled={decide.isPending} onClick={() => decide.mutate({ path: `/fees/requests/${r.id}/reject` })}>Reject</Button>
                      </div>
                    ) : <span className="text-xs text-muted-foreground">{mine(r.requestedBy) ? 'your request' : 'awaiting owner'}</span>}
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        ) : null}
        {(concessions.data ?? []).length > 0 ? (
          <Card className="divide-y divide-border">
            {(concessions.data ?? []).map((c) => (
              <div key={c.id} className="flex flex-wrap items-center justify-between gap-2 p-3 text-sm">
                <span><Badge tone="warning">concession</Badge> <strong>{c.student?.name}</strong> · {c.kind.replace('_', ' ')} · {c.valueType === 'percent' ? `${c.value / 100}%` : inr(c.value)} · {c.reason}</span>
                {can('discounts:approve') && !mine(c.requestedBy) ? (
                  <span className="flex gap-1">
                    <Button size="sm" disabled={decide.isPending} onClick={() => decide.mutate({ path: `/fees/concessions/${c.id}/approve` })}>Approve</Button>
                    <Button size="sm" variant="outline" disabled={decide.isPending} onClick={() => decide.mutate({ path: `/fees/concessions/${c.id}/reject` })}>Reject</Button>
                  </span>
                ) : <span className="text-xs text-muted-foreground">awaiting owner</span>}
              </div>
            ))}
          </Card>
        ) : null}
      </section>

      {toPay.length > 0 ? (
        <section className="space-y-2">
          <h2 className="font-medium">Approved refunds to pay out</h2>
          <Card className="divide-y divide-border">
            {toPay.map((r) => (
              <div key={r.id} className="flex flex-wrap items-center justify-between gap-2 p-3 text-sm">
                <span><strong>{r.student?.name}</strong> · {inr(r.amountPaise)} · {r.reason}</span>
                {can('payments:create') ? <Button size="sm" onClick={() => setPayOut(r)}>Mark paid</Button> : null}
              </div>
            ))}
          </Card>
        </section>
      ) : null}

      {history.length > 0 ? (
        <section className="space-y-2">
          <h2 className="font-medium">Recent decisions</h2>
          <Table minWidth={560}>
            <thead className="border-b border-border"><tr><Th>Type</Th><Th>Student</Th><Th className="text-right">Amount</Th><Th>Status</Th><Th>Note</Th></tr></thead>
            <tbody>
              {history.map((r) => (
                <tr key={r.id} className="border-b border-border last:border-0">
                  <Td className="capitalize">{r.kind}</Td><Td>{r.student?.name}</Td><Td className="text-right">{inr(r.amountPaise)}</Td>
                  <Td><Badge tone={r.status === 'rejected' ? 'muted' : 'success'}>{r.status}</Badge></Td><Td>{r.decisionNote ?? ''}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        </section>
      ) : null}
      {payOut ? <PayOutModal req={payOut} onClose={() => setPayOut(null)} /> : null}
    </div>
  );
}

function PayOutModal({ req, onClose }: { req: FinanceRequest; onClose: () => void }) {
  const qc = useQueryClient();
  const [f, setF] = useState({ paidOn: todayInIndia(), mode: 'cash', reference: '' });
  const m = useMutation({ mutationFn: async () => post(`/fees/requests/${req.id}/mark-paid`, { paidOn: f.paidOn, mode: f.mode, ...(f.reference ? { reference: f.reference } : {}) }), onSuccess: async () => { await qc.invalidateQueries({ queryKey: ['fee-requests'] }); onClose(); } });
  return (
    <Modal open onOpenChange={(o) => { if (!o) onClose(); }} title={`Pay out ${inr(req.amountPaise)}`} description={req.student?.name ?? undefined}>
      <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); m.mutate(); }}>
        <Field label="Date paid" htmlFor="po-date"><Input id="po-date" type="date" max={todayInIndia()} value={f.paidOn} onChange={(e) => setF({ ...f, paidOn: e.target.value })} /></Field>
        <Field label="Mode" htmlFor="po-mode"><Select id="po-mode" value={f.mode} onChange={(e) => setF({ ...f, mode: e.target.value })}>{PAYMENT_MODES.map((x) => <option key={x} value={x}>{MODE_LABEL[x]}</option>)}</Select></Field>
        <Field label="Reference (optional)" htmlFor="po-ref"><Input id="po-ref" maxLength={80} value={f.reference} onChange={(e) => setF({ ...f, reference: e.target.value })} /></Field>
        {m.error ? <Alert>{errorText(m.error)}</Alert> : null}
        <Button type="submit" disabled={m.isPending}>Record payout</Button>
      </form>
    </Modal>
  );
}
