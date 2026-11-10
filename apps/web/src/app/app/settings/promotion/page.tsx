'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { errorText, get, newIdempotencyKey, post } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useSessions } from '@/lib/lookups';
import { Alert, Badge, Button, Card, PageHeader, Select, Skeleton } from '@/components/ui/primitives';

type Action = 'promote' | 'retain' | 'graduate';
interface Plan {
  classId: string; className: string;
  nextClass: { id: string; name: string; sections: Array<{ id: string; name: string }> } | null;
  sameClass: { id: string; name: string; sections: Array<{ id: string; name: string }> } | null;
  students: Array<{ studentId: string; name: string; admissionNo: string; section: string; lastResult: { status: string; percentage: number | null } | null; suggested: Action; suggestedSectionId: string | null; decided: { action: Action; sectionId: string | null } | null }>;
}

export default function PromotionPage() {
  const { me } = useAuth();
  const qc = useQueryClient();
  const sessions = useSessions();
  const drafts = (sessions.data ?? []).filter((s) => s.status === 'draft');
  const active = (sessions.data ?? []).find((s) => s.status === 'active');
  const [target, setTarget] = useState('');
  const [copyFees, setCopyFees] = useState(true);
  const [choice, setChoice] = useState<Record<string, { action: Action; sectionId: string | null }>>({});
  const [key, setKey] = useState(newIdempotencyKey);
  useEffect(() => { if (!target && drafts.length) setTarget(drafts[0]!.id); }, [drafts, target]);

  const plan = useQuery({ queryKey: ['promotion-plan', me?.activeMembershipId, target], enabled: Boolean(target), retry: false, queryFn: async () => (await get<Plan[]>(`/promotions/preview?targetSessionId=${target}`)).data });
  useEffect(() => {
    if (!plan.data) return;
    const init: typeof choice = {};
    for (const c of plan.data) for (const s of c.students) init[s.studentId] = s.decided ?? { action: s.suggested, sectionId: s.suggestedSectionId };
    setChoice(init);
  }, [plan.data]);
  const prepare = useMutation({ mutationFn: async () => (await post<{ classesCreated: number; sectionsCreated: number; feeStructuresCopied: number }>('/promotions/prepare', { targetSessionId: target, copyFeeStructures: copyFees })).data, onSuccess: () => qc.invalidateQueries({ queryKey: ['promotion-plan'] }) });
  const commit = useMutation({
    mutationFn: async () => (await post<Record<Action, number>>('/promotions/commit', { targetSessionId: target, decisions: Object.entries(choice).map(([studentId, c]) => ({ studentId, action: c.action, sectionId: c.action === 'graduate' ? null : c.sectionId })) }, { idempotencyKey: key })).data,
    onSuccess: async () => { setKey(newIdempotencyKey()); await qc.invalidateQueries({ queryKey: ['promotion-plan'] }); },
  });
  const notPrepared = plan.error && errorText(plan.error).includes('Prepare');

  return (
    <div className="mx-auto max-w-5xl space-y-4">
      <PageHeader title="Year-end promotion" description="Decide where every student goes next year. Nothing changes in the current year until you activate the new session; old attendance, fees and results are never altered." />
      {!active ? <Alert tone="info">There is no active session to promote from.</Alert> : null}
      {sessions.data && drafts.length === 0 ? <Alert tone="info">First create next year&apos;s session (as a draft) under <Link href="/app/settings/academic-sessions" className="font-medium text-primary underline">Academic sessions</Link>.</Alert> : null}
      {drafts.length > 0 && active ? (
        <Card className="space-y-3 p-4">
          <div className="grid gap-2 sm:grid-cols-[1fr_auto]">
            <Select aria-label="New session" value={target} onChange={(e) => setTarget(e.target.value)}>{drafts.map((s) => <option key={s.id} value={s.id}>{active.name} → {s.name}</option>)}</Select>
            <Button variant="outline" onClick={() => prepare.mutate()} disabled={prepare.isPending} data-testid="prepare-promotion">1. Copy classes & sections</Button>
          </div>
          <label className="flex min-h-11 items-center gap-2 text-sm"><input type="checkbox" className="h-5 w-5" checked={copyFees} onChange={(e) => setCopyFees(e.target.checked)} /> Also copy published fee structures as drafts (due dates moved one year; review amounts before publishing)</label>
          {prepare.data ? <Alert tone="success">Created {prepare.data.classesCreated} classes, {prepare.data.sectionsCreated} sections, {prepare.data.feeStructuresCopied} fee structure drafts.</Alert> : null}
          {prepare.error ? <Alert>{errorText(prepare.error)}</Alert> : null}
        </Card>
      ) : null}

      {plan.isLoading && target ? <Skeleton className="h-40" /> : null}
      {plan.error && !notPrepared ? <Alert>{errorText(plan.error)}</Alert> : null}
      {(plan.data ?? []).map((c) => {
        const options = (a: Action) => (a === 'promote' ? c.nextClass?.sections ?? [] : a === 'retain' ? c.sameClass?.sections ?? [] : []);
        return (
          <Card key={c.classId} className="p-4" data-testid={`promo-class-${c.className}`}>
            <h2 className="font-medium">{c.className} → {c.nextClass?.name ?? 'graduates (last class)'}</h2>
            {c.students.length === 0 ? <p className="text-sm text-muted-foreground">No active students.</p> : (
              <ul className="mt-2 divide-y divide-border">
                {c.students.map((s) => {
                  const ch = choice[s.studentId] ?? { action: s.suggested, sectionId: s.suggestedSectionId };
                  return (
                    <li key={s.studentId} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
                      <span className="min-w-0">{s.name} <span className="text-xs text-muted-foreground">{s.admissionNo} · {s.section}</span>{s.lastResult ? <span className="ml-1"><Badge tone={s.lastResult.status === 'fail' ? 'danger' : 'success'}>{s.lastResult.status} {s.lastResult.percentage ?? ''}%</Badge></span> : null}{s.decided ? <span className="ml-1"><Badge tone="primary">saved</Badge></span> : null}</span>
                      <span className="flex gap-1">
                        <Select aria-label={`Action for ${s.name}`} className="min-h-9 w-32" value={ch.action} onChange={(e) => { const a = e.target.value as Action; setChoice({ ...choice, [s.studentId]: { action: a, sectionId: options(a).find((x) => x.name === s.section)?.id ?? options(a)[0]?.id ?? null } }); }}>
                          {c.nextClass ? <option value="promote">Promote</option> : null}
                          <option value="retain">Retain</option>
                          <option value="graduate">Graduate / leave</option>
                        </Select>
                        {ch.action !== 'graduate' ? (
                          <Select aria-label={`Section for ${s.name}`} className="min-h-9 w-28" value={ch.sectionId ?? ''} onChange={(e) => setChoice({ ...choice, [s.studentId]: { ...ch, sectionId: e.target.value } })}>
                            {options(ch.action).map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
                          </Select>
                        ) : null}
                      </span>
                    </li>
                  );
                })}
              </ul>
            )}
          </Card>
        );
      })}
      {plan.data && plan.data.length > 0 ? (
        <Card className="space-y-2 p-4">
          {commit.error ? <Alert>{errorText(commit.error)}</Alert> : null}
          {commit.data ? <Alert tone="success"><span data-testid="promotion-saved">Saved: {commit.data.promote} promoted, {commit.data.retain} retained, {commit.data.graduate} graduating.</span> They take effect when you close {active?.name} and activate the new session (Academic sessions).</Alert> : null}
          <Button onClick={() => commit.mutate()} disabled={commit.isPending || Object.keys(choice).length === 0} data-testid="save-promotion">2. Save decisions ({Object.keys(choice).length} students)</Button>
        </Card>
      ) : null}
    </div>
  );
}
