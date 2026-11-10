'use client';

import { useQuery } from '@tanstack/react-query';
import { Printer } from 'lucide-react';
import { errorText, get } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import type { TimetableView } from '@/lib/timetable';
import { TimetableGrid } from '@/components/timetable-grid';
import { Alert, Button, PageHeader, Skeleton } from '@/components/ui/primitives';

export function PrintButton() {
  return <Button variant="outline" size="sm" className="print:hidden" onClick={() => window.print()} data-testid="print-timetable"><Printer className="h-4 w-4" aria-hidden /> Print</Button>;
}

/** A read-only timetable fetched from a path that derives the class on the server (students, a linked child). */
export function OwnTimetable({ path, title, show, testId }: { path: string; title?: string; show: 'teacher' | 'section'; testId?: string }) {
  const { me } = useAuth();
  const q = useQuery({ queryKey: ['tt-own', me?.activeMembershipId, path], queryFn: async () => (await get<TimetableView>(path)).data, retry: false });
  return (
    <div className="mx-auto max-w-6xl space-y-3">
      {title ? <PageHeader title={title} actions={<PrintButton />} /> : <div className="flex justify-end"><PrintButton /></div>}
      {q.isLoading ? <Skeleton className="h-40" /> : null}
      {q.error ? <Alert>{errorText(q.error)}</Alert> : null}
      {q.data && !q.data.version ? <Alert tone="info">No timetable has been published yet.</Alert> : null}
      {q.data?.version ? (
        <>
          <p className="text-sm text-muted-foreground print:text-black" data-testid="tt-caption">{q.data.section ?? q.data.teacher ?? ''} · {q.data.version.name} (version {q.data.version.versionNo})</p>
          <TimetableGrid data={q.data} show={show} testId={testId} />
        </>
      ) : null}
    </div>
  );
}
