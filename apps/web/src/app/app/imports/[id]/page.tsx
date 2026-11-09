'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Download } from 'lucide-react';
import { IMPORT_DATE_FORMATS, type ImportDateFormat, type ImportMapping } from '@edunex/shared';
import { downloadFile, errorText, get, newIdempotencyKey, post, put } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { importStatusLabel, importStatusTone, type ImportDetail } from '@/lib/imports';
import { Alert, Badge, Button, Card, PageHeader, Select, Skeleton, Table, Td, Th } from '@/components/ui/primitives';

const DATE_LABEL: Record<ImportDateFormat, string> = { DMY: 'Day/Month/Year (31/12/2015)', MDY: 'Month/Day/Year (12/31/2015)', YMD: 'Year-Month-Day (2015-12-31)' };

function Stat({ label, value, tone }: { label: string; value: number; tone?: string }) {
  return (
    <div className="rounded-lg border border-border p-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className={`text-2xl font-semibold ${tone ?? ''}`}>{value}</p>
    </div>
  );
}

export default function ImportBatchPage() {
  const { id } = useParams<{ id: string }>();
  const { me, can } = useAuth();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['import', me?.activeMembershipId, id], queryFn: async () => (await get<ImportDetail>(`/imports/${id}`)).data, retry: false });
  const [mapping, setMapping] = useState<ImportMapping>({});
  const [dateFormat, setDateFormat] = useState<ImportDateFormat>('DMY');
  const [commitKey] = useState(newIdempotencyKey); // one key per page visit: retries/double-clicks never import twice
  const [dlError, setDlError] = useState<string | null>(null);

  useEffect(() => {
    if (!q.data) return;
    setMapping(q.data.mapping);
    setDateFormat(q.data.options.dateFormat);
  }, [q.data]);

  const onDone = (b: ImportDetail) => {
    qc.setQueryData(['import', me?.activeMembershipId, id], b);
    void qc.invalidateQueries({ queryKey: ['imports'] });
    void qc.invalidateQueries({ queryKey: ['students'] });
  };
  const check = useMutation({
    mutationFn: async () => {
      await put(`/imports/${id}/mapping`, { mapping, dateFormat });
      return (await post<ImportDetail>(`/imports/${id}/validate`, {})).data;
    },
    onSuccess: onDone,
  });
  const commit = useMutation({ mutationFn: async () => (await post<ImportDetail>(`/imports/${id}/commit`, {}, { idempotencyKey: commitKey })).data, onSuccess: onDone });
  const rollback = useMutation({ mutationFn: async () => (await post<ImportDetail>(`/imports/${id}/rollback`, {})).data, onSuccess: onDone });

  if (q.isLoading) return <Skeleton className="mx-auto h-60 max-w-5xl" />;
  if (q.error || !q.data) return <div className="mx-auto max-w-5xl"><Alert>{errorText(q.error, 'Import not found')}</Alert></div>;
  const b = q.data;
  const editable = b.status === 'uploaded' || b.status === 'validated';
  const used = new Map<number, string>();
  for (const [k, v] of Object.entries(mapping)) if (typeof v === 'number') used.set(v, k);
  const dirty = JSON.stringify(mapping) !== JSON.stringify(b.mapping) || dateFormat !== b.options.dateFormat;
  const sampleOf = (col: number) => b.sample.map((r) => r[col]).filter(Boolean).slice(0, 3).join(' · ');

  return (
    <div className="mx-auto max-w-5xl space-y-4">
      <Link href="/app/imports" className="inline-flex min-h-11 items-center gap-1 text-sm text-muted-foreground hover:text-foreground"><ArrowLeft className="h-4 w-4" aria-hidden /> Imports</Link>
      <PageHeader title={b.filename} description={`${b.rowCount} data rows · uploaded ${new Date(b.createdAt).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })}`} actions={<Badge tone={importStatusTone(b.status)}>{importStatusLabel[b.status]}</Badge>} />
      {b.failureReason ? <Alert>Import failed: {b.failureReason}. Rows saved before the failure can be rolled back.</Alert> : null}

      {editable ? (
        <Card className="space-y-3 p-4">
          <h2 className="font-medium">1. Match your columns</h2>
          <p className="text-sm text-muted-foreground">We matched what we could from your headings. Fields marked * are required. Unmatched columns are ignored.</p>
          <div className="grid gap-3 sm:grid-cols-2">
            {b.fields.map((f) => {
              const v = mapping[f.key as keyof ImportMapping];
              return (
                <label key={f.key} className="block min-w-0 text-sm">
                  <span className="mb-1 block font-medium">{f.label}{f.required ? ' *' : ''}{f.orKey ? <span className="font-normal text-muted-foreground"> (or {b.fields.find((x) => x.key === f.orKey)?.label})</span> : null}</span>
                  <Select
                    aria-label={`Column for ${f.label}`}
                    data-testid={`map-${f.key}`}
                    value={typeof v === 'number' ? String(v) : ''}
                    onChange={(e) => setMapping((m) => ({ ...m, [f.key]: e.target.value === '' ? null : Number(e.target.value) }))}
                  >
                    <option value="">— not in file —</option>
                    {b.headers.map((h, i) => (
                      <option key={i} value={i} disabled={used.has(i) && used.get(i) !== f.key}>{h || `Column ${i + 1}`}</option>
                    ))}
                  </Select>
                  <span className="mt-1 block truncate text-xs text-muted-foreground">{typeof v === 'number' ? sampleOf(v) || 'empty in the first rows' : f.hint ?? ''}</span>
                </label>
              );
            })}
          </div>
          <label className="block max-w-sm text-sm">
            <span className="mb-1 block font-medium">Dates in this file are written as</span>
            <Select value={dateFormat} onChange={(e) => setDateFormat(e.target.value as ImportDateFormat)} aria-label="Date order">
              {IMPORT_DATE_FORMATS.map((d) => <option key={d} value={d}>{DATE_LABEL[d]}</option>)}
            </Select>
          </label>
          {check.error ? <Alert>{errorText(check.error)}</Alert> : null}
          <Button onClick={() => check.mutate()} disabled={check.isPending} data-testid="check-rows">{check.isPending ? 'Checking…' : b.status === 'validated' && !dirty ? 'Check again' : 'Check rows'}</Button>
        </Card>
      ) : null}

      {b.status !== 'uploaded' ? (
        <Card className="space-y-3 p-4">
          <h2 className="font-medium">{editable ? '2. Review' : 'Result'}</h2>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4" data-testid="import-counts">
            {b.status === 'validated' ? <Stat label="Ready to import" value={b.counts.ok} tone="text-success" /> : <Stat label="Imported" value={b.counts.created} tone="text-success" />}
            <Stat label="Already exist (skipped)" value={b.counts.duplicate} />
            <Stat label="Problems (skipped)" value={b.counts.error} tone={b.counts.error ? 'text-danger' : ''} />
            {b.status === 'rolled_back' ? <Stat label="Rolled back / kept" value={b.counts.rolledBack} /> : <Stat label="Rows in file" value={b.counts.total} />}
          </div>
          {b.status === 'rolled_back' && b.counts.kept > 0 ? <Alert tone="info">{b.counts.kept} imported students were kept because they were edited or used (e.g. attendance) after the import. They are listed in the problem file.</Alert> : null}
          {b.problems.length > 0 || b.counts.kept > 0 ? (
            <div className="flex flex-wrap items-center gap-2">
              <Button variant="outline" size="sm" onClick={() => { setDlError(null); downloadFile(`/imports/${id}/errors.csv`, 'import-problems.csv').catch((e) => setDlError(errorText(e))); }} data-testid="download-problems">
                <Download className="h-4 w-4" aria-hidden /> Download problem rows (CSV)
              </Button>
              <span className="text-xs text-muted-foreground">Fix them in the file and upload it again — rows that already exist are skipped automatically.</span>
            </div>
          ) : null}
          {dlError ? <Alert>{dlError}</Alert> : null}
          {b.problems.length > 0 ? (
            <Table minWidth={520} testId="problems-table">
              <thead className="border-b border-border"><tr><Th>Line</Th><Th>Problem</Th></tr></thead>
              <tbody>
                {b.problems.slice(0, 50).map((p) => (
                  <tr key={p.line} className="border-b border-border last:border-0">
                    <Td>{p.line}</Td>
                    <Td><Badge tone={p.status === 'duplicate' ? 'muted' : 'danger'}>{p.status === 'duplicate' ? 'exists' : 'problem'}</Badge> <span className="ml-1">{p.messages.join('; ')}</span></Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          ) : null}
          {b.problems.length > 50 ? <p className="text-xs text-muted-foreground">Showing 50 of {b.counts.error + b.counts.duplicate} — download the file for all of them.</p> : null}

          {b.status === 'validated' && b.preview.length > 0 ? (
            <>
              <h3 className="text-sm font-medium">Preview — how the first rows will be saved</h3>
              <Table minWidth={720} testId="preview-table">
                <thead className="border-b border-border"><tr><Th>Line</Th><Th>Adm. no.</Th><Th>Name</Th><Th>DOB</Th><Th>Class</Th><Th>Roll</Th><Th>Guardian</Th></tr></thead>
                <tbody>
                  {b.preview.map((r) => (
                    <tr key={r.line} className="border-b border-border last:border-0">
                      <Td>{r.line}</Td><Td>{r.admissionNo}</Td><Td>{r.name}</Td><Td>{r.dob}</Td><Td>{r.class ?? '—'}</Td><Td>{r.rollNo ?? '—'}</Td><Td>{r.guardian ?? '—'}</Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            </>
          ) : null}

          {b.status === 'validated' && !dirty ? (
            can('imports:approve') ? (
              <div className="space-y-2 border-t border-border pt-3">
                <h2 className="font-medium">3. Import</h2>
                {commit.error ? <Alert>{errorText(commit.error)}</Alert> : null}
                <Button
                  disabled={commit.isPending || b.counts.ok === 0}
                  data-testid="commit-import"
                  onClick={() => { if (window.confirm(`Import ${b.counts.ok} students now? Rows with problems are skipped.`)) commit.mutate(); }}
                >
                  {commit.isPending ? 'Importing…' : `Import ${b.counts.ok} students`}
                </Button>
              </div>
            ) : <Alert tone="info">Ask an Owner or Admin to approve this import.</Alert>
          ) : null}
          {dirty && b.status === 'validated' ? <Alert tone="info">You changed the column matching — check the rows again before importing.</Alert> : null}

          {(b.status === 'committed' || b.status === 'failed') && can('imports:approve') ? (
            <div className="space-y-2 border-t border-border pt-3">
              {rollback.error ? <Alert>{errorText(rollback.error)}</Alert> : null}
              <Button
                variant="danger"
                disabled={rollback.isPending}
                data-testid="rollback-import"
                onClick={() => { if (window.confirm('Remove the students this import created? Students that were edited or used since (e.g. attendance marked) are kept.')) rollback.mutate(); }}
              >
                {rollback.isPending ? 'Rolling back…' : 'Undo this import'}
              </Button>
            </div>
          ) : null}
        </Card>
      ) : null}
    </div>
  );
}
