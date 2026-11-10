'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { errorText, get } from '@/lib/api';
import { Alert, Button, PageHeader, Select, Skeleton, Table, Td, Th } from '@/components/ui/primitives';

interface Row { id: string; at: string; action: string; schoolId: string | null; entityType?: string; actorUserId: string | null; requestId?: string }
interface SchoolRow { id: string; name: string }

export default function PlatformAudit() {
  const [page, setPage] = useState(1);
  const [schoolId, setSchoolId] = useState('');
  const schools = useQuery({ queryKey: ['pl-schools'], queryFn: async () => (await get<SchoolRow[]>('/platform/schools')).data });
  const name = new Map((schools.data ?? []).map((s) => [s.id, s.name]));
  const list = useQuery({ queryKey: ['pl-audit', page, schoolId], queryFn: async () => get<Row[]>(`/platform/audit?page=${page}&limit=50${schoolId ? `&schoolId=${schoolId}` : ''}`), placeholderData: (p) => p });
  const meta = list.data?.meta;
  return (
    <div className="space-y-4">
      <PageHeader title="Platform audit log" description="Every recorded action across the platform, newest first. Read-only." />
      <Select aria-label="School" className="max-w-72" value={schoolId} onChange={(e) => { setSchoolId(e.target.value); setPage(1); }}>
        <option value="">All schools and platform events</option>
        {(schools.data ?? []).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
      </Select>
      {list.isLoading ? <Skeleton className="h-40" /> : null}
      {list.error ? <Alert>{errorText(list.error)}</Alert> : null}
      {list.data ? (
        <Table minWidth={640} testId="pl-audit">
          <thead className="border-b border-border"><tr><Th>When</Th><Th>Action</Th><Th>School</Th><Th>Record</Th><Th>Request</Th></tr></thead>
          <tbody>
            {list.data.data.map((r) => (
              <tr key={r.id} className="border-b border-border last:border-0">
                <Td className="whitespace-nowrap">{new Date(r.at).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })}</Td>
                <Td className="font-mono text-xs">{r.action}</Td><Td>{r.schoolId ? name.get(r.schoolId) ?? r.schoolId : 'platform'}</Td>
                <Td className="text-xs text-muted-foreground">{r.entityType ?? '—'}</Td><Td className="font-mono text-xs text-muted-foreground">{r.requestId?.slice(0, 8) ?? ''}</Td>
              </tr>
            ))}
          </tbody>
        </Table>
      ) : null}
      {meta && meta.totalPages > 1 ? (
        <div className="flex justify-end gap-2"><Button size="sm" variant="outline" disabled={page <= 1} onClick={() => setPage(page - 1)}>Newer</Button><Button size="sm" variant="outline" disabled={page >= meta.totalPages} onClick={() => setPage(page + 1)}>Older</Button></div>
      ) : null}
    </div>
  );
}
