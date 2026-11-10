'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { errorText, get, post } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { sectionLabel, sortSections, useSections, useSubjects } from '@/lib/lookups';
import { ACCEPT, MAX_UPLOAD_MB, uploadFile, type Homework } from '@/lib/homework';
import { HomeworkCards } from '@/components/homework-list';
import { Modal } from '@/components/ui/modal';
import { Alert, Button, Field, Input, PageHeader, Skeleton } from '@/components/ui/primitives';

const selectCls = 'min-h-11 w-full rounded-lg border border-input bg-card px-3 text-sm text-foreground';

export default function HomeworkPage() {
  const { me } = useAuth();
  if (!me) return <Skeleton className="mx-auto h-40 max-w-3xl" />;
  if (me.roleKeys.includes('student')) return <StudentList />;
  if (me.roleKeys.includes('parent')) return <Alert tone="info">Open a child from <Link className="underline" href="/app">My children</Link> and choose the Homework tab.</Alert>;
  return <StaffList />;
}

function StudentList() {
  const { me } = useAuth();
  const q = useQuery({ queryKey: ['hw-mine', me?.activeMembershipId], queryFn: async () => (await get<Homework[]>('/student/me/homework')).data });
  return (
    <div className="mx-auto max-w-3xl space-y-3">
      <PageHeader title="My homework" description="Homework set for your class." />
      {q.isLoading ? <Skeleton className="h-32" /> : null}
      {q.error ? <Alert>{errorText(q.error)}</Alert> : null}
      {q.data ? <HomeworkCards items={q.data} hrefBase="/app/homework" empty="No homework has been set for your class yet." /> : null}
    </div>
  );
}

function StaffList() {
  const { me, can } = useAuth();
  const [sectionId, setSectionId] = useState('');
  const [creating, setCreating] = useState(false);
  const sections = useSections();
  const q = useQuery({ queryKey: ['hw-staff', me?.activeMembershipId, sectionId], queryFn: async () => (await get<Homework[]>(`/homework?limit=50${sectionId ? `&sectionId=${sectionId}` : ''}`)).data });
  return (
    <div className="mx-auto max-w-3xl space-y-3">
      <PageHeader title="Homework" description="Set homework, collect submissions and give feedback." actions={can('homework:create') ? <Button onClick={() => setCreating(true)} data-testid="new-homework">Set homework</Button> : null} />
      <div className="w-56"><Field label="Class" htmlFor="hw-section"><select id="hw-section" className={selectCls} value={sectionId} onChange={(e) => setSectionId(e.target.value)} data-testid="hw-section-filter"><option value="">All my classes</option>{sortSections(sections.data ?? []).map((s) => <option key={s.id} value={s.id}>{sectionLabel(s)}</option>)}</select></Field></div>
      {q.isLoading ? <Skeleton className="h-32" /> : null}
      {q.error ? <Alert>{errorText(q.error)}</Alert> : null}
      {q.data ? <HomeworkCards items={q.data} hrefBase="/app/homework" empty="No homework yet. Use “Set homework” to create some." /> : null}
      {creating ? <NewHomework onClose={() => setCreating(false)} /> : null}
    </div>
  );
}

function NewHomework({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const sections = useSections({ mine: true });
  const subjects = useSubjects();
  const [f, setF] = useState({ sectionId: '', subjectId: '', title: '', description: '', instructions: '', dueAt: '', maxMarks: '', allowLate: true });
  const [files, setFiles] = useState<File[]>([]);
  const [fileErr, setFileErr] = useState<string | null>(null);
  const m = useMutation({
    mutationFn: async () => {
      const ids: string[] = [];
      for (const file of files) ids.push((await uploadFile('/homework/files', file)).id);
      return post('/homework', { sectionId: f.sectionId, subjectId: f.subjectId, title: f.title.trim(), description: f.description.trim(), ...(f.instructions.trim() ? { instructions: f.instructions.trim() } : {}), dueAt: new Date(f.dueAt).toISOString(), maxMarks: f.maxMarks === '' ? null : Number(f.maxMarks), allowLate: f.allowLate, fileIds: ids });
    },
    onSuccess: async () => { await qc.invalidateQueries({ queryKey: ['hw-staff'] }); onClose(); },
  });
  const set = (k: keyof typeof f, v: string | boolean) => setF((x) => ({ ...x, [k]: v }));
  return (
    <Modal open onOpenChange={(o) => !o && onClose()} title="Set homework" description="Students and parents of the class will see it straight away.">
      <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); m.mutate(); }}>
        {m.error ? <Alert>{errorText(m.error, m.error instanceof Error ? m.error.message : undefined)}</Alert> : null}
        <Field label="Class" htmlFor="nh-section"><select id="nh-section" className={selectCls} value={f.sectionId} onChange={(e) => set('sectionId', e.target.value)} required data-testid="hw-section"><option value="">Choose…</option>{sortSections(sections.data ?? []).map((s) => <option key={s.id} value={s.id}>{sectionLabel(s)}</option>)}</select></Field>
        <Field label="Subject" htmlFor="nh-subject"><select id="nh-subject" className={selectCls} value={f.subjectId} onChange={(e) => set('subjectId', e.target.value)} required data-testid="hw-subject"><option value="">Choose…</option>{(subjects.data ?? []).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></Field>
        <Field label="Title" htmlFor="nh-title"><Input id="nh-title" value={f.title} onChange={(e) => set('title', e.target.value)} minLength={3} maxLength={150} required data-testid="hw-title" /></Field>
        <Field label="Description" htmlFor="nh-desc"><textarea id="nh-desc" className="min-h-24 w-full rounded-lg border border-input bg-card p-3 text-sm" value={f.description} onChange={(e) => set('description', e.target.value)} maxLength={5000} required data-testid="hw-description" /></Field>
        <Field label="Instructions (optional)" htmlFor="nh-ins"><textarea id="nh-ins" className="min-h-16 w-full rounded-lg border border-input bg-card p-3 text-sm" value={f.instructions} onChange={(e) => set('instructions', e.target.value)} maxLength={5000} /></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Due" htmlFor="nh-due"><Input id="nh-due" type="datetime-local" value={f.dueAt} onChange={(e) => set('dueAt', e.target.value)} required data-testid="hw-due" /></Field>
          <Field label="Marks (optional)" htmlFor="nh-marks"><Input id="nh-marks" type="number" min={0} max={1000} value={f.maxMarks} onChange={(e) => set('maxMarks', e.target.value)} data-testid="hw-marks" /></Field>
        </div>
        <label className="flex min-h-11 items-center gap-2 text-sm"><input type="checkbox" checked={f.allowLate} onChange={(e) => set('allowLate', e.target.checked)} /> Accept late submissions (they are flagged as late)</label>
        <Field label={`Attachments (optional, up to 5 files, ${MAX_UPLOAD_MB} MB each)`} htmlFor="nh-files">
          <input id="nh-files" type="file" multiple accept={ACCEPT} data-testid="hw-files" className="block w-full text-sm" onChange={(e) => {
            const list = Array.from(e.target.files ?? []);
            setFileErr(list.length > 5 ? 'Choose at most 5 files' : list.find((x) => x.size > MAX_UPLOAD_MB * 1024 * 1024) ? `Each file must be ${MAX_UPLOAD_MB} MB or smaller` : null);
            setFiles(list.slice(0, 5));
          }} />
        </Field>
        {fileErr ? <p role="alert" className="text-sm text-danger">{fileErr}</p> : null}
        <div className="flex justify-end gap-2"><Button type="button" variant="outline" onClick={onClose}>Cancel</Button><Button type="submit" disabled={m.isPending || Boolean(fileErr)} data-testid="hw-publish">Publish</Button></div>
      </form>
    </Modal>
  );
}
