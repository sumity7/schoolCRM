'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Mail } from 'lucide-react';
import { errorText, get, post } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { sectionLabel, sortSections, useSections } from '@/lib/lookups';
import { Alert, Badge, Button, Card, Field, Input, PageHeader, Select, Skeleton, Textarea } from '@/components/ui/primitives';
import { Modal } from '@/components/ui/modal';

interface Notice { id: string; title: string; body: string; audience: 'everyone' | 'staff' | 'parents' | 'sections'; sectionIds: string[]; emailParents: boolean; status: string; createdByName: string; publishedAt: string; createdBy: string | null; read: boolean }
const AUDIENCE: Record<Notice['audience'], string> = { everyone: 'Everyone', staff: 'Staff only', parents: 'All parents', sections: 'Selected classes' };

export default function NoticesPage() {
  const { me, can } = useAuth();
  const qc = useQueryClient();
  const [page, setPage] = useState(1);
  const [open, setOpen] = useState<string | null>(null);
  const [compose, setCompose] = useState(false);
  const isParent = me?.roleKeys.includes('parent');
  const createScope = me?.permissions.find((p) => p.key === 'notices:create')?.scope;
  const canPost = can('notices:create') && !isParent;
  const sections = useSections({ enabled: !isParent && can('academics:read') });
  const secBy = new Map((sections.data ?? []).map((s) => [s.id, s]));
  const list = useQuery({ queryKey: ['notices', me?.activeMembershipId, page], queryFn: async () => get<Notice[]>(`/notices?page=${page}&limit=20`), placeholderData: (p) => p });
  const markRead = useMutation({ mutationFn: async (id: string) => post(`/notices/${id}/read`, {}), onSuccess: () => qc.invalidateQueries({ queryKey: ['notices'] }) });
  const withdraw = useMutation({ mutationFn: async (id: string) => post(`/notices/${id}/withdraw`, {}), onSuccess: () => qc.invalidateQueries({ queryKey: ['notices'] }) });
  const meta = list.data?.meta as unknown as { unread: number; page: number; totalPages: number } | undefined;

  function toggle(n: Notice) {
    setOpen(open === n.id ? null : n.id);
    if (!n.read && n.status === 'published') markRead.mutate(n.id);
  }

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <PageHeader title="Notices" description={meta ? `${meta.unread} unread` : undefined} actions={canPost ? <Button onClick={() => setCompose(true)} data-testid="new-notice">New notice</Button> : null} />
      {withdraw.error ? <Alert>{errorText(withdraw.error)}</Alert> : null}
      {list.isLoading ? <Skeleton className="h-32" /> : null}
      {list.error ? <Alert>{errorText(list.error)}</Alert> : null}
      {list.data && list.data.data.length === 0 ? <Alert tone="info">No notices yet.</Alert> : null}
      <div className="space-y-2" data-testid="notices-list">
        {(list.data?.data ?? []).map((n) => (
          <Card key={n.id} className={n.status === 'withdrawn' ? 'opacity-60' : ''}>
            <button type="button" onClick={() => toggle(n)} aria-expanded={open === n.id} className="flex min-h-11 w-full items-start justify-between gap-2 p-4 text-left">
              <span>
                <span className="flex items-center gap-2 font-medium">{!n.read && n.status === 'published' ? <span className="h-2 w-2 rounded-full bg-primary" aria-label="unread" /> : null}{n.title}</span>
                <span className="block text-xs text-muted-foreground">{new Date(n.publishedAt).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })} · {n.createdByName}</span>
              </span>
              <span className="flex shrink-0 flex-wrap justify-end gap-1">
                {!isParent ? <Badge tone="muted">{AUDIENCE[n.audience]}</Badge> : null}
                {n.status === 'withdrawn' ? <Badge tone="warning">withdrawn</Badge> : null}
              </span>
            </button>
            {open === n.id ? (
              <div className="space-y-3 border-t border-border p-4 text-sm">
                <p className="whitespace-pre-wrap break-words">{n.body}</p>
                {!isParent && n.audience === 'sections' ? <p className="text-xs text-muted-foreground">For: {n.sectionIds.map((s) => (secBy.get(s) ? sectionLabel(secBy.get(s)!) : 'a class')).join(', ')}</p> : null}
                {canPost && n.status === 'published' ? <NoticeTools notice={n} canWithdraw={createScope === 'school' || n.createdBy === me?.activeMembershipId} onWithdraw={() => { if (window.confirm('Withdraw this notice? Parents will no longer see it.')) withdraw.mutate(n.id); }} /> : null}
              </div>
            ) : null}
          </Card>
        ))}
      </div>
      {meta && meta.totalPages > 1 ? (
        <div className="flex justify-end gap-2"><Button size="sm" variant="outline" disabled={page <= 1} onClick={() => setPage(page - 1)}>Newer</Button><Button size="sm" variant="outline" disabled={page >= meta.totalPages} onClick={() => setPage(page + 1)}>Older</Button></div>
      ) : null}
      {compose ? <ComposeModal teacher={createScope !== 'school'} sections={sortSections(sections.data ?? [])} onClose={() => setCompose(false)} /> : null}
    </div>
  );
}

function NoticeTools({ notice, canWithdraw, onWithdraw }: { notice: Notice; canWithdraw: boolean; onWithdraw: () => void }) {
  const { me } = useAuth();
  const stats = useQuery({ queryKey: ['notice-stats', me?.activeMembershipId, notice.id], queryFn: async () => (await get<{ reads: number; emails: Record<string, number> }>(`/notices/${notice.id}/stats`)).data });
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
      <span data-testid="notice-stats">{stats.data ? `${stats.data.reads} read${notice.emailParents ? ` · ${Object.values(stats.data.emails).reduce((a, b) => a + b, 0)} emails` : ''}` : '…'}</span>
      {canWithdraw ? <Button size="sm" variant="ghost" className="text-danger" onClick={onWithdraw}>Withdraw</Button> : null}
    </div>
  );
}

function ComposeModal({ teacher, sections, onClose }: { teacher: boolean; sections: Array<{ id: string; className?: string; name: string }>; onClose: () => void }) {
  const qc = useQueryClient();
  const mine = useSections({ mine: true, enabled: teacher });
  const choices = teacher ? (mine.data ?? []) : sections;
  const [f, setF] = useState({ title: '', body: '', audience: teacher ? 'sections' : 'everyone', emailParents: false });
  const [picked, setPicked] = useState<string[]>([]);
  const m = useMutation({
    mutationFn: async () => post('/notices', { title: f.title.trim(), body: f.body.trim(), audience: f.audience, emailParents: f.emailParents, ...(f.audience === 'sections' ? { sectionIds: picked } : {}) }),
    onSuccess: async () => { await qc.invalidateQueries({ queryKey: ['notices'] }); onClose(); },
  });
  return (
    <Modal open onOpenChange={(o) => { if (!o) onClose(); }} title="New notice" description={teacher ? 'Teachers can post to the classes they teach.' : undefined}>
      <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); m.mutate(); }}>
        <Field label="Title" htmlFor="n-title"><Input id="n-title" required minLength={3} maxLength={150} value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} /></Field>
        <Field label="Message" htmlFor="n-body"><Textarea id="n-body" required maxLength={5000} rows={6} value={f.body} onChange={(e) => setF({ ...f, body: e.target.value })} /></Field>
        {!teacher ? (
          <Field label="Who should see it" htmlFor="n-aud">
            <Select id="n-aud" value={f.audience} onChange={(e) => setF({ ...f, audience: e.target.value })}>
              {(Object.keys(AUDIENCE) as Array<Notice['audience']>).map((a) => <option key={a} value={a}>{AUDIENCE[a]}</option>)}
            </Select>
          </Field>
        ) : null}
        {f.audience === 'sections' ? (
          <fieldset>
            <legend className="mb-1 text-sm font-medium">Classes</legend>
            <div className="grid max-h-48 grid-cols-2 gap-1 overflow-y-auto sm:grid-cols-3">
              {choices.map((s) => (
                <label key={s.id} className="flex min-h-11 items-center gap-2 text-sm">
                  <input type="checkbox" className="h-5 w-5" checked={picked.includes(s.id)} onChange={(e) => setPicked(e.target.checked ? [...picked, s.id] : picked.filter((x) => x !== s.id))} /> {sectionLabel(s)}
                </label>
              ))}
            </div>
          </fieldset>
        ) : null}
        {f.audience !== 'staff' ? (
          <label className="flex min-h-11 items-center gap-2 text-sm"><input type="checkbox" className="h-5 w-5" checked={f.emailParents} onChange={(e) => setF({ ...f, emailParents: e.target.checked })} /><Mail className="h-4 w-4" aria-hidden /> Also email verified parents (development: written to the outbox, not delivered)</label>
        ) : null}
        {m.error ? <Alert>{errorText(m.error)}</Alert> : null}
        <Button type="submit" disabled={m.isPending || (f.audience === 'sections' && picked.length === 0)} data-testid="publish-notice">{m.isPending ? 'Publishing…' : 'Publish'}</Button>
      </form>
    </Modal>
  );
}
