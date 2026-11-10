'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { ArrowLeft } from 'lucide-react';
import { errorText, get, put } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import type { ExamDetail } from '@/lib/exams';
import { sectionLabel, sortSections, useSections } from '@/lib/lookups';
import { cn } from '@/lib/utils';
import { Alert, Button, Card, PageHeader, Select, Skeleton } from '@/components/ui/primitives';

interface Sheet { exam: { status: string }; subject: { maxMarks: number; passMarks: number }; students: Array<{ studentId: string; rollNo: number | null; name: string; admissionNo: string; obtained: number | null; status: string | null }> }
type Entry = { value: string; status: 'entered' | 'absent' | 'exempt' };

export default function MarksPage() {
  const { id } = useParams<{ id: string }>();
  const { me } = useAuth();
  const assigned = me?.permissions.find((p) => p.key === 'marks:create')?.scope === 'assigned';
  const exam = useQuery({ queryKey: ['exam', me?.activeMembershipId, id], queryFn: async () => (await get<ExamDetail>(`/exams/${id}`)).data });
  const sections = useSections({ mine: assigned });
  const options = sortSections((sections.data ?? []).filter((s) => exam.data?.classIds.includes(s.classId)));
  const [sectionId, setSectionId] = useState('');
  const [subjectId, setSubjectId] = useState('');
  const section = options.find((s) => s.id === sectionId);
  const subjects = (exam.data?.subjects ?? []).filter((s) => s.classId === section?.classId);
  useEffect(() => { if (!sectionId && options.length) setSectionId(options[0]!.id); }, [options, sectionId]);
  useEffect(() => { if (subjects.length && !subjects.some((s) => s.subjectId === subjectId)) setSubjectId(subjects[0]!.subjectId); }, [subjects, subjectId]);

  const sheet = useQuery({ queryKey: ['marks-sheet', me?.activeMembershipId, id, sectionId, subjectId], enabled: Boolean(sectionId && subjectId), retry: false, queryFn: async () => (await get<Sheet>(`/exams/${id}/marks?sectionId=${sectionId}&subjectId=${subjectId}`)).data });
  const [entries, setEntries] = useState<Record<string, Entry>>({});
  const [saved, setSaved] = useState<string | null>(null);
  useEffect(() => {
    if (!sheet.data) return;
    setEntries(Object.fromEntries(sheet.data.students.map((s) => [s.studentId, { value: s.obtained === null ? '' : String(s.obtained), status: (s.status ?? 'entered') as Entry['status'] }])));
  }, [sheet.data]);
  useEffect(() => { setSaved(null); }, [sectionId, subjectId]);

  const max = sheet.data?.subject.maxMarks ?? 0;
  const invalid = useMemo(() => Object.entries(entries).filter(([, e]) => e.status === 'entered' && e.value !== '' && (!/^\d+(\.\d{1,2})?$/.test(e.value) || Number(e.value) > max)).map(([k]) => k), [entries, max]);
  const save = useMutation({
    mutationFn: async () => put<{ saved: number }>(`/exams/${id}/marks`, {
      sectionId, subjectId,
      entries: Object.entries(entries).filter(([, e]) => e.status !== 'entered' || e.value !== '').map(([studentId, e]) => ({ studentId, status: e.status, obtained: e.status === 'entered' ? Number(e.value) : null })),
    }),
    onSuccess: (r) => setSaved(`Saved marks for ${r.data.saved} students.`),
  });
  const open = exam.data?.status === 'marks_open';

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <Link href={`/app/exams/${id}`} className="inline-flex min-h-11 items-center gap-1 text-sm text-muted-foreground hover:text-foreground"><ArrowLeft className="h-4 w-4" aria-hidden /> {exam.data?.name ?? 'Exam'}</Link>
      <PageHeader title="Enter marks" description={sheet.data ? `Max ${sheet.data.subject.maxMarks} · pass ${sheet.data.subject.passMarks}. Leave empty if not yet marked — an empty mark is never treated as zero.` : undefined} />
      {!open && exam.data ? <Alert tone="info">Marks entry is not open for this exam.</Alert> : null}
      <Card className="grid gap-2 p-3 sm:grid-cols-2">
        <Select aria-label="Section" value={sectionId} onChange={(e) => setSectionId(e.target.value)} data-testid="marks-section">{options.map((s) => <option key={s.id} value={s.id}>{sectionLabel(s)}</option>)}</Select>
        <Select aria-label="Subject" value={subjectId} onChange={(e) => setSubjectId(e.target.value)} data-testid="marks-subject">{subjects.map((s) => <option key={s.subjectId} value={s.subjectId}>{s.subject}</option>)}</Select>
      </Card>
      {options.length === 0 && !sections.isLoading ? <Alert tone="info">You are not assigned to any class in this exam.</Alert> : null}
      {sheet.isLoading ? <Skeleton className="h-40" /> : null}
      {sheet.error ? <Alert>{errorText(sheet.error)}</Alert> : null}
      {saved ? <Alert tone="success"><span data-testid="marks-saved">{saved}</span></Alert> : null}
      {save.error ? <Alert>{errorText(save.error)}</Alert> : null}
      {sheet.data ? (
        <Card className="overflow-hidden">
          <ul className="divide-y divide-border">
            {sheet.data.students.map((s) => {
              const e = entries[s.studentId] ?? { value: '', status: 'entered' as const };
              const bad = invalid.includes(s.studentId);
              return (
                <li key={s.studentId} className="flex flex-wrap items-center justify-between gap-2 p-3" data-testid={`marks-row-${s.admissionNo}`}>
                  <div className="min-w-0"><p className="truncate text-sm font-medium">{s.rollNo ? `${s.rollNo}. ` : ''}{s.name}</p><p className="text-xs text-muted-foreground">{s.admissionNo}</p></div>
                  <div className="flex items-center gap-1.5">
                    <input aria-label={`Marks for ${s.name}`} inputMode="decimal" disabled={!open || e.status !== 'entered'} value={e.status === 'entered' ? e.value : ''}
                      onChange={(ev) => setEntries({ ...entries, [s.studentId]: { ...e, value: ev.target.value } })}
                      className={cn('min-h-11 w-20 rounded-lg border bg-card px-2 text-right text-sm', bad ? 'border-danger' : 'border-input')} data-testid={`marks-${s.admissionNo}`} />
                    {(['absent', 'exempt'] as const).map((st) => (
                      <button key={st} type="button" disabled={!open} aria-pressed={e.status === st} onClick={() => setEntries({ ...entries, [s.studentId]: { value: '', status: e.status === st ? 'entered' : st } })}
                        className={cn('min-h-11 min-w-11 rounded-lg border border-input text-xs font-semibold disabled:opacity-50', e.status === st ? 'bg-warning text-white' : 'bg-card')}>{st === 'absent' ? 'AB' : 'EX'}</button>
                    ))}
                  </div>
                </li>
              );
            })}
          </ul>
          <div className="sticky bottom-0 border-t border-border bg-card p-3">
            {invalid.length ? <p className="mb-2 text-sm text-danger">{invalid.length} mark(s) are not valid (0–{max}, at most 2 decimals).</p> : null}
            <Button className="w-full" disabled={!open || save.isPending || invalid.length > 0} onClick={() => save.mutate()} data-testid="save-marks">{save.isPending ? 'Saving…' : 'Save marks'}</Button>
          </div>
        </Card>
      ) : null}
    </div>
  );
}
