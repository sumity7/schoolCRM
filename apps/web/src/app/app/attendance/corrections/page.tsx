'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { errorText, get, post } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { sectionLabel, useSections } from '@/lib/lookups';
import { Alert, Badge, Button, PageHeader, Select, Skeleton, Table, Td, Th } from '@/components/ui/primitives';

interface Correction { id: string; studentId: string; studentName: string | null; admissionNo: string | null; sectionId: string; date: string; from: string | null; to: string; reason: string; status: string; requestedBy: string }

export default function CorrectionsPage() {
  const { me } = useAuth();
  const qc = useQueryClient();
  const [status, setStatus] = useState<'pending' | 'approved' | 'rejected'>('pending');
  const sections = useSections();
  const secBy = new Map((sections.data ?? []).map((s) => [s.id, s]));
  const list = useQuery({ queryKey: ['corrections', me?.activeMembershipId, status], queryFn: async () => (await get<Correction[]>(`/attendance/corrections?status=${status}&limit=100`)).data });
  const decide = useMutation({
    mutationFn: async (v: { id: string; approve: boolean }) => post(`/attendance/corrections/${v.id}/${v.approve ? 'approve' : 'reject'}`, {}),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['corrections'] }),
  });

  return (
    <div className="mx-auto max-w-5xl space-y-4">
      <PageHeader title="Attendance corrections" description="Teachers request changes to locked days; someone other than the requester approves. Every decision is audited." />
      <Select aria-label="Status" value={status} onChange={(e) => setStatus(e.target.value as typeof status)} className="max-w-48">
        <option value="pending">Pending</option><option value="approved">Approved</option><option value="rejected">Rejected</option>
      </Select>
      {decide.error ? <Alert>{errorText(decide.error)}</Alert> : null}
      {list.isLoading ? <Skeleton className="h-24" /> : null}
      {list.error ? <Alert>{errorText(list.error)}</Alert> : null}
      {list.data && list.data.length === 0 ? <Alert tone="info">Nothing here.</Alert> : null}
      {list.data && list.data.length > 0 ? (
        <Table minWidth={720} testId="corrections-table">
          <thead className="border-b border-border"><tr><Th>Date</Th><Th>Student</Th><Th>Class</Th><Th>Change</Th><Th>Reason</Th><Th /></tr></thead>
          <tbody>
            {list.data.map((c) => (
              <tr key={c.id} className="border-b border-border last:border-0">
                <Td>{c.date}</Td>
                <Td className="font-medium">{c.studentName ?? '—'}<span className="block text-xs font-normal text-muted-foreground">{c.admissionNo}</span></Td>
                <Td>{secBy.get(c.sectionId) ? sectionLabel(secBy.get(c.sectionId)!) : '—'}</Td>
                <Td><span className="capitalize">{(c.from ?? 'not marked').replace('_', ' ')}</span> → <span className="font-medium capitalize">{c.to.replace('_', ' ')}</span></Td>
                <Td className="max-w-64 break-words">{c.reason}</Td>
                <Td className="whitespace-nowrap text-right">
                  {c.status === 'pending' ? (
                    <div className="flex justify-end gap-1">
                      <Button size="sm" disabled={decide.isPending} onClick={() => decide.mutate({ id: c.id, approve: true })}>Approve</Button>
                      <Button size="sm" variant="outline" disabled={decide.isPending} onClick={() => decide.mutate({ id: c.id, approve: false })}>Reject</Button>
                    </div>
                  ) : <Badge tone={c.status === 'approved' ? 'success' : 'muted'}>{c.status}</Badge>}
                </Td>
              </tr>
            ))}
          </tbody>
        </Table>
      ) : null}
    </div>
  );
}
