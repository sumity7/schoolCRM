'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CONCESSION_KINDS, parseRupees } from '@edunex/shared';
import { errorText, get, post } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { inr, type FeeCategory } from '@/lib/fees';
import type { StudentRow } from '@/lib/students';
import { Alert, Badge, Button, Field, Input, PageHeader, Select, Skeleton, Table, Td, Th } from '@/components/ui/primitives';
import { Modal } from '@/components/ui/modal';

interface ConcessionRow { id: string; studentId: string; kind: string; valueType: 'percent' | 'flat'; value: number; categoryId: string | null; reason: string; status: string; student?: { name: string; admissionNo: string } | null }
const concessionValue = (c: Pick<ConcessionRow, 'valueType' | 'value'>) => (c.valueType === 'percent' ? `${c.value / 100}%` : `${inr(c.value)} per invoice`);

export default function ConcessionsPage() {
  const { me, can } = useAuth();
  const qc = useQueryClient();
  const [status, setStatus] = useState('');
  const [open, setOpen] = useState(false);
  const list = useQuery({ queryKey: ['concessions', me?.activeMembershipId, status], queryFn: async () => (await get<ConcessionRow[]>(`/fees/concessions${status ? `?status=${status}` : ''}`)).data });
  const cats = useQuery({ queryKey: ['fee-cats', me?.activeMembershipId], enabled: can('fees.config:read'), queryFn: async () => (await get<FeeCategory[]>('/fees/categories')).data });
  const catName = new Map((cats.data ?? []).map((c) => [c.id, c.name]));
  const revoke = useMutation({ mutationFn: async (id: string) => post(`/fees/concessions/${id}/revoke`, { reason: 'Revoked from the concessions screen' }), onSuccess: () => qc.invalidateQueries({ queryKey: ['concessions'] }) });

  return (
    <div className="mx-auto max-w-5xl space-y-4">
      <PageHeader title="Concessions" description="Scholarships, sibling and staff-ward discounts. They apply to invoices billed after approval." actions={<Button onClick={() => setOpen(true)} data-testid="new-concession">Grant concession</Button>} />
      <Select aria-label="Status" className="max-w-56" value={status} onChange={(e) => setStatus(e.target.value)}>
        <option value="">All</option><option value="pending_approval">Waiting for approval</option><option value="approved">Approved</option><option value="rejected">Rejected</option><option value="revoked">Revoked</option>
      </Select>
      {revoke.error ? <Alert>{errorText(revoke.error)}</Alert> : null}
      {list.isLoading ? <Skeleton className="h-24" /> : null}
      {list.data && list.data.length === 0 ? <Alert tone="info">No concessions.</Alert> : null}
      {list.data && list.data.length > 0 ? (
        <Table minWidth={640} testId="concessions-table">
          <thead className="border-b border-border"><tr><Th>Student</Th><Th>Kind</Th><Th>Value</Th><Th>Applies to</Th><Th>Reason</Th><Th>Status</Th><Th /></tr></thead>
          <tbody>
            {list.data.map((c) => (
              <tr key={c.id} className="border-b border-border last:border-0">
                <Td>{c.student?.name}<span className="block text-xs text-muted-foreground">{c.student?.admissionNo}</span></Td>
                <Td className="capitalize">{c.kind.replace('_', ' ')}</Td><Td>{concessionValue(c)}</Td><Td>{c.categoryId ? catName.get(c.categoryId) ?? 'one fee head' : 'All fee heads'}</Td>
                <Td className="max-w-56 break-words">{c.reason}</Td>
                <Td><Badge tone={c.status === 'approved' ? 'success' : c.status === 'pending_approval' ? 'warning' : 'muted'}>{c.status.replace('_', ' ')}</Badge></Td>
                <Td className="text-right">{can('discounts:approve') && c.status === 'approved' ? <Button size="sm" variant="ghost" onClick={() => { if (window.confirm('Revoke? Invoices already issued keep the discount.')) revoke.mutate(c.id); }}>Revoke</Button> : null}</Td>
              </tr>
            ))}
          </tbody>
        </Table>
      ) : null}
      {open ? <GrantModal cats={cats.data ?? []} onClose={() => setOpen(false)} /> : null}
    </div>
  );
}

function GrantModal({ cats, onClose }: { cats: FeeCategory[]; onClose: () => void }) {
  const { me } = useAuth();
  const qc = useQueryClient();
  const [q, setQ] = useState('');
  const [student, setStudent] = useState<StudentRow | null>(null);
  const [f, setF] = useState({ kind: 'sibling', valueType: 'percent' as 'percent' | 'flat', value: '', categoryId: '', reason: '' });
  const search = useQuery({ queryKey: ['conc-search', me?.activeMembershipId, q], enabled: q.trim().length >= 2 && !student, queryFn: async () => (await get<StudentRow[]>(`/students?q=${encodeURIComponent(q.trim())}&limit=6&status=active`)).data });
  const m = useMutation({
    mutationFn: async () => {
      const value = f.valueType === 'percent' ? Math.round(Number(f.value) * 100) : parseRupees(f.value);
      if (!value || value <= 0) throw new Error('Enter a valid value');
      return (await post<ConcessionRow>('/fees/concessions', { studentId: student!.id, kind: f.kind, valueType: f.valueType, value, reason: f.reason.trim(), ...(f.categoryId ? { categoryId: f.categoryId } : {}) })).data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['concessions'] }),
  });
  return (
    <Modal open onOpenChange={(o) => { if (!o) onClose(); }} title="Grant concession" description="Within your school's limit it applies at once; above it, an owner must approve.">
      {m.data ? (
        <div className="space-y-3"><Alert tone={m.data.status === 'approved' ? 'success' : 'info'}>{m.data.status === 'approved' ? 'Concession approved — it applies to the next invoices billed.' : 'Sent for approval (above the automatic limit).'}</Alert><Button onClick={onClose}>Close</Button></div>
      ) : (
        <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); m.mutate(); }}>
          {student ? (
            <div className="flex items-center justify-between rounded-lg border border-border p-2 text-sm"><span>{student.firstName} {student.lastName} · {student.admissionNo}</span><Button type="button" size="sm" variant="ghost" onClick={() => setStudent(null)}>Change</Button></div>
          ) : (
            <>
              <Field label="Student" htmlFor="c-q"><Input id="c-q" placeholder="Name or admission number" value={q} onChange={(e) => setQ(e.target.value)} /></Field>
              <ul className="divide-y divide-border">{(search.data ?? []).map((s) => <li key={s.id}><button type="button" className="min-h-11 w-full text-left text-sm hover:bg-muted" onClick={() => setStudent(s)}>{s.firstName} {s.lastName} · {s.admissionNo}</button></li>)}</ul>
            </>
          )}
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Kind" htmlFor="c-kind"><Select id="c-kind" value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value })}>{CONCESSION_KINDS.map((k) => <option key={k} value={k}>{k.replace('_', ' ')}</option>)}</Select></Field>
            <Field label="Type" htmlFor="c-type"><Select id="c-type" value={f.valueType} onChange={(e) => setF({ ...f, valueType: e.target.value as 'percent' | 'flat' })}><option value="percent">Percentage</option><option value="flat">Fixed ₹ per invoice</option></Select></Field>
            <Field label={f.valueType === 'percent' ? 'Percent (%)' : 'Amount (₹)'} htmlFor="c-val"><Input id="c-val" required inputMode="decimal" value={f.value} onChange={(e) => setF({ ...f, value: e.target.value })} /></Field>
            <Field label="Applies to" htmlFor="c-cat"><Select id="c-cat" value={f.categoryId} onChange={(e) => setF({ ...f, categoryId: e.target.value })}><option value="">All fee heads</option>{cats.filter((c) => c.active).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</Select></Field>
          </div>
          <Field label="Reason" htmlFor="c-reason"><Input id="c-reason" required minLength={3} maxLength={300} value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })} /></Field>
          {m.error ? <Alert>{m.error instanceof Error && !('status' in m.error) ? m.error.message : errorText(m.error)}</Alert> : null}
          <Button type="submit" disabled={m.isPending || !student}>Save</Button>
        </form>
      )}
    </Modal>
  );
}
