'use client';

import { Fragment, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { errorText, get } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { Alert, Button, PageHeader, Select, Skeleton, Table, Td, Th } from '@/components/ui/primitives';

interface AuditRow { id: string; at: string; action: string; entityType?: string; entityId?: string; actorUserId: string | null; before?: unknown; after?: unknown; requestId?: string }
interface Member { userId: string; name?: string; email?: string }

const MODULES: Array<[string, string]> = [
  ['', 'All activity'], ['auth.', 'Sign-ins & passwords'], ['users.', 'Users & roles'], ['school.', 'School settings'], ['academics.', 'Academics'],
  ['staff.', 'Staff'], ['students.', 'Students & guardians'], ['attendance.', 'Attendance'], ['imports.', 'Imports'],
];

export default function AuditPage() {
  const { me, can } = useAuth();
  const [page, setPage] = useState(1);
  const [prefix, setPrefix] = useState('');
  const [open, setOpen] = useState<string | null>(null);
  const list = useQuery({
    queryKey: ['audit', me?.activeMembershipId, page, prefix],
    queryFn: async () => get<AuditRow[]>(`/audit-logs?page=${page}&limit=50${prefix ? `&actionPrefix=${encodeURIComponent(prefix)}` : ''}`),
    placeholderData: (p) => p,
  });
  const members = useQuery({ queryKey: ['users-names', me?.activeMembershipId], enabled: can('users:read'), queryFn: async () => (await get<Member[]>('/users?limit=100')).data });
  const who = new Map((members.data ?? []).map((m) => [m.userId, m.name ?? m.email ?? m.userId]));
  const meta = list.data?.meta;

  return (
    <div className="mx-auto max-w-5xl space-y-4">
      <PageHeader title="Audit log" description="Every change and sign-in in this school, newest first. Entries cannot be edited or deleted." />
      <Select aria-label="Filter by area" className="max-w-64" value={prefix} onChange={(e) => { setPrefix(e.target.value); setPage(1); }}>
        {MODULES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
      </Select>
      {list.isLoading ? <Skeleton className="h-40" /> : null}
      {list.error ? <Alert>{errorText(list.error)}</Alert> : null}
      {list.data && list.data.data.length === 0 ? <Alert tone="info">No entries.</Alert> : null}
      {list.data && list.data.data.length > 0 ? (
        <Table minWidth={640} testId="audit-table">
          <thead className="border-b border-border"><tr><Th>When</Th><Th>Who</Th><Th>What</Th><Th>Record</Th><Th /></tr></thead>
          <tbody>
            {list.data.data.map((r) => (
              <Fragment key={r.id}>
                <tr className="border-b border-border">
                  <Td className="whitespace-nowrap">{new Date(r.at).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })}</Td>
                  <Td>{r.actorUserId ? who.get(r.actorUserId) ?? 'Unknown user' : 'System'}</Td>
                  <Td className="font-mono text-xs">{r.action}</Td>
                  <Td className="text-xs text-muted-foreground">{r.entityType ?? '—'}</Td>
                  <Td className="text-right">{r.before !== undefined || r.after !== undefined ? <Button size="sm" variant="ghost" aria-expanded={open === r.id} onClick={() => setOpen(open === r.id ? null : r.id)}>{open === r.id ? 'Hide' : 'Details'}</Button> : null}</Td>
                </tr>
                {open === r.id ? (
                  <tr className="border-b border-border bg-muted/40">
                    <td colSpan={5} className="p-3">
                      <div className="grid gap-3 text-xs md:grid-cols-2">
                        {r.before !== undefined ? <div><p className="mb-1 font-medium">Before</p><pre className="overflow-x-auto whitespace-pre-wrap break-all rounded bg-card p-2">{JSON.stringify(r.before, null, 2)}</pre></div> : null}
                        {r.after !== undefined ? <div><p className="mb-1 font-medium">After</p><pre className="overflow-x-auto whitespace-pre-wrap break-all rounded bg-card p-2">{JSON.stringify(r.after, null, 2)}</pre></div> : null}
                        <p className="text-muted-foreground md:col-span-2">Request ID: {r.requestId ?? '—'}{r.entityId ? ` · Record ID: ${r.entityId}` : ''}</p>
                      </div>
                    </td>
                  </tr>
                ) : null}
              </Fragment>
            ))}
          </tbody>
        </Table>
      ) : null}
      {meta && meta.totalPages > 1 ? (
        <div className="flex items-center justify-between text-sm">
          <span className="text-muted-foreground">page {meta.page} of {meta.totalPages}</span>
          <div className="flex gap-2">
            <Button size="sm" variant="outline" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>Newer</Button>
            <Button size="sm" variant="outline" disabled={page >= meta.totalPages} onClick={() => setPage((p) => p + 1)}>Older</Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
