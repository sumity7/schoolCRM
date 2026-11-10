'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Download, Plus, Trash2 } from 'lucide-react';
import { errorText, get, post, put } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { EXAM_STATUS, examTone, markCell, resultTone, type ExamDetail, type ResultRow } from '@/lib/exams';
import { openReceipt } from '@/lib/fees';
import { sectionLabel, sortSections, useClasses, useSections, useSubjects } from '@/lib/lookups';
import { Alert, Badge, Button, Card, Field, Input, PageHeader, Select, Skeleton, Table, Td, Th } from '@/components/ui/primitives';
import { Modal } from '@/components/ui/modal';

export default function ExamDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { me, can } = useAuth();
  const qc = useQueryClient();
  const exam = useQuery({ queryKey: ['exam', me?.activeMembershipId, id], queryFn: async () => (await get<ExamDetail>(`/exams/${id}`)).data });
  const classes = useClasses();
  const assigned = me?.permissions.find((p) => p.key === 'results:read')?.scope === 'assigned';
  const sections = useSections({ mine: assigned });
  const clsName = new Map((classes.data ?? []).map((c) => [c.id, c.name]));
  const [sectionId, setSectionId] = useState('');
  const [msg, setMsg] = useState<string | null>(null);
  const e = exam.data;
  const examSections = sortSections((sections.data ?? []).filter((s) => e?.classIds.includes(s.classId)));
  useEffect(() => { if (!sectionId && examSections.length) setSectionId(examSections[0]!.id); }, [examSections, sectionId]);

  const results = useQuery({
    queryKey: ['exam-results', me?.activeMembershipId, id, sectionId], enabled: Boolean(sectionId) && can('results:read') && (e?.status === 'marks_locked' || e?.status === 'published'),
    queryFn: async () => (await get<ResultRow[]>(`/exams/${id}/results?sectionId=${sectionId}`)).data, retry: false,
  });
  const act = useMutation({
    mutationFn: async (path: string) => (await post<Record<string, number>>(path, {})).data,
    onSuccess: async (data, path) => {
      if (path.endsWith('/compute')) setMsg(`Computed ${data.students} results: ${data.pass} pass, ${data.fail} fail, ${data.incomplete} incomplete.`);
      await qc.invalidateQueries({ queryKey: ['exam'] }); await qc.invalidateQueries({ queryKey: ['exam-results'] }); await qc.invalidateQueries({ queryKey: ['exams'] });
    },
  });
  const [correctFor, setCorrectFor] = useState<ResultRow | null>(null);

  if (exam.isLoading) return <Skeleton className="mx-auto h-40 max-w-5xl" />;
  if (!e) return <Alert>{errorText(exam.error, 'Exam not found')}</Alert>;
  const approve = can('exams:approve');

  return (
    <div className="mx-auto max-w-5xl space-y-4">
      <Link href="/app/exams" className="inline-flex min-h-11 items-center gap-1 text-sm text-muted-foreground hover:text-foreground"><ArrowLeft className="h-4 w-4" aria-hidden /> Exams</Link>
      <PageHeader title={e.name} description={`${e.type} · ${e.classIds.map((c) => clsName.get(c) ?? '').join(', ')}`} actions={<Badge tone={examTone(e.status)}>{EXAM_STATUS[e.status]}</Badge>} />
      {act.error ? <Alert>{errorText(act.error)}</Alert> : null}
      {msg ? <Alert tone="info">{msg}</Alert> : null}

      <Card className="flex flex-wrap items-center gap-2 p-3">
        {e.status === 'marks_open' && can('marks:create') ? <Link href={`/app/exams/${e.id}/marks`} className="inline-flex min-h-11 items-center rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground" data-testid="enter-marks">Enter marks</Link> : null}
        {approve && (e.status === 'draft' || e.status === 'marks_locked') ? <Button variant="outline" disabled={act.isPending} onClick={() => act.mutate(`/exams/${e.id}/open-marks`)} data-testid="open-marks">{e.status === 'draft' ? 'Open marks entry' : 'Re-open marks entry'}</Button> : null}
        {approve && e.status === 'marks_open' ? <Button variant="outline" disabled={act.isPending} onClick={() => act.mutate(`/exams/${e.id}/lock-marks`)} data-testid="lock-marks">Lock marks</Button> : null}
        {approve && e.status === 'marks_locked' ? <Button variant="outline" disabled={act.isPending} onClick={() => act.mutate(`/exams/${e.id}/results/compute`)} data-testid="compute-results">Compute results</Button> : null}
        {can('results:publish') && e.status === 'marks_locked' ? <Button disabled={act.isPending} onClick={() => { if (window.confirm('Publish results? Parents will see them and they can no longer be edited (only corrected with a reason).')) act.mutate(`/exams/${e.id}/results/publish`); }} data-testid="publish-results">Publish results</Button> : null}
        {e.status === 'published' ? <span className="text-sm text-muted-foreground">Published {e.publishedAt ? new Date(e.publishedAt).toLocaleDateString('en-IN') : ''}. Corrections create a new version.</span> : null}
      </Card>

      <SubjectsCard exam={e} editable={e.status === 'draft' && can('exams:update')} />

      {(e.status === 'marks_locked' || e.status === 'published') && can('results:read') ? (
        <section className="space-y-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="font-medium">Results</h2>
            <Select aria-label="Section" className="max-w-56" value={sectionId} onChange={(ev) => setSectionId(ev.target.value)}>
              {examSections.map((s) => <option key={s.id} value={s.id}>{sectionLabel(s)}</option>)}
            </Select>
          </div>
          {results.isLoading ? <Skeleton className="h-24" /> : null}
          {results.error ? <Alert>{errorText(results.error)}</Alert> : null}
          {results.data && results.data.length === 0 ? <Alert tone="info">No results computed for this section yet.</Alert> : null}
          {results.data && results.data.length > 0 ? (
            <Table minWidth={720} testId="results-table">
              <thead className="border-b border-border"><tr><Th>Rank</Th><Th>Student</Th>{results.data[0]!.subjects.map((s) => <Th key={s.subjectId}>{s.subject}</Th>)}<Th>Total</Th><Th>%</Th><Th>Grade</Th><Th>Result</Th><Th /></tr></thead>
              <tbody>
                {results.data.map((r) => (
                  <tr key={r.id} className="border-b border-border last:border-0">
                    <Td>{r.rank ?? '—'}</Td>
                    <Td className="font-medium">{r.student?.name}{r.version > 1 ? <span className="ml-1"><Badge tone="warning">v{r.version}</Badge></span> : null}</Td>
                    {r.subjects.map((s) => <Td key={s.subjectId} className={s.passed === false ? 'text-danger' : ''}>{markCell(s)}</Td>)}
                    <Td>{r.totalObtained}/{r.totalMax}</Td><Td>{r.percentage ?? '—'}</Td><Td>{r.grade ?? '—'}</Td>
                    <Td><Badge tone={resultTone(r.resultStatus)}>{r.resultStatus}</Badge></Td>
                    <Td className="whitespace-nowrap text-right">
                      {r.publishedAt && can('results:print') ? <Button size="sm" variant="ghost" aria-label={`Report card for ${r.student?.name}`} onClick={() => openReceipt(r.id, `/results/${r.id}/report-card.pdf`).catch((err) => setMsg(errorText(err)))}><Download className="h-4 w-4" /></Button> : null}
                      {e.status === 'published' && can('results:approve') ? <Button size="sm" variant="ghost" onClick={() => setCorrectFor(r)}>Correct</Button> : null}
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          ) : null}
        </section>
      ) : null}
      {correctFor ? <CorrectModal examId={e.id} result={correctFor} onClose={() => setCorrectFor(null)} /> : null}
    </div>
  );
}

function SubjectsCard({ exam, editable }: { exam: ExamDetail; editable: boolean }) {
  const qc = useQueryClient();
  const subjects = useSubjects();
  const classes = useClasses();
  const clsName = new Map((classes.data ?? []).map((c) => [c.id, c.name]));
  const [rows, setRows] = useState(exam.subjects.map((s) => ({ classId: s.classId, subjectId: s.subjectId, maxMarks: String(s.maxMarks), passMarks: String(s.passMarks) })));
  const save = useMutation({
    mutationFn: async () => put(`/exams/${exam.id}/subjects`, { subjects: rows.map((r) => ({ classId: r.classId, subjectId: r.subjectId, maxMarks: Number(r.maxMarks), passMarks: Number(r.passMarks) })) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['exam'] }),
  });
  if (!editable) {
    return (
      <Card className="p-4">
        <h2 className="mb-2 font-medium">Subjects</h2>
        {exam.subjects.length === 0 ? <p className="text-sm text-muted-foreground">No subjects.</p> : (
          <ul className="grid gap-1 text-sm sm:grid-cols-2">{exam.subjects.map((s) => <li key={s.id}>{clsName.get(s.classId)} · {s.subject}: max {s.maxMarks}, pass {s.passMarks}</li>)}</ul>
        )}
      </Card>
    );
  }
  return (
    <Card className="space-y-2 p-4">
      <h2 className="font-medium">Subjects (max / pass marks)</h2>
      {rows.map((r, i) => (
        <div key={i} className="grid grid-cols-[1fr_1fr_80px_80px_auto] items-center gap-2">
          <Select aria-label="Class" className="min-h-9" value={r.classId} onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, classId: e.target.value } : x)))}>{exam.classIds.map((c) => <option key={c} value={c}>{clsName.get(c) ?? c}</option>)}</Select>
          <Select aria-label="Subject" className="min-h-9" value={r.subjectId} onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, subjectId: e.target.value } : x)))}>{(subjects.data ?? []).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</Select>
          <Input aria-label="Max marks" inputMode="numeric" className="min-h-9" value={r.maxMarks} onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, maxMarks: e.target.value } : x)))} />
          <Input aria-label="Pass marks" inputMode="numeric" className="min-h-9" value={r.passMarks} onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, passMarks: e.target.value } : x)))} />
          <Button type="button" size="sm" variant="ghost" aria-label="Remove subject" onClick={() => setRows(rows.filter((_x, j) => j !== i))}><Trash2 className="h-4 w-4" /></Button>
        </div>
      ))}
      <div className="flex flex-wrap gap-2">
        <Button type="button" size="sm" variant="outline" disabled={!subjects.data?.length} onClick={() => setRows([...rows, { classId: exam.classIds[0]!, subjectId: subjects.data![0]!.id, maxMarks: '100', passMarks: '33' }])} data-testid="add-exam-subject"><Plus className="h-4 w-4" aria-hidden /> Subject</Button>
        <Button size="sm" disabled={save.isPending} onClick={() => save.mutate()} data-testid="save-exam-subjects">Save subjects</Button>
      </div>
      {save.error ? <Alert>{errorText(save.error)}</Alert> : null}
      {save.isSuccess ? <Alert tone="success">Saved.</Alert> : null}
    </Card>
  );
}

function CorrectModal({ examId, result, onClose }: { examId: string; result: ResultRow; onClose: () => void }) {
  const qc = useQueryClient();
  const [reason, setReason] = useState('');
  const [marks, setMarks] = useState(result.subjects.map((s) => ({ subjectId: s.subjectId, subject: s.subject, max: s.max, value: s.obtained === null ? '' : String(s.obtained), status: s.status === 'not_entered' ? 'entered' : s.status })));
  const m = useMutation({
    mutationFn: async () => post(`/exams/${examId}/results/students/${result.studentId}/correct`, { reason, marks: marks.map((x) => ({ subjectId: x.subjectId, status: x.status, obtained: x.status === 'entered' ? Number(x.value) : null })) }),
    onSuccess: async () => { await qc.invalidateQueries({ queryKey: ['exam-results'] }); onClose(); },
  });
  return (
    <Modal open onOpenChange={(o) => { if (!o) onClose(); }} title={`Correct result — ${result.student?.name ?? ''}`} description="Creates a new published version; the current one is kept in history and the change is audited.">
      <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); m.mutate(); }}>
        {marks.map((x, i) => (
          <div key={x.subjectId} className="grid grid-cols-[1fr_100px_110px] items-center gap-2 text-sm">
            <span>{x.subject} <span className="text-muted-foreground">/ {x.max}</span></span>
            <Input aria-label={`${x.subject} marks`} inputMode="decimal" className="min-h-9" disabled={x.status !== 'entered'} value={x.value} onChange={(e) => setMarks(marks.map((y, j) => (j === i ? { ...y, value: e.target.value } : y)))} />
            <Select aria-label={`${x.subject} status`} className="min-h-9" value={x.status} onChange={(e) => setMarks(marks.map((y, j) => (j === i ? { ...y, status: e.target.value } : y)))}><option value="entered">marks</option><option value="absent">absent</option><option value="exempt">exempt</option></Select>
          </div>
        ))}
        <Field label="Reason (required)" htmlFor="cr-reason"><Input id="cr-reason" required minLength={5} maxLength={300} value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
        {m.error ? <Alert>{errorText(m.error)}</Alert> : null}
        <Button type="submit" disabled={m.isPending}>Save correction</Button>
      </form>
    </Modal>
  );
}
