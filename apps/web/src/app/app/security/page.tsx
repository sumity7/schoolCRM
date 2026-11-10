'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { errorText, get, post, del } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { Alert, Badge, Button, Card, Field, Input, PageHeader, Skeleton } from '@/components/ui/primitives';
import { TwoFactor } from '@/components/two-factor';

interface SessionRow { id: string; lastSeenAt: string; expiresAt: string; ip?: string; userAgent?: string; current: boolean }

export default function SecurityPage() {
  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <PageHeader title="Security" description="Your password, two-factor authentication and the devices signed in to your account." />
      <TwoFactor />
      <ChangePassword />
      <Sessions />
    </div>
  );
}

function ChangePassword() {
  const [f, setF] = useState({ currentPassword: '', newPassword: '' });
  const m = useMutation({ mutationFn: async () => post('/auth/change-password', f), onSuccess: () => setF({ currentPassword: '', newPassword: '' }) });
  return (
    <Card className="p-4">
      <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); m.mutate(); }}>
        <h2 className="font-medium">Change password</h2>
        <Field label="Current password" htmlFor="cp-cur"><Input id="cp-cur" type="password" autoComplete="current-password" required value={f.currentPassword} onChange={(e) => setF({ ...f, currentPassword: e.target.value })} /></Field>
        <Field label="New password (at least 10 characters)" htmlFor="cp-new"><Input id="cp-new" type="password" autoComplete="new-password" required minLength={10} value={f.newPassword} onChange={(e) => setF({ ...f, newPassword: e.target.value })} /></Field>
        {m.error ? <Alert>{errorText(m.error)}</Alert> : null}
        {m.isSuccess ? <Alert tone="success">Password changed. Other devices were signed out.</Alert> : null}
        <Button type="submit" disabled={m.isPending}>Change password</Button>
      </form>
    </Card>
  );
}

function Sessions() {
  const { me } = useAuth();
  const qc = useQueryClient();
  const list = useQuery({ queryKey: ['my-sessions', me?.user.id], queryFn: async () => (await get<SessionRow[]>('/auth/sessions')).data });
  const revoke = useMutation({ mutationFn: async (id: string) => del(`/auth/sessions/${id}`), onSuccess: () => qc.invalidateQueries({ queryKey: ['my-sessions'] }) });
  return (
    <Card className="space-y-2 p-4">
      <h2 className="font-medium">Signed-in devices</h2>
      {list.isLoading ? <Skeleton className="h-16" /> : null}
      {revoke.error ? <Alert>{errorText(revoke.error)}</Alert> : null}
      <ul className="divide-y divide-border text-sm">
        {(list.data ?? []).map((s) => (
          <li key={s.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
            <span className="min-w-0">
              <span className="block truncate">{s.userAgent ?? 'Unknown device'}</span>
              <span className="text-xs text-muted-foreground">{s.ip ?? ''} · last active {new Date(s.lastSeenAt).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })}</span>
            </span>
            {s.current ? <Badge tone="primary">this device</Badge> : <Button size="sm" variant="ghost" onClick={() => revoke.mutate(s.id)}>Sign out</Button>}
          </li>
        ))}
      </ul>
    </Card>
  );
}
