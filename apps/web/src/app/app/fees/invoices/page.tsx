'use client';

import Link from 'next/link';
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { parseRupees } from '@edunex/shared';
import { errorText, get, newIdempotencyKey, post } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { inr, invoiceTone, type FeeStructure, type Invoice } from '@/lib/fees';
import { sectionLabel, sortSections, useClasses, useSections } from '@/lib/lookups';
import { Alert, Badge, Button, Field, Input, PageHeader, Select, Skeleton, Table, Td, Th } from '@/components/ui/primitives';
import { Modal } from '@/components/ui/modal';

interface InvoiceDetail extends Invoice { allocations: Array<{ receiptNo?: string; amountPaise: number; active: boolean }>; ledger: Array<{ type: string; amountPaise: number; occurredOn: string; memo: string | null }> }

export default function InvoicesPage() {
  const { me, can } = useAuth();
  const [status, setStatus] = useState('');
  const [sectionId, setSectionId] = useState('');
  const [overdue, setOverdue] = useState(false);
  const [page, setPage] = useState(1);
  const [genOpen, setGenOpen] = useState(false);
  const [detail, setDetail] = useState<string | null>(null);
  const sections = useSections();
  const secBy = new Map((sections.data ?? []).map((s) => [s.id, s]));
  const p = new URLSearchParams({ page: String(page), limit: '25' });
  if (status) p.set('status', status);
  if (sectionId) p.set('sectionId', sectionId);
  if (overdue) p.set('overdue', 'true');
  const list = useQuery({ queryKey: ['invoices', me?.activeMembershipId, p.toString()], queryFn: async () => get<Invoice[]>(`/fees/invoices?${p}`), placeholderData: (x) => x });
  const meta = list.data?.meta;

  return (
    <div className="mx-auto max-w-5xl space-y-4">
      <PageHeader title="Invoices" description="Bill an instalment to a class or section. Running it again never bills a student twice." actions={can('invoices:create') ? <Button onClick={() => setGenOpen(true)} data-testid="generate-invoices">Bill an instalment</Button> : null} />
      <div className="grid gap-2 sm:grid-cols-[200px_200px_auto]">
        <Select aria-label="Status" value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }}>
          <option value="">Any status</option><option value="open">Unpaid</option><option value="partially_paid">Partly paid</option><option value="paid">Paid</option><option value="void">Void</option>
        </Select>
        <Select aria-label="Section" value={sectionId} onChange={(e) => { setSectionId(e.target.value); setPage(1); }}>
          <option value="">All classes</option>
          {sortSections(sections.data ?? []).map((s) => <option key={s.id} value={s.id}>{sectionLabel(s)}</option>)}
        </Select>
        <label className="flex min-h-11 items-center gap-2 text-sm"><input type="checkbox" className="h-5 w-5" checked={overdue} onChange={(e) => { setOverdue(e.target.checked); setPage(1); }} /> Overdue only</label>
      </div>
      {list.isLoading ? <Skeleton className="h-40" /> : null}
      {list.error ? <Alert>{errorText(list.error)}</Alert> : null}
      {list.data && list.data.data.length === 0 ? <Alert tone="info">No invoices match.</Alert> : null}
      {list.data && list.data.data.length > 0 ? (
        <Table minWidth={760} testId="invoices-table">
          <thead className="border-b border-border"><tr><Th>Invoice</Th><Th>Student</Th><Th>Class</Th><Th>Instalment</Th><Th>Due</Th><Th className="text-right">Total</Th><Th className="text-right">Balance</Th><Th>Status</Th></tr></thead>
          <tbody>
            {list.data.data.map((i) => (
              <tr key={i.id} className="border-b border-border last:border-0 hover:bg-muted/50">
                <Td><button className="font-mono text-xs text-primary hover:underline" onClick={() => setDetail(i.id)}>{i.invoiceNo}</button></Td>
                <Td><Link href={`/app/students/${i.studentId}`} className="hover:underline">{i.student?.name ?? '—'}</Link><span className="block text-xs text-muted-foreground">{i.student?.admissionNo}</span></Td>
                <Td>{secBy.get(i.sectionId) ? sectionLabel(secBy.get(i.sectionId)!) : '—'}</Td>
                <Td>{i.installmentLabel}</Td><Td>{i.dueDate}</Td>
                <Td className="text-right">{inr(i.totalPaise)}</Td><Td className="text-right font-medium">{inr(i.balancePaise)}</Td>
                <Td><Badge tone={invoiceTone(i.status)}>{i.status.replace('_', ' ')}</Badge></Td>
              </tr>
            ))}
          </tbody>
        </Table>
      ) : null}
      {meta && meta.totalPages > 1 ? (
        <div className="flex items-center justify-between text-sm">
          <span className="text-muted-foreground">{meta.total} invoices · page {meta.page} of {meta.totalPages}</span>
          <div className="flex gap-2"><Button size="sm" variant="outline" disabled={page <= 1} onClick={() => setPage(page - 1)}>Previous</Button><Button size="sm" variant="outline" disabled={page >= meta.totalPages} onClick={() => setPage(page + 1)}>Next</Button></div>
        </div>
      ) : null}
      {genOpen ? <GenerateModal onClose={() => setGenOpen(false)} /> : null}
      {detail ? <InvoiceModal id={detail} onClose={() => setDetail(null)} /> : null}
    </div>
  );
}

function GenerateModal({ onClose }: { onClose: () => void }) {
  const { me } = useAuth();
  const qc = useQueryClient();
  const classes = useClasses();
  const sections = useSections();
  const structures = useQuery({ queryKey: ['fee-structures', me?.activeMembershipId, 'published'], queryFn: async () => (await get<FeeStructure[]>('/fees/structures?status=published')).data });
  const clsName = new Map((classes.data ?? []).map((c) => [c.id, c.name]));
  const [structureId, setStructureId] = useState('');
  const [label, setLabel] = useState('');
  const [sectionId, setSectionId] = useState('');
  const [key] = useState(newIdempotencyKey);
  const st = structures.data?.find((s) => s.id === structureId);
  const m = useMutation({
    mutationFn: async () => (await post<{ created: number; skipped: number; students: number; totalBilledPaise: number }>('/fees/invoices/generate', { structureId, installmentLabel: label, ...(sectionId ? { sectionId } : {}) }, { idempotencyKey: `${key}-${structureId}-${label}-${sectionId}` })).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['invoices'] }),
  });
  return (
    <Modal open onOpenChange={(o) => { if (!o) onClose(); }} title="Bill an instalment" description="Creates one invoice per active student of the class (or section). Approved concessions and advance credit are applied automatically.">
      {m.data ? (
        <div className="space-y-3">
          <Alert tone="success"><span data-testid="generate-result">{m.data.created} invoices created ({inr(m.data.totalBilledPaise)}); {m.data.skipped} already billed.</span></Alert>
          <Button onClick={onClose}>Done</Button>
        </div>
      ) : (
        <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); m.mutate(); }}>
          {structures.data && structures.data.length === 0 ? <Alert tone="info">Publish a fee structure first (Fee setup).</Alert> : null}
          <Field label="Fee structure" htmlFor="g-st">
            <Select id="g-st" required value={structureId} onChange={(e) => { setStructureId(e.target.value); setLabel(''); setSectionId(''); }}>
              <option value="">Choose</option>
              {(structures.data ?? []).map((s) => <option key={s.id} value={s.id}>{clsName.get(s.classId) ?? 'Class'} · {s.name} (v{s.version})</option>)}
            </Select>
          </Field>
          <Field label="Instalment" htmlFor="g-label">
            <Select id="g-label" required value={label} onChange={(e) => setLabel(e.target.value)} disabled={!st}>
              <option value="">Choose</option>
              {(st?.installmentLabels ?? []).map((l) => <option key={l} value={l}>{l} — {inr(st!.items.reduce((a, it) => a + (it.installments.find((x) => x.label === l)?.amountPaise ?? 0), 0))}</option>)}
            </Select>
          </Field>
          <Field label="Section (optional)" htmlFor="g-sec">
            <Select id="g-sec" value={sectionId} onChange={(e) => setSectionId(e.target.value)} disabled={!st}>
              <option value="">Whole class</option>
              {(sections.data ?? []).filter((s) => s.classId === st?.classId).map((s) => <option key={s.id} value={s.id}>{sectionLabel(s)}</option>)}
            </Select>
          </Field>
          {m.error ? <Alert>{errorText(m.error)}</Alert> : null}
          <Button type="submit" disabled={m.isPending || !structureId || !label} data-testid="generate-confirm">{m.isPending ? 'Billing…' : 'Create invoices'}</Button>
        </form>
      )}
    </Modal>
  );
}

function InvoiceModal({ id, onClose }: { id: string; onClose: () => void }) {
  const { me, can } = useAuth();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['invoice', me?.activeMembershipId, id], queryFn: async () => (await get<InvoiceDetail>(`/fees/invoices/${id}`)).data });
  const [action, setAction] = useState<'late' | 'adjust' | 'void' | null>(null);
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState('');
  const m = useMutation({
    mutationFn: async () => {
      if (action === 'void') return post(`/fees/invoices/${id}/void`, { reason });
      const raw = amount.trim();
      const neg = raw.startsWith('-');
      const v = parseRupees(neg ? raw.slice(1) : raw);
      if (!v) throw new Error('Enter an amount in rupees');
      return post(`/fees/invoices/${id}/${action === 'late' ? 'late-fee' : 'adjust'}`, { amountPaise: neg ? -v : v, reason });
    },
    onSuccess: async () => { setAction(null); setAmount(''); setReason(''); await qc.invalidateQueries({ queryKey: ['invoice'] }); await qc.invalidateQueries({ queryKey: ['invoices'] }); },
  });
  const i = q.data;
  return (
    <Modal open onOpenChange={(o) => { if (!o) onClose(); }} title={i ? `Invoice ${i.invoiceNo}` : 'Invoice'} description={i ? `${i.student?.name ?? ''} · ${i.installmentLabel} · due ${i.dueDate}` : undefined}>
      {!i ? <Skeleton className="h-40" /> : (
        <div className="space-y-3 text-sm">
          <ul className="divide-y divide-border rounded-lg border border-border">
            {i.lines.map((l, k) => <li key={k} className="flex justify-between p-2"><span>{l.description}</span><span>{inr(l.amountPaise)}</span></li>)}
            {i.concessionLines.map((l, k) => <li key={`c${k}`} className="flex justify-between p-2 text-success"><span>{l.description}</span><span>−{inr(l.amountPaise)}</span></li>)}
            <li className="flex justify-between p-2 font-medium"><span>Total / paid / balance</span><span>{inr(i.totalPaise)} / {inr(i.paidPaise)} / {inr(i.balancePaise)}</span></li>
          </ul>
          {i.voidReason ? <Alert tone="info">Void: {i.voidReason}</Alert> : null}
          <details>
            <summary className="cursor-pointer text-muted-foreground">Ledger ({i.ledger.length} entries)</summary>
            <ul className="mt-1 space-y-1 text-xs">
              {i.ledger.map((l, k) => <li key={k} className="flex justify-between gap-2"><span>{l.occurredOn} · {l.type.replace('_', ' ')}{l.memo ? ` · ${l.memo}` : ''}</span><span className="font-mono">{l.amountPaise > 0 ? '+' : ''}{inr(l.amountPaise)}</span></li>)}
            </ul>
          </details>
          {i.status !== 'void' ? (
            <div className="flex flex-wrap gap-2">
              {can('invoices:create') ? <Button size="sm" variant="outline" onClick={() => setAction('late')}>Late fee</Button> : null}
              {can('fees.config:approve') ? <Button size="sm" variant="outline" onClick={() => setAction('adjust')}>Adjust</Button> : null}
              {can('fees.config:approve') && i.paidPaise === 0 ? <Button size="sm" variant="danger" onClick={() => setAction('void')}>Void</Button> : null}
            </div>
          ) : null}
          {action ? (
            <form className="space-y-2 rounded-lg border border-border p-3" onSubmit={(e) => { e.preventDefault(); m.mutate(); }}>
              {action !== 'void' ? <Field label={action === 'late' ? 'Late fee (₹)' : 'Adjustment (₹, negative to reduce)'} htmlFor="adj-amt"><Input id="adj-amt" inputMode="decimal" required value={amount} onChange={(e) => setAmount(e.target.value)} /></Field> : null}
              <Field label="Reason" htmlFor="adj-reason"><Input id="adj-reason" required minLength={3} maxLength={300} value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
              {m.error ? <Alert>{m.error instanceof Error && !('status' in m.error) ? m.error.message : errorText(m.error)}</Alert> : null}
              <div className="flex gap-2"><Button type="submit" size="sm" disabled={m.isPending}>Save</Button><Button type="button" size="sm" variant="ghost" onClick={() => setAction(null)}>Cancel</Button></div>
            </form>
          ) : null}
        </div>
      )}
    </Modal>
  );
}

