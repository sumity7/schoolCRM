'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Trash2 } from 'lucide-react';
import { FEE_CATEGORY_KINDS, parseRupees, type FeePolicy } from '@edunex/shared';
import { del, errorText, get, patch, post } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { inr, type FeeCategory, type FeeStructure } from '@/lib/fees';
import { useClasses, useSessions } from '@/lib/lookups';
import { cn } from '@/lib/utils';
import { Alert, Badge, Button, Card, Field, Input, PageHeader, Select, Skeleton, Table, Td, Th } from '@/components/ui/primitives';
import { Modal } from '@/components/ui/modal';

type Tab = 'structures' | 'heads' | 'policy';

export default function FeeSetupPage() {
  const { me, can } = useAuth();
  const qc = useQueryClient();
  const [tab, setTab] = useState<Tab>('structures');
  const [editing, setEditing] = useState<FeeStructure | 'new' | null>(null);
  const [headOpen, setHeadOpen] = useState(false);
  const sessions = useSessions();
  const active = sessions.data?.find((s) => s.status === 'active');
  const classes = useClasses(Boolean(active));
  const cats = useQuery({ queryKey: ['fee-cats', me?.activeMembershipId], queryFn: async () => (await get<FeeCategory[]>('/fees/categories')).data });
  const structures = useQuery({ queryKey: ['fee-structures', me?.activeMembershipId], queryFn: async () => (await get<FeeStructure[]>('/fees/structures')).data });
  const refresh = () => qc.invalidateQueries({ queryKey: ['fee-structures'] });
  const act = useMutation({ mutationFn: async (v: { path: string; method?: 'post' | 'delete' }) => (v.method === 'delete' ? del(v.path) : post(v.path, {})), onSuccess: refresh });
  const clsName = new Map((classes.data ?? []).map((c) => [c.id, c.name]));
  const catName = new Map((cats.data ?? []).map((c) => [c.id, c.name]));

  return (
    <div className="mx-auto max-w-5xl space-y-4">
      <PageHeader title="Fee setup" description="Fee heads, class-wise fee structures with instalments, and receipt/concession rules. Published structures never change — revise them instead; issued invoices keep their amounts." />
      <div role="tablist" className="flex gap-1 border-b border-border">
        {([['structures', 'Fee structures'], ['heads', 'Fee heads'], ['policy', 'Policy']] as Array<[Tab, string]>).map(([k, l]) => (
          <button key={k} role="tab" aria-selected={tab === k} onClick={() => setTab(k)} className={cn('min-h-11 border-b-2 px-3 text-sm', tab === k ? 'border-primary font-medium' : 'border-transparent text-muted-foreground')}>{l}</button>
        ))}
      </div>
      {act.error ? <Alert>{errorText(act.error)}</Alert> : null}

      {tab === 'structures' ? (
        <div className="space-y-3">
          {!active ? <Alert tone="info">Activate an academic session first.</Alert> : null}
          {can('fees.config:create') && active ? <Button onClick={() => setEditing('new')} disabled={!cats.data?.some((c) => c.active)} data-testid="new-structure">New fee structure</Button> : null}
          {cats.data && !cats.data.length ? <Alert tone="info">Create fee heads first (tab “Fee heads”).</Alert> : null}
          {structures.isLoading ? <Skeleton className="h-24" /> : null}
          {structures.data && structures.data.length === 0 ? <Alert tone="info">No fee structures yet.</Alert> : null}
          {(structures.data ?? []).map((s) => (
            <Card key={s.id} className="p-4" data-testid={`structure-${s.name}-v${s.version}`}>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h2 className="font-medium">{clsName.get(s.classId) ?? 'Class'} · {s.name} <span className="text-sm text-muted-foreground">v{s.version}</span></h2>
                  <p className="text-sm text-muted-foreground">{inr(s.totalPaise)} per year · instalments {s.installmentLabels.join(', ')}</p>
                </div>
                <div className="flex flex-wrap items-center gap-1">
                  <Badge tone={s.status === 'published' ? 'success' : s.status === 'draft' ? 'primary' : 'muted'}>{s.status}</Badge>
                  {s.status === 'draft' && can('fees.config:update') ? <Button size="sm" variant="ghost" onClick={() => setEditing(s)}>Edit</Button> : null}
                  {s.status === 'draft' && can('fees.config:approve') ? <Button size="sm" variant="outline" disabled={act.isPending} onClick={() => { if (window.confirm('Publish? It cannot be changed afterwards (you can revise it).')) act.mutate({ path: `/fees/structures/${s.id}/publish` }); }} data-testid="publish-structure">Publish</Button> : null}
                  {s.status === 'published' && can('fees.config:create') ? <Button size="sm" variant="ghost" disabled={act.isPending} onClick={() => act.mutate({ path: `/fees/structures/${s.id}/revise` })}>Revise</Button> : null}
                  {s.status === 'draft' && can('fees.config:update') ? <Button size="sm" variant="ghost" aria-label="Delete draft" onClick={() => { if (window.confirm('Delete this draft?')) act.mutate({ path: `/fees/structures/${s.id}`, method: 'delete' }); }}><Trash2 className="h-4 w-4" /></Button> : null}
                </div>
              </div>
              <div className="mt-2 overflow-x-auto">
                <table className="w-full min-w-[420px] text-sm">
                  <thead><tr className="text-left text-xs text-muted-foreground"><th className="py-1 pr-2">Fee head</th>{s.installmentLabels.map((l) => <th key={l} className="py-1 pr-2 text-right">{l}</th>)}<th className="py-1 text-right">Total</th></tr></thead>
                  <tbody>
                    {s.items.map((it) => (
                      <tr key={it.categoryId} className="border-t border-border">
                        <td className="py-1 pr-2">{catName.get(it.categoryId) ?? '—'}</td>
                        {s.installmentLabels.map((l) => <td key={l} className="py-1 pr-2 text-right">{inr(it.installments.find((x) => x.label === l)?.amountPaise ?? 0)}</td>)}
                        <td className="py-1 text-right font-medium">{inr(it.amountPaise)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          ))}
        </div>
      ) : null}

      {tab === 'heads' ? (
        <div className="space-y-3">
          {can('fees.config:create') ? <Button onClick={() => setHeadOpen(true)} data-testid="new-head"><Plus className="h-4 w-4" aria-hidden /> Add fee head</Button> : null}
          {cats.data && cats.data.length > 0 ? (
            <Table minWidth={480}>
              <thead className="border-b border-border"><tr><Th>Name</Th><Th>Key</Th><Th>Kind</Th><Th>Refundable</Th><Th>Status</Th><Th /></tr></thead>
              <tbody>
                {cats.data.map((c) => (
                  <tr key={c.id} className="border-b border-border last:border-0">
                    <Td className="font-medium">{c.name}</Td><Td className="font-mono text-xs">{c.key}</Td><Td className="capitalize">{c.kind}</Td><Td>{c.isRefundable ? 'Yes' : 'No'}</Td>
                    <Td><Badge tone={c.active ? 'success' : 'muted'}>{c.active ? 'active' : 'inactive'}</Badge></Td>
                    <Td className="text-right">{can('fees.config:update') ? <HeadToggle cat={c} /> : null}</Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          ) : <Alert tone="info">No fee heads yet (e.g. Tuition, Admission, Transport, Exam).</Alert>}
        </div>
      ) : null}

      {tab === 'policy' ? <PolicyCard /> : null}

      {editing && active ? <StructureEditor structure={editing === 'new' ? null : editing} sessionId={active.id} classes={classes.data ?? []} cats={(cats.data ?? []).filter((c) => c.active)} onClose={() => setEditing(null)} onSaved={refresh} /> : null}
      {headOpen ? <HeadModal onClose={() => setHeadOpen(false)} /> : null}
    </div>
  );
}

function HeadToggle({ cat }: { cat: FeeCategory }) {
  const qc = useQueryClient();
  const m = useMutation({ mutationFn: async () => patch(`/fees/categories/${cat.id}`, { active: !cat.active }), onSuccess: () => qc.invalidateQueries({ queryKey: ['fee-cats'] }) });
  return <Button size="sm" variant="ghost" disabled={m.isPending} onClick={() => m.mutate()}>{cat.active ? 'Deactivate' : 'Activate'}</Button>;
}

function HeadModal({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const [f, setF] = useState({ name: '', key: '', kind: 'tuition', isRefundable: false });
  const m = useMutation({
    mutationFn: async () => post('/fees/categories', { name: f.name.trim(), key: (f.key || f.name).trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, ''), kind: f.kind, isRefundable: f.isRefundable }),
    onSuccess: async () => { await qc.invalidateQueries({ queryKey: ['fee-cats'] }); onClose(); },
  });
  return (
    <Modal open onOpenChange={(o) => { if (!o) onClose(); }} title="Add fee head">
      <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); m.mutate(); }}>
        <Field label="Name" htmlFor="h-name"><Input id="h-name" required maxLength={80} placeholder="Tuition Fee" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
        <Field label="Kind" htmlFor="h-kind"><Select id="h-kind" value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value })}>{FEE_CATEGORY_KINDS.map((k) => <option key={k} value={k} className="capitalize">{k}</option>)}</Select></Field>
        <label className="flex min-h-11 items-center gap-2 text-sm"><input type="checkbox" className="h-5 w-5" checked={f.isRefundable} onChange={(e) => setF({ ...f, isRefundable: e.target.checked })} /> Refundable (e.g. caution deposit)</label>
        {m.error ? <Alert>{errorText(m.error)}</Alert> : null}
        <Button type="submit" disabled={m.isPending}>Save</Button>
      </form>
    </Modal>
  );
}

interface Col { label: string; dueDate: string }
function StructureEditor({ structure, sessionId, classes, cats, onClose, onSaved }: { structure: FeeStructure | null; sessionId: string; classes: Array<{ id: string; name: string }>; cats: FeeCategory[]; onClose: () => void; onSaved: () => Promise<unknown> }) {
  const initCols: Col[] = structure
    ? structure.installmentLabels.map((l) => ({ label: l, dueDate: structure.items.flatMap((i) => i.installments).find((x) => x.label === l)?.dueDate ?? '' }))
    : [{ label: 'Q1', dueDate: '' }, { label: 'Q2', dueDate: '' }, { label: 'Q3', dueDate: '' }, { label: 'Q4', dueDate: '' }];
  const [classId, setClassId] = useState(structure?.classId ?? classes[0]?.id ?? '');
  const [name, setName] = useState(structure?.name ?? 'Standard');
  const [cols, setCols] = useState<Col[]>(initCols);
  const [rows, setRows] = useState<Array<{ categoryId: string; amounts: string[] }>>(
    structure ? structure.items.map((it) => ({ categoryId: it.categoryId, amounts: initCols.map((c) => { const a = it.installments.find((x) => x.label === c.label)?.amountPaise ?? 0; return a ? (a / 100).toString() : ''; }) })) : [{ categoryId: cats[0]?.id ?? '', amounts: initCols.map(() => '') }],
  );
  const [localError, setLocalError] = useState<string | null>(null);

  const m = useMutation({
    mutationFn: async () => {
      const items = rows.map((r) => ({
        categoryId: r.categoryId,
        installments: cols.map((c, i) => ({ label: c.label.trim(), dueDate: c.dueDate, amountPaise: parseRupees(r.amounts[i] || '0') ?? -1 })).filter((x) => x.amountPaise !== 0),
      }));
      if (items.some((it) => it.installments.some((x) => x.amountPaise < 0))) throw new Error('Amounts must be rupees with at most 2 decimals');
      return structure ? patch(`/fees/structures/${structure.id}`, { name, items }) : post('/fees/structures', { sessionId, classId, name, items });
    },
    onSuccess: async () => { await onSaved(); onClose(); },
    onError: (e) => setLocalError(e instanceof Error && !('status' in e) ? e.message : null),
  });
  const total = rows.reduce((a, r) => a + r.amounts.reduce((b, x) => b + (parseRupees(x || '0') ?? 0), 0), 0);

  return (
    <Modal open onOpenChange={(o) => { if (!o) onClose(); }} title={structure ? `Edit draft v${structure.version}` : 'New fee structure'} description="Rows are fee heads, columns are instalments. Leave a cell empty for ₹0.">
      <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); setLocalError(null); m.mutate(); }}>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Class" htmlFor="st-class"><Select id="st-class" value={classId} disabled={Boolean(structure)} onChange={(e) => setClassId(e.target.value)}>{classes.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</Select></Field>
          <Field label="Name" htmlFor="st-name"><Input id="st-name" required maxLength={80} value={name} disabled={Boolean(structure && structure.version > 1)} onChange={(e) => setName(e.target.value)} /></Field>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[520px] text-sm">
            <thead>
              <tr>
                <th className="p-1 text-left text-xs text-muted-foreground">Fee head</th>
                {cols.map((c, i) => (
                  <th key={i} className="p-1">
                    <Input aria-label={`Instalment ${i + 1} name`} value={c.label} onChange={(e) => setCols(cols.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)))} className="min-h-9" />
                    <Input aria-label={`Instalment ${i + 1} due date`} type="date" required value={c.dueDate} onChange={(e) => setCols(cols.map((x, j) => (j === i ? { ...x, dueDate: e.target.value } : x)))} className="mt-1 min-h-9" />
                  </th>
                ))}
                <th className="p-1">
                  <div className="flex gap-1">
                    <Button type="button" size="sm" variant="ghost" aria-label="Add instalment" onClick={() => { setCols([...cols, { label: `Q${cols.length + 1}`, dueDate: '' }]); setRows(rows.map((r) => ({ ...r, amounts: [...r.amounts, ''] }))); }} disabled={cols.length >= 12}><Plus className="h-4 w-4" /></Button>
                    <Button type="button" size="sm" variant="ghost" aria-label="Remove last instalment" onClick={() => { setCols(cols.slice(0, -1)); setRows(rows.map((r) => ({ ...r, amounts: r.amounts.slice(0, -1) }))); }} disabled={cols.length <= 1}><Trash2 className="h-4 w-4" /></Button>
                  </div>
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, ri) => (
                <tr key={ri}>
                  <td className="p-1"><Select aria-label="Fee head" value={r.categoryId} onChange={(e) => setRows(rows.map((x, j) => (j === ri ? { ...x, categoryId: e.target.value } : x)))} className="min-h-9">{cats.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</Select></td>
                  {cols.map((_c, ci) => <td key={ci} className="p-1"><Input aria-label={`Amount ${ri + 1}-${ci + 1}`} inputMode="decimal" className="min-h-9 text-right" value={r.amounts[ci] ?? ''} onChange={(e) => setRows(rows.map((x, j) => (j === ri ? { ...x, amounts: x.amounts.map((a, k) => (k === ci ? e.target.value : a)) } : x)))} /></td>)}
                  <td className="p-1"><Button type="button" size="sm" variant="ghost" aria-label="Remove fee head" disabled={rows.length <= 1} onClick={() => setRows(rows.filter((_x, j) => j !== ri))}><Trash2 className="h-4 w-4" /></Button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <Button type="button" size="sm" variant="outline" onClick={() => setRows([...rows, { categoryId: cats.find((c) => !rows.some((r) => r.categoryId === c.id))?.id ?? cats[0]!.id, amounts: cols.map(() => '') }])} disabled={rows.length >= cats.length}>Add fee head</Button>
          <span className="text-sm">Total per year: <strong>{inr(total)}</strong></span>
        </div>
        {localError ? <Alert>{localError}</Alert> : null}
        {m.error && !localError ? <Alert>{errorText(m.error)}</Alert> : null}
        <Button type="submit" disabled={m.isPending} data-testid="save-structure">{m.isPending ? 'Saving…' : 'Save draft'}</Button>
      </form>
    </Modal>
  );
}

function PolicyCard() {
  const { me, can } = useAuth();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['fee-policy', me?.activeMembershipId], queryFn: async () => (await get<FeePolicy>('/fees/policy')).data });
  const [f, setF] = useState<{ receiptPrefix: string; pct: string; flat: string; allowAdvance: boolean } | null>(null);
  const p = q.data;
  const cur = f ?? (p ? { receiptPrefix: p.receiptPrefix, pct: String(p.concessionAutoApprove.maxPercentBps / 100), flat: String(p.concessionAutoApprove.maxFlatPaise / 100), allowAdvance: p.allowAdvance } : null);
  const m = useMutation({
    mutationFn: async () => patch('/fees/policy', { receiptPrefix: cur!.receiptPrefix.toUpperCase(), allowAdvance: cur!.allowAdvance, concessionAutoApprove: { maxPercentBps: Math.round(Number(cur!.pct) * 100), maxFlatPaise: parseRupees(cur!.flat) ?? 0 } }),
    onSuccess: async () => { setF(null); await qc.invalidateQueries({ queryKey: ['fee-policy'] }); },
  });
  if (!cur) return <Skeleton className="h-40" />;
  const editable = can('fees.config:approve');
  return (
    <Card className="p-4">
      <form className="grid gap-3 sm:grid-cols-2" onSubmit={(e) => { e.preventDefault(); m.mutate(); }}>
        <Field label="Receipt prefix" htmlFor="p-prefix"><Input id="p-prefix" disabled={!editable} maxLength={10} value={cur.receiptPrefix} onChange={(e) => setF({ ...cur, receiptPrefix: e.target.value })} /></Field>
        <p className="self-end pb-2 text-sm text-muted-foreground">Receipts: {cur.receiptPrefix.toUpperCase()}/2026-27/000001 — one series per financial year (April–March).</p>
        <Field label="Concessions approved automatically up to (%)" htmlFor="p-pct"><Input id="p-pct" disabled={!editable} inputMode="decimal" value={cur.pct} onChange={(e) => setF({ ...cur, pct: e.target.value })} /></Field>
        <Field label="…or a flat amount up to (₹)" htmlFor="p-flat"><Input id="p-flat" disabled={!editable} inputMode="decimal" value={cur.flat} onChange={(e) => setF({ ...cur, flat: e.target.value })} /></Field>
        <label className="flex min-h-11 items-center gap-2 text-sm sm:col-span-2"><input type="checkbox" className="h-5 w-5" disabled={!editable} checked={cur.allowAdvance} onChange={(e) => setF({ ...cur, allowAdvance: e.target.checked })} /> Allow keeping overpayments as advance credit</label>
        <p className="text-xs text-muted-foreground sm:col-span-2">Larger concessions, payment reversals and refunds always need approval by someone other than the requester. Late fees are applied manually with a reason.</p>
        {m.error ? <div className="sm:col-span-2"><Alert>{errorText(m.error)}</Alert></div> : null}
        {editable ? <div className="sm:col-span-2"><Button type="submit" disabled={m.isPending || !f}>Save policy</Button></div> : null}
      </form>
    </Card>
  );
}
