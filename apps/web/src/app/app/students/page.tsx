'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ApiError, get } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { Alert, Button, Card, Input, Skeleton } from '@/components/ui/primitives';

interface StudentRow { id: string; admissionNo: string; firstName: string; lastName?: string; status: string; gender?: string; enrollment: { sectionId: string; rollNo?: number } | null }

export default function StudentsPage() {
  const { me } = useAuth();
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const list = useQuery({
    queryKey: ['students', me?.activeMembershipId, q, page],
    queryFn: async () => get<StudentRow[]>(`/students?page=${page}&limit=25${q ? `&q=${encodeURIComponent(q)}` : ''}`),
    placeholderData: (prev) => prev,
  });
  const meta = list.data?.meta;
  return (
    <div className="mx-auto max-w-4xl space-y-4">
      <h1 className="text-xl font-semibold">Students</h1>
      <Input placeholder="Search by name, admission number or phone" aria-label="Search students" value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} data-testid="student-search" />
      {list.error ? <Alert>{list.error instanceof ApiError ? list.error.message : 'Could not load students'}</Alert> : null}
      {list.isLoading ? <Skeleton className="h-40 w-full" /> : null}
      {list.data && list.data.data.length === 0 ? <Alert tone="info">{q ? 'No students match your search.' : 'No students to show yet.'}</Alert> : null}
      {list.data && list.data.data.length > 0 ? (
        <Card className="overflow-x-auto">
          <table className="w-full min-w-[480px] text-sm" data-testid="students-table">
            <thead className="border-b border-border text-left text-xs text-muted-foreground">
              <tr><th className="p-3">Admission no.</th><th className="p-3">Name</th><th className="p-3">Roll</th><th className="p-3">Status</th></tr>
            </thead>
            <tbody>
              {list.data.data.map((s) => (
                <tr key={s.id} className="border-b border-border last:border-0">
                  <td className="p-3">{s.admissionNo}</td>
                  <td className="p-3 font-medium">{s.firstName} {s.lastName}</td>
                  <td className="p-3">{s.enrollment?.rollNo ?? '—'}</td>
                  <td className="p-3 capitalize">{s.status}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      ) : null}
      {meta ? (
        <div className="flex items-center justify-between text-sm">
          <span className="text-muted-foreground">{meta.total} students · page {meta.page} of {meta.totalPages}</span>
          <div className="flex gap-2">
            <Button size="sm" variant="outline" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>Previous</Button>
            <Button size="sm" variant="outline" disabled={page >= meta.totalPages} onClick={() => setPage((p) => p + 1)}>Next</Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
