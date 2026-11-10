'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Download } from 'lucide-react';
import { downloadFile, errorText, get, post, put } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { ACCEPT, MAX_UPLOAD_MB, dueText, sizeText, stateTone, uploadFile, type HwFile, type Homework, type MarkingRow, type MarkingSheet } from '@/lib/homework';
import { Modal } from '@/components/ui/modal';
import { Alert, Badge, Button, Card, Field, Input, PageHeader, Skeleton } from '@/components/ui/primitives';

function FileLinks({ files }: { files: HwFile[] }) {
  const [err, setErr] = useState<string | null>(null);
  if (!files.length) return null;
  return (
    <div className="space-y-1">
      {err ? <Alert>{err}</Alert> : null}
      <ul className="flex flex-wrap gap-2">
        {files.map((f) => (
          <li key={f.id}><Button size="sm" variant="outline" onClick={() => { setErr(null); downloadFile(`/homework/files/${f.id}`, f.name).catch((e) => setErr(errorText(e))); }} data-testid={`file-${f.name}`}><Download className="h-4 w-4" aria-hidden /> {f.name} <span className="text-xs text-muted-foreground">{sizeText(f.size)}</span></Button></li>
        ))}
      </ul>
    </div>
  );
}

export default function HomeworkDetailPage() {
  const { me } = useAuth();
  if (!me) return <Skeleton className="mx-auto h-40 max-w-3xl" />;
  if (me.roleKeys.includes('student')) return <StudentDetail />;
  if (me.roleKeys.includes('parent')) return <Alert tone="info">Homework for your children is on each child's page.</Alert>;
  return <StaffDetail />;
}

// ------------------------------------------------------------------------------------------------ student
function StudentDetail() {
  const { id } = useParams<{ id: string }>();
  const { me } = useAuth();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['hw-mine-one', me?.activeMembershipId, id], queryFn: async () => (await get<Homework>(`/student/me/homework/${id}`)).data, retry: false });
  const [text, setText] = useState<string | null>(null);
  const [files, setFiles] = useState<File[]>([]);
  const [fileErr, setFileErr] = useState<string | null>(null);
  const h = q.data;
  const mine = h?.mine ?? null;
  const submit = useMutation({
    mutationFn: async () => {
      const ids: string[] = [];
      for (const f of files) ids.push((await uploadFile('/student/me/homework/files', f)).id);
      return (await put<Homework>(`/student/me/homework/${id}/submission`, { ...((text ?? mine?.text ?? '').trim() ? { text: (text ?? mine?.text ?? '').trim() } : {}), fileIds: ids })).data;
    },
    onSuccess: async () => { setFiles([]); setText(null); await qc.invalidateQueries({ queryKey: ['hw-mine-one'] }); await qc.invalidateQueries({ queryKey: ['hw-mine'] }); },
  });
  if (q.isLoading) return <Skeleton className="mx-auto h-40 max-w-3xl" />;
  if (q.error || !h) return <div className="mx-auto max-w-3xl space-y-3"><Alert>{q.error ? errorText(q.error) : 'Homework not found.'}</Alert><Link href="/app/homework" className="text-sm text-primary">Back</Link></div>;
  const reviewed = mine?.status === 'reviewed';
  const overdue = new Date(h.dueAt) < new Date();
  return (
    <div className="mx-auto max-w-3xl space-y-4" data-testid="hw-detail">
      <Link href="/app/homework" className="inline-flex min-h-11 items-center gap-1 text-sm text-muted-foreground hover:text-foreground"><ArrowLeft className="h-4 w-4" aria-hidden /> My homework</Link>
      <PageHeader title={h.title} description={`${h.subject} · due ${dueText(h.dueAt)}${h.maxMarks != null ? ` · ${h.maxMarks} marks` : ''}`} />
      <Card className="space-y-3 p-4">
        <p className="whitespace-pre-wrap text-sm">{h.description}</p>
        {h.instructions ? <div><h2 className="text-sm font-medium">Instructions</h2><p className="whitespace-pre-wrap text-sm text-muted-foreground">{h.instructions}</p></div> : null}
        <FileLinks files={h.files} />
        <p className="text-xs text-muted-foreground">Set by {h.createdByName}{overdue && !h.allowLate ? ' · late submissions are not accepted' : ''}</p>
      </Card>

      <Card className="space-y-3 p-4" data-testid="hw-submission">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="font-medium">My submission</h2>
          {mine ? <Badge tone={stateTone(reviewed ? 'reviewed' : mine.late ? 'late' : 'submitted')}>{reviewed ? 'reviewed' : mine.late ? 'submitted late' : 'submitted'}</Badge> : <Badge tone={overdue ? 'danger' : 'muted'}>{overdue ? 'overdue' : 'not submitted'}</Badge>}
        </div>
        {reviewed ? (
          <div className="space-y-1 text-sm" data-testid="hw-feedback">
            {mine.marks != null ? <p className="text-lg font-semibold">{mine.marks}{h.maxMarks != null ? ` / ${h.maxMarks}` : ''}</p> : null}
            {mine.feedback ? <p>“{mine.feedback}”</p> : null}
            <p className="text-xs text-muted-foreground">Reviewed by {mine.reviewedByName ?? 'your teacher'}</p>
          </div>
        ) : null}
        {mine ? <p className="text-xs text-muted-foreground">Last submitted {dueText(mine.submittedAt)} · attempt {mine.attempts}</p> : null}
        {mine?.files?.length ? <FileLinks files={mine.files} /> : null}
        {reviewed ? <p className="text-sm text-muted-foreground">This homework has been reviewed, so it can no longer be changed.</p> : (
          <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); submit.mutate(); }}>
            {submit.error ? <Alert>{errorText(submit.error, submit.error instanceof Error ? submit.error.message : undefined)}</Alert> : null}
            {submit.isSuccess ? <Alert tone="success">Submitted.</Alert> : null}
            <Field label="Your answer" htmlFor="hw-text"><textarea id="hw-text" className="min-h-28 w-full rounded-lg border border-input bg-card p-3 text-sm" value={text ?? mine?.text ?? ''} onChange={(e) => setText(e.target.value)} maxLength={10000} data-testid="hw-answer" /></Field>
            <Field label={`Attach files (optional, up to 5, ${MAX_UPLOAD_MB} MB each)`} htmlFor="hw-files">
              <Input id="hw-files" type="file" multiple accept={ACCEPT} className="py-2" data-testid="hw-attach" onChange={(e) => {
                const list = Array.from(e.target.files ?? []);
                setFileErr(list.length > 5 ? 'Choose at most 5 files' : list.find((x) => x.size > MAX_UPLOAD_MB * 1024 * 1024) ? `Each file must be ${MAX_UPLOAD_MB} MB or smaller` : null);
                setFiles(list.slice(0, 5));
              }} />
            </Field>
            {mine && files.length === 0 && mine.files?.length ? <p className="text-xs text-muted-foreground">Submitting again without choosing files removes the files you sent before.</p> : null}
            {fileErr ? <p role="alert" className="text-sm text-danger">{fileErr}</p> : null}
            <Button type="submit" disabled={submit.isPending || Boolean(fileErr)} data-testid="hw-submit">{mine ? 'Submit again' : 'Submit'}</Button>
          </form>
        )}
      </Card>
    </div>
  );
}

// ------------------------------------------------------------------------------------------------ staff
function StaffDetail() {
  const { id } = useParams<{ id: string }>();
  const { me, can } = useAuth();
  const qc = useQueryClient();
  const [reviewing, setReviewing] = useState<MarkingRow | null>(null);
  const q = useQuery({ queryKey: ['hw-sheet', me?.activeMembershipId, id], queryFn: async () => (await get<MarkingSheet>(`/homework/${id}/submissions`)).data, retry: false });
  const withdraw = useMutation({ mutationFn: async () => post(`/homework/${id}/withdraw`, {}), onSuccess: () => qc.invalidateQueries({ queryKey: ['hw-sheet'] }) });
  if (q.isLoading) return <Skeleton className="mx-auto h-40 max-w-4xl" />;
  if (q.error || !q.data) return <div className="mx-auto max-w-4xl space-y-3"><Alert>{q.error ? errorText(q.error) : 'Homework not found.'}</Alert><Link href="/app/homework" className="text-sm text-primary">Back</Link></div>;
  const { assignment: h, students, summary } = q.data;
  return (
    <div className="mx-auto max-w-4xl space-y-4" data-testid="hw-sheet">
      <Link href="/app/homework" className="inline-flex min-h-11 items-center gap-1 text-sm text-muted-foreground hover:text-foreground"><ArrowLeft className="h-4 w-4" aria-hidden /> Homework</Link>
      <PageHeader title={h.title} description={`${h.subject} · Section ${h.sectionName} · due ${dueText(h.dueAt)}${h.maxMarks != null ? ` · ${h.maxMarks} marks` : ''}`}
        actions={can('homework:update') && h.status === 'published' ? <Button variant="outline" disabled={withdraw.isPending} onClick={() => { if (window.confirm('Withdraw this homework? Students and parents will no longer see it.')) withdraw.mutate(); }} data-testid="hw-withdraw">Withdraw</Button> : <Badge>withdrawn</Badge>} />
      {withdraw.error ? <Alert>{errorText(withdraw.error)}</Alert> : null}
      <Card className="space-y-2 p-4"><p className="whitespace-pre-wrap text-sm">{h.description}</p><FileLinks files={h.files} /></Card>
      <div className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-4" data-testid="hw-summary">
        {([['Submitted', summary.submitted], ['Late', summary.late], ['Reviewed', summary.reviewed], ['Missing', summary.missing]] as Array<[string, number]>).map(([k, v]) => <Card key={k} className="p-3"><p className="text-xs text-muted-foreground">{k}</p><p className="text-xl font-semibold">{v}</p></Card>)}
      </div>
      <Card className="divide-y divide-border">
        {students.map((s) => (
          <div key={s.studentId} className="flex flex-wrap items-center justify-between gap-2 p-3 text-sm" data-testid={`row-${s.admissionNo}`}>
            <div className="min-w-0">
              <p className="font-medium">{s.name} <span className="text-xs font-normal text-muted-foreground">{s.admissionNo}{s.rollNo ? ` · roll ${s.rollNo}` : ''}</span></p>
              {s.submission ? <p className="text-xs text-muted-foreground">{dueText(s.submission.submittedAt)}{s.submission.attempts > 1 ? ` · attempt ${s.submission.attempts}` : ''}{s.submission.marks != null ? ` · ${s.submission.marks}${h.maxMarks != null ? `/${h.maxMarks}` : ''}` : ''}</p> : null}
              {s.submission?.text ? <p className="mt-1 line-clamp-2 whitespace-pre-wrap text-sm">{s.submission.text}</p> : null}
              {s.submission?.files.length ? <div className="mt-1"><FileLinks files={s.submission.files} /></div> : null}
            </div>
            <div className="flex items-center gap-2">
              <Badge tone={stateTone(s.state)}>{s.state}</Badge>
              {s.submission && can('homework:update') ? <Button size="sm" variant="outline" onClick={() => setReviewing(s)} data-testid={`review-${s.admissionNo}`}>{s.state === 'reviewed' ? 'Edit review' : 'Review'}</Button> : null}
            </div>
          </div>
        ))}
      </Card>
      {reviewing ? <ReviewModal homework={h} row={reviewing} onClose={() => setReviewing(null)} /> : null}
    </div>
  );
}

function ReviewModal({ homework, row, onClose }: { homework: Homework; row: MarkingRow; onClose: () => void }) {
  const qc = useQueryClient();
  const [marks, setMarks] = useState(row.submission?.marks != null ? String(row.submission.marks) : '');
  const [feedback, setFeedback] = useState(row.submission?.feedback ?? '');
  const m = useMutation({
    mutationFn: async () => put(`/homework/${homework.id}/submissions/${row.studentId}/review`, { marks: marks === '' ? null : Number(marks), feedback: feedback.trim() || null }),
    onSuccess: async () => { await qc.invalidateQueries({ queryKey: ['hw-sheet'] }); onClose(); },
  });
  return (
    <Modal open onOpenChange={(o) => !o && onClose()} title={`Review — ${row.name}`}>
      <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); m.mutate(); }}>
        {m.error ? <Alert>{errorText(m.error)}</Alert> : null}
        {homework.maxMarks != null ? <Field label={`Marks (out of ${homework.maxMarks})`} htmlFor="rv-marks"><Input id="rv-marks" type="number" min={0} max={homework.maxMarks} step="0.5" value={marks} onChange={(e) => setMarks(e.target.value)} data-testid="rv-marks" /></Field> : null}
        <Field label="Feedback" htmlFor="rv-fb"><textarea id="rv-fb" className="min-h-24 w-full rounded-lg border border-input bg-card p-3 text-sm" value={feedback} onChange={(e) => setFeedback(e.target.value)} maxLength={3000} data-testid="rv-feedback" /></Field>
        <div className="flex justify-end gap-2"><Button type="button" variant="outline" onClick={onClose}>Cancel</Button><Button type="submit" disabled={m.isPending} data-testid="rv-save">Save review</Button></div>
      </form>
    </Modal>
  );
}
