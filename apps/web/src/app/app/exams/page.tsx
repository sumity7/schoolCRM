'use client';

import Link from 'next/link';
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Trash2 } from 'lucide-react';
import { DEFAULT_BANDS } from '@edunex/shared';
import { errorText, get, post } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { EXAM_STATUS, examTone, type Exam, type GradingScale } from '@/lib/exams';
import { useClasses } from '@/lib/lookups';
import { cn } from '@/lib/utils';
import { Alert, Badge, Button, Card, Field, Input, PageHeader, Select, Skeleton, Table, Td, Th } from '@/components/ui/primitives';
import { Modal } from '@/components/ui/modal';

export default function ExamsPage() {
  const { me, can } = useAuth();
  const [tab, setTab] = useState<'exams' | 'scales'>('exams');
  const [createOpen, setCreateOpen] = useState(false);
  const [scaleOpen, setScaleOpen] = useState(false);
  const classes = useClasses();
  const clsName = new Map((classes.data ?? []).map((c) => [c.id, c.name]));
  const exams = useQuery({ queryKey: ['exams', me?.activeMembershipId], queryFn: async () => (await get<Exam[]>('/exams')).data });
  const scales = useQuery({ queryKey: ['scales', me?.activeMembershipId], queryFn: async () => (await get<GradingScale[]>('/exams/grading-scales')).data });
  const qc = useQueryClient();
  const publishScale = useMutation({ mutationFn: async (id: string) => post(`/exams/grading-scales/${id}/publish`, {}), onSuccess: () => qc.invalidateQueries({ queryKey: ['scales'] }) });

  return (
    <div className="mx-auto max-w-5xl space-y-4">
      <PageHeader title="Exams & results" description="Exams follow a fixed path: draft → marks entry → marks locked → results computed → published. Published results never change; corrections create a new version." />
      <div role="tablist" className="flex gap-1 border-b border-border">
        {([['exams', 'Exams'], ['scales', 'Grading scales']] as const).map(([k, l]) => (
          <button key={k} role="tab" aria-selected={tab === k} onClick={() => setTab(k)} className={cn('min-h-11 border-b-2 px-3 text-sm', tab === k ? 'border-primary font-medium' : 'border-transparent text-muted-foreground')}>{l}</button>
        ))}
      </div>

      {tab === 'exams' ? (
        <div className="space-y-3">
          {can('exams:create') ? <Button onClick={() => setCreateOpen(true)} disabled={!scales.data?.some((s) => s.status === 'published')} data-testid="new-exam">New exam</Button> : null}
          {scales.data && !scales.data.some((s) => s.status === 'published') && can('exams:create') ? <Alert tone="info">Create and publish a grading scale first.</Alert> : null}
          {exams.isLoading ? <Skeleton className="h-24" /> : null}
          {exams.error ? <Alert>{errorText(exams.error)}</Alert> : null}
          {exams.data && exams.data.length === 0 ? <Alert tone="info">No exams in the active session yet.</Alert> : null}
          {exams.data && exams.data.length > 0 ? (
            <Table minWidth={560} testId="exams-table">
              <thead className="border-b border-border"><tr><Th>Exam</Th><Th>Type</Th><Th>Classes</Th><Th>Status</Th></tr></thead>
              <tbody>
                {exams.data.map((e) => (
                  <tr key={e.id} className="border-b border-border last:border-0">
                    <Td><Link href={`/app/exams/${e.id}`} className="font-medium text-primary hover:underline">{e.name}</Link></Td>
                    <Td className="capitalize">{e.type}</Td>
                    <Td>{e.classIds.map((c) => clsName.get(c) ?? '—').join(', ')}</Td>
                    <Td><Badge tone={examTone(e.status)}>{EXAM_STATUS[e.status]}</Badge></Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          ) : null}
        </div>
      ) : null}

      {tab === 'scales' ? (
        <div className="space-y-3">
          {can('exams:create') ? <Button onClick={() => setScaleOpen(true)} data-testid="new-scale">New grading scale</Button> : null}
          {publishScale.error ? <Alert>{errorText(publishScale.error)}</Alert> : null}
          {(scales.data ?? []).map((s) => (
            <Card key={s.id} className="p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h2 className="font-medium">{s.name} <span className="text-sm text-muted-foreground">v{s.version}</span></h2>
                <div className="flex items-center gap-2">
                  <Badge tone={s.status === 'published' ? 'success' : 'primary'}>{s.status}</Badge>
                  {s.status === 'draft' && can('exams:approve') ? <Button size="sm" variant="outline" onClick={() => publishScale.mutate(s.id)} data-testid="publish-scale">Publish</Button> : null}
                </div>
              </div>
              <p className="mt-2 text-sm text-muted-foreground">{s.bands.map((b) => `${b.grade} ≥ ${b.minPct}%`).join(' · ')}</p>
            </Card>
          ))}
          {scales.data && scales.data.length === 0 ? <Alert tone="info">No grading scales yet.</Alert> : null}
        </div>
      ) : null}

      {createOpen ? <CreateExam scales={(scales.data ?? []).filter((s) => s.status === 'published')} classes={classes.data ?? []} onClose={() => setCreateOpen(false)} /> : null}
      {scaleOpen ? <ScaleModal onClose={() => setScaleOpen(false)} /> : null}
    </div>
  );
}

function CreateExam({ scales, classes, onClose }: { scales: GradingScale[]; classes: Array<{ id: string; name: string }>; onClose: () => void }) {
  const qc = useQueryClient();
  const [f, setF] = useState({ name: '', type: 'unit', gradingScaleId: scales[0]?.id ?? '', absentIsFail: true });
  const [picked, setPicked] = useState<string[]>([]);
  const m = useMutation({ mutationFn: async () => (await post<Exam>('/exams', { ...f, name: f.name.trim(), classIds: picked })).data, onSuccess: async (e) => { await qc.invalidateQueries({ queryKey: ['exams'] }); window.location.assign(`/app/exams/${e.id}`); } });
  return (
    <Modal open onOpenChange={(o) => { if (!o) onClose(); }} title="New exam">
      <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); m.mutate(); }}>
        <Field label="Name" htmlFor="ex-name"><Input id="ex-name" required minLength={2} maxLength={80} placeholder="Half yearly 2026" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Type" htmlFor="ex-type"><Select id="ex-type" value={f.type} onChange={(e) => setF({ ...f, type: e.target.value })}>{['unit', 'midterm', 'final', 'practical', 'internal'].map((x) => <option key={x} value={x}>{x}</option>)}</Select></Field>
          <Field label="Grading scale" htmlFor="ex-scale"><Select id="ex-scale" value={f.gradingScaleId} onChange={(e) => setF({ ...f, gradingScaleId: e.target.value })}>{scales.map((s) => <option key={s.id} value={s.id}>{s.name} v{s.version}</option>)}</Select></Field>
        </div>
        <fieldset>
          <legend className="mb-1 text-sm font-medium">Classes</legend>
          <div className="grid grid-cols-2 gap-1 sm:grid-cols-3">
            {classes.map((c) => <label key={c.id} className="flex min-h-11 items-center gap-2 text-sm"><input type="checkbox" className="h-5 w-5" checked={picked.includes(c.id)} onChange={(e) => setPicked(e.target.checked ? [...picked, c.id] : picked.filter((x) => x !== c.id))} /> {c.name}</label>)}
          </div>
        </fieldset>
        <label className="flex min-h-11 items-center gap-2 text-sm"><input type="checkbox" className="h-5 w-5" checked={f.absentIsFail} onChange={(e) => setF({ ...f, absentIsFail: e.target.checked })} /> Absent in a subject counts as fail (otherwise the subject is left out)</label>
        {m.error ? <Alert>{errorText(m.error)}</Alert> : null}
        <Button type="submit" disabled={m.isPending || picked.length === 0} data-testid="create-exam">Create</Button>
      </form>
    </Modal>
  );
}

function ScaleModal({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const [name, setName] = useState('Standard');
  const [bands, setBands] = useState(DEFAULT_BANDS.map((b) => ({ minPct: String(b.minPct), grade: b.grade })));
  const m = useMutation({ mutationFn: async () => post('/exams/grading-scales', { name, bands: bands.map((b) => ({ minPct: Number(b.minPct), grade: b.grade.trim() })) }), onSuccess: async () => { await qc.invalidateQueries({ queryKey: ['scales'] }); onClose(); } });
  return (
    <Modal open onOpenChange={(o) => { if (!o) onClose(); }} title="New grading scale" description="A percentage gets the grade of the first band whose minimum it reaches. One band must start at 0.">
      <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); m.mutate(); }}>
        <Field label="Name" htmlFor="sc-name"><Input id="sc-name" required value={name} onChange={(e) => setName(e.target.value)} /></Field>
        <div className="space-y-1">
          {bands.map((b, i) => (
            <div key={i} className="flex items-center gap-2">
              <Input aria-label={`Grade ${i + 1}`} className="min-h-9 w-24" value={b.grade} onChange={(e) => setBands(bands.map((x, j) => (j === i ? { ...x, grade: e.target.value } : x)))} />
              <span className="text-sm">from</span>
              <Input aria-label={`Minimum % ${i + 1}`} inputMode="decimal" className="min-h-9 w-24" value={b.minPct} onChange={(e) => setBands(bands.map((x, j) => (j === i ? { ...x, minPct: e.target.value } : x)))} />
              <span className="text-sm">%</span>
              <Button type="button" size="sm" variant="ghost" aria-label="Remove band" disabled={bands.length <= 1} onClick={() => setBands(bands.filter((_x, j) => j !== i))}><Trash2 className="h-4 w-4" /></Button>
            </div>
          ))}
          <Button type="button" size="sm" variant="outline" disabled={bands.length >= 15} onClick={() => setBands([...bands, { minPct: '', grade: '' }])}><Plus className="h-4 w-4" aria-hidden /> Band</Button>
        </div>
        {m.error ? <Alert>{errorText(m.error)}</Alert> : null}
        <Button type="submit" disabled={m.isPending}>Save draft</Button>
      </form>
    </Modal>
  );
}
