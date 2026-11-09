'use client';

import Link from 'next/link';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Download, Plus, Upload } from 'lucide-react';
import { downloadFile, errorText, get } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { sectionLabel, sortSections, useSections } from '@/lib/lookups';
import { statusTone, type StudentRow } from '@/lib/students';
import { Alert, Badge, Button, Input, PageHeader, Select, Skeleton, Table, Td, Th } from '@/components/ui/primitives';

export default function StudentsPage() {
  const { me, can } = useAuth();
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const [sectionId, setSectionId] = useState('');
  const [status, setStatus] = useState('active');
  const [exportError, setExportError] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const sections = useSections({ enabled: can('academics:read') });
  const secBy = new Map((sections.data ?? []).map((s) => [s.id, s]));

  const params = new URLSearchParams({ page: String(page), limit: '25' });
  if (q) params.set('q', q);
  if (sectionId) params.set('sectionId', sectionId);
  if (status) params.set('status', status);
  const list = useQuery({
    queryKey: ['students', me?.activeMembershipId, params.toString()],
    queryFn: async () => get<StudentRow[]>(`/students?${params.toString()}`),
    placeholderData: (prev) => prev,
  });
  const meta = list.data?.meta;

  async function exportCsv() {
    setExportError(null);
    setExporting(true);
    try {
      const p = new URLSearchParams();
      if (sectionId) p.set('sectionId', sectionId);
      if (status) p.set('status', status);
      await downloadFile(`/students/export.csv${p.toString() ? `?${p}` : ''}`, 'students.csv');
    } catch (e) {
      setExportError(errorText(e, 'Export failed'));
    } finally {
      setExporting(false);
    }
  }

  return (
    <div className="mx-auto max-w-5xl space-y-4">
      <PageHeader
        title="Students"
        actions={
          <>
            {can('students:export') ? <Button variant="outline" onClick={exportCsv} disabled={exporting} data-testid="export-students"><Download className="h-4 w-4" aria-hidden /> {exporting ? 'Exporting…' : 'Export CSV'}</Button> : null}
            {can('imports:create') ? <Link href="/app/imports" className="inline-flex min-h-11 items-center gap-2 rounded-lg border border-input bg-card px-4 text-sm font-medium hover:bg-muted"><Upload className="h-4 w-4" aria-hidden /> Import</Link> : null}
            {can('students:create') ? <Link href="/app/students/new" className="inline-flex min-h-11 items-center gap-2 rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground hover:opacity-90" data-testid="add-student"><Plus className="h-4 w-4" aria-hidden /> Add student</Link> : null}
          </>
        }
      />
      <div className="grid gap-2 sm:grid-cols-[1fr_200px_160px]">
        <Input placeholder="Search by name, admission number or phone" aria-label="Search students" value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} data-testid="student-search" />
        {can('academics:read') ? (
          <Select aria-label="Filter by section" value={sectionId} onChange={(e) => { setSectionId(e.target.value); setPage(1); }}>
            <option value="">All classes</option>
            {sortSections(sections.data ?? []).map((s) => <option key={s.id} value={s.id}>{sectionLabel(s)}</option>)}
          </Select>
        ) : null}
        <Select aria-label="Filter by status" value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }}>
          <option value="">Any status</option>
          {['active', 'transferred', 'withdrawn', 'graduated', 'alumni'].map((s) => <option key={s} value={s} className="capitalize">{s[0]!.toUpperCase() + s.slice(1)}</option>)}
        </Select>
      </div>
      {exportError ? <Alert>{exportError}</Alert> : null}
      {list.error ? <Alert>{errorText(list.error, 'Could not load students')}</Alert> : null}
      {list.isLoading ? <Skeleton className="h-40 w-full" /> : null}
      {list.data && list.data.data.length === 0 ? <Alert tone="info">{q || sectionId ? 'No students match these filters.' : 'No students to show yet.'}</Alert> : null}
      {list.data && list.data.data.length > 0 ? (
        <Table testId="students-table" minWidth={560}>
          <thead className="border-b border-border">
            <tr><Th>Admission no.</Th><Th>Name</Th><Th>Class</Th><Th>Roll</Th><Th>Status</Th></tr>
          </thead>
          <tbody>
            {list.data.data.map((s) => {
              const sec = s.enrollment && s.enrollment.status === 'active' ? secBy.get(s.enrollment.sectionId) : undefined;
              return (
                <tr key={s.id} className="border-b border-border last:border-0 hover:bg-muted/50">
                  <Td>{s.admissionNo}</Td>
                  <Td className="font-medium"><Link href={`/app/students/${s.id}`} className="text-primary hover:underline">{s.firstName} {s.lastName}</Link></Td>
                  <Td>{sec ? sectionLabel(sec) : '—'}</Td>
                  <Td>{s.enrollment?.status === 'active' ? s.enrollment.rollNo ?? '—' : '—'}</Td>
                  <Td><Badge tone={statusTone(s.status)}>{s.status}</Badge></Td>
                </tr>
              );
            })}
          </tbody>
        </Table>
      ) : null}
      {meta ? (
        <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
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
