'use client';

import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { errorText, patch, post } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useSessions, type SessionRow } from '@/lib/lookups';
import { Alert, Badge, Button, Field, Input, PageHeader, Skeleton, Table, Td, Th } from '@/components/ui/primitives';
import { Modal } from '@/components/ui/modal';

export default function SessionsPage() {
  const { can } = useAuth();
  const qc = useQueryClient();
  const sessions = useSessions();
  const [edit, setEdit] = useState<SessionRow | 'new' | null>(null);
  const refresh = () => qc.invalidateQueries();
  const act = useMutation({
    mutationFn: async (v: { id: string; action: 'activate' | 'close' }) => post(`/academics/sessions/${v.id}/${v.action}`, {}),
    onSuccess: refresh,
  });
  const hasActive = sessions.data?.some((s) => s.status === 'active');

  return (
    <div className="mx-auto max-w-4xl space-y-4">
      <PageHeader
        title="Academic sessions"
        description="Exactly one session is active at a time. Classes, sections, enrolments and attendance belong to the active session. Closed sessions are read-only."
        actions={can('academics:create') ? <Button onClick={() => setEdit('new')} data-testid="new-session">New session</Button> : null}
      />
      {act.error ? <Alert>{errorText(act.error)}</Alert> : null}
      {sessions.isLoading ? <Skeleton className="h-24" /> : null}
      {sessions.error ? <Alert>{errorText(sessions.error)}</Alert> : null}
      {sessions.data && sessions.data.length === 0 ? <Alert tone="info">No sessions yet. Create one (e.g. “2026-27”, 1 April – 31 March) and activate it.</Alert> : null}
      {sessions.data && sessions.data.length > 0 ? (
        <Table minWidth={560} testId="sessions-table">
          <thead className="border-b border-border"><tr><Th>Name</Th><Th>From</Th><Th>To</Th><Th>Status</Th><Th /></tr></thead>
          <tbody>
            {sessions.data.map((s) => (
              <tr key={s.id} className="border-b border-border last:border-0">
                <Td className="font-medium">{s.name}</Td><Td>{s.startDate}</Td><Td>{s.endDate}</Td>
                <Td><Badge tone={s.status === 'active' ? 'success' : s.status === 'closed' ? 'muted' : 'primary'}>{s.status}</Badge></Td>
                <Td className="whitespace-nowrap text-right">
                  <div className="flex justify-end gap-1">
                    {s.status !== 'closed' && can('academics:update') ? <Button size="sm" variant="ghost" onClick={() => setEdit(s)}>Edit</Button> : null}
                    {s.status === 'draft' && can('academics:approve') ? (
                      <Button size="sm" variant="outline" disabled={act.isPending || hasActive} title={hasActive ? 'Close the active session first' : undefined} onClick={() => act.mutate({ id: s.id, action: 'activate' })}>Activate</Button>
                    ) : null}
                    {s.status === 'active' && can('academics:approve') ? (
                      <Button size="sm" variant="ghost" className="text-danger" disabled={act.isPending} onClick={() => { if (window.confirm(`Close ${s.name}? It becomes read-only. Do this only at year end after promotion.`)) act.mutate({ id: s.id, action: 'close' }); }}>Close</Button>
                    ) : null}
                  </div>
                </Td>
              </tr>
            ))}
          </tbody>
        </Table>
      ) : null}
      {edit ? <SessionModal session={edit === 'new' ? null : edit} onClose={() => setEdit(null)} onSaved={refresh} /> : null}
    </div>
  );
}

function SessionModal({ session, onClose, onSaved }: { session: SessionRow | null; onClose: () => void; onSaved: () => Promise<unknown> }) {
  const year = new Date().getFullYear();
  const [f, setF] = useState({ name: session?.name ?? `${year}-${String((year + 1) % 100).padStart(2, '0')}`, startDate: session?.startDate ?? `${year}-04-01`, endDate: session?.endDate ?? `${year + 1}-03-31` });
  const m = useMutation({
    mutationFn: async () => (session ? patch(`/academics/sessions/${session.id}`, f) : post('/academics/sessions', f)),
    onSuccess: async () => { await onSaved(); onClose(); },
  });
  return (
    <Modal open onOpenChange={(o) => { if (!o) onClose(); }} title={session ? 'Edit session' : 'New academic session'}>
      <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); m.mutate(); }}>
        <Field label="Name" htmlFor="s-name"><Input id="s-name" required minLength={2} maxLength={40} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Starts" htmlFor="s-start"><Input id="s-start" type="date" required value={f.startDate} onChange={(e) => setF({ ...f, startDate: e.target.value })} /></Field>
          <Field label="Ends" htmlFor="s-end"><Input id="s-end" type="date" required value={f.endDate} onChange={(e) => setF({ ...f, endDate: e.target.value })} /></Field>
        </div>
        {m.error ? <Alert>{errorText(m.error)}</Alert> : null}
        <Button type="submit" disabled={m.isPending}>{m.isPending ? 'Saving…' : 'Save'}</Button>
      </form>
    </Modal>
  );
}
