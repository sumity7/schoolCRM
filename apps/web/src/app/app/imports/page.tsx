'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useRef, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Download, FileUp } from 'lucide-react';
import { IMPORT_MAX_CHARS, IMPORT_MAX_ROWS } from '@edunex/shared';
import { downloadFile, errorText, get, post } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { importStatusLabel, importStatusTone, type ImportDetail, type ImportSummary } from '@/lib/imports';
import { Alert, Badge, Button, Card, PageHeader, Skeleton, Table, Td, Th } from '@/components/ui/primitives';

export default function ImportsPage() {
  const router = useRouter();
  const { me } = useAuth();
  const fileRef = useRef<HTMLInputElement>(null);
  const [localError, setLocalError] = useState<string | null>(null);
  const history = useQuery({ queryKey: ['imports', me?.activeMembershipId], queryFn: async () => (await get<ImportSummary[]>('/imports?limit=50')).data });

  const upload = useMutation({
    mutationFn: async (file: File) => {
      const csv = await file.text();
      return (await post<ImportDetail>('/imports', { entity: 'students', filename: file.name, csv })).data;
    },
    onSuccess: (b) => router.push(`/app/imports/${b.id}`),
  });

  function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    setLocalError(null);
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (/\.(xlsx?|ods)$/i.test(file.name)) {
      setLocalError('Excel files must be saved as CSV first: in Excel choose File → Save As → "CSV UTF-8 (Comma delimited)".');
      return;
    }
    if (file.size > IMPORT_MAX_CHARS) {
      setLocalError(`This file is larger than about 3 MB. Split it into files of at most ${IMPORT_MAX_ROWS} rows.`);
      return;
    }
    upload.mutate(file);
  }

  return (
    <div className="mx-auto max-w-4xl space-y-4">
      <PageHeader title="Import students" description={`Upload a CSV file (up to ${IMPORT_MAX_ROWS.toLocaleString('en-IN')} rows). You will match columns and see every problem row before anything is saved.`} />
      <Card className="space-y-3 p-4">
        <ol className="list-decimal space-y-1 pl-5 text-sm text-muted-foreground">
          <li>Create the academic session, classes and sections first — rows are matched to them by name.</li>
          <li>Download the template, or use your own file with a heading row.</li>
          <li>Upload, match columns, check rows, then import. Rows with problems are skipped and listed so you can fix and re-upload them.</li>
        </ol>
        <div className="flex flex-wrap gap-2">
          <input ref={fileRef} type="file" accept=".csv,text/csv" className="sr-only" onChange={onFile} data-testid="import-file" aria-label="CSV file" />
          <Button onClick={() => fileRef.current?.click()} disabled={upload.isPending}><FileUp className="h-4 w-4" aria-hidden /> {upload.isPending ? 'Uploading…' : 'Choose CSV file'}</Button>
          <Button variant="outline" onClick={() => downloadFile('/imports/template.csv', 'student-import-template.csv').catch((e) => setLocalError(errorText(e)))}><Download className="h-4 w-4" aria-hidden /> Template</Button>
        </div>
        {localError ? <Alert>{localError}</Alert> : null}
        {upload.error ? <Alert>{errorText(upload.error, 'Upload failed')}</Alert> : null}
      </Card>

      <h2 className="font-medium">History</h2>
      {history.isLoading ? <Skeleton className="h-24" /> : null}
      {history.error ? <Alert>{errorText(history.error)}</Alert> : null}
      {history.data && history.data.length === 0 ? <Alert tone="info">No imports yet.</Alert> : null}
      {history.data && history.data.length > 0 ? (
        <Table minWidth={560} testId="imports-table">
          <thead className="border-b border-border"><tr><Th>File</Th><Th>Uploaded</Th><Th>Rows</Th><Th>Imported</Th><Th>Status</Th></tr></thead>
          <tbody>
            {history.data.map((b) => (
              <tr key={b.id} className="border-b border-border last:border-0">
                <Td><Link href={`/app/imports/${b.id}`} className="font-medium text-primary hover:underline">{b.filename}</Link></Td>
                <Td>{new Date(b.createdAt).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })}</Td>
                <Td>{b.rowCount}</Td>
                <Td>{b.counts.created || '—'}</Td>
                <Td><Badge tone={importStatusTone(b.status)}>{importStatusLabel[b.status]}</Badge></Td>
              </tr>
            ))}
          </tbody>
        </Table>
      ) : null}
    </div>
  );
}
