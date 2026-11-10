'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { del, errorText, get, post, put } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { sectionLabel, sortSections, useSections, useStaff, useSubjects } from '@/lib/lookups';
import { DAY_NAMES, buildPeriods, type Lesson, type TimetableView, type VersionRow } from '@/lib/timetable';
import { TimetableGrid } from '@/components/timetable-grid';
import { OwnTimetable, PrintButton } from '@/components/own-timetable';
import { Modal } from '@/components/ui/modal';
import { Alert, Badge, Button, Card, Field, Input, PageHeader, Skeleton } from '@/components/ui/primitives';
import { cn } from '@/lib/utils';

const selectCls = 'min-h-11 w-full rounded-lg border border-input bg-card px-3 text-sm text-foreground';
const statusTone = (s: string) => (s === 'published' ? 'success' : s === 'draft' ? 'primary' : 'muted') as 'success' | 'primary' | 'muted';

export default function TimetablePage() {
  const { me, can } = useAuth();
  if (!me) return <Skeleton className="mx-auto h-40 max-w-3xl" />;
  if (me.roleKeys.includes('student')) return <OwnTimetable path="/student/me/timetable" title="My timetable" show="teacher" />;
  if (me.roleKeys.includes('parent')) return <Alert tone="info">Open a child from <Link className="underline" href="/app">My children</Link> and choose the Timetable tab.</Alert>;
  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <PageHeader title="Timetable" description="Weekly class and teacher timetables." />
      {can('timetable:update') ? <Builder /> : null}
      <Viewer />
    </div>
  );
}

// ------------------------------------------------------------------------------------------------ published viewer (staff)
function Viewer() {
  const { me } = useAuth();
  const [mode, setMode] = useState<'class' | 'teacher' | 'me'>('class');
  const [sectionId, setSectionId] = useState('');
  const [staffId, setStaffId] = useState('');
  const sections = useSections();
  const staff = useStaff();
  const secs = sortSections(sections.data ?? []);
  const teachers = (staff.data ?? []).filter((s) => s.kind === 'teaching' && s.status === 'active');
  const path = mode === 'class' ? (sectionId ? `/timetable/sections/${sectionId}` : null) : mode === 'teacher' ? (staffId ? `/timetable/teachers/${staffId}` : null) : '/timetable/me';
  const q = useQuery({ queryKey: ['tt-view', me?.activeMembershipId, path], enabled: Boolean(path), queryFn: async () => (await get<TimetableView>(path!)).data, retry: false });
  return (
    <section className="space-y-3" aria-label="Published timetable">
      <div className="flex flex-wrap items-end gap-3 print:hidden">
        <div className="w-40">
          <Field label="View" htmlFor="tt-mode">
            <select id="tt-mode" className={selectCls} value={mode} onChange={(e) => setMode(e.target.value as typeof mode)} data-testid="tt-mode">
              <option value="class">A class</option><option value="teacher">A teacher</option><option value="me">My timetable</option>
            </select>
          </Field>
        </div>
        {mode === 'class' ? (
          <div className="w-56"><Field label="Class" htmlFor="tt-section"><select id="tt-section" className={selectCls} value={sectionId} onChange={(e) => setSectionId(e.target.value)} data-testid="tt-section"><option value="">Choose…</option>{secs.map((s) => <option key={s.id} value={s.id}>{sectionLabel(s)}</option>)}</select></Field></div>
        ) : null}
        {mode === 'teacher' ? (
          <div className="w-56"><Field label="Teacher" htmlFor="tt-teacher"><select id="tt-teacher" className={selectCls} value={staffId} onChange={(e) => setStaffId(e.target.value)} data-testid="tt-teacher"><option value="">Choose…</option>{teachers.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</select></Field></div>
        ) : null}
        <PrintButton />
      </div>
      {!path ? <Alert tone="info">Choose a {mode === 'class' ? 'class' : 'teacher'} to see the published timetable.</Alert> : null}
      {q.isLoading ? <Skeleton className="h-40" /> : null}
      {q.error ? <Alert>{errorText(q.error)}</Alert> : null}
      {q.data && !q.data.version ? <Alert tone="info">No timetable has been published yet.</Alert> : null}
      {q.data?.version ? (
        <>
          <p className="text-sm text-muted-foreground print:text-black" data-testid="tt-caption">{q.data.section ?? q.data.teacher} · {q.data.version.name} (version {q.data.version.versionNo})</p>
          <TimetableGrid data={q.data} show={mode === 'class' ? 'teacher' : 'section'} testId="viewer-grid" />
        </>
      ) : null}
    </section>
  );
}

// ------------------------------------------------------------------------------------------------ builder (admin)
function Builder() {
  const { me, can } = useAuth();
  const qc = useQueryClient();
  const [openId, setOpenId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const versions = useQuery({ queryKey: ['tt-versions', me?.activeMembershipId], queryFn: async () => (await get<VersionRow[]>('/timetable/versions')).data });
  const refresh = () => Promise.all([qc.invalidateQueries({ queryKey: ['tt-versions'] }), qc.invalidateQueries({ queryKey: ['tt-edit'] }), qc.invalidateQueries({ queryKey: ['tt-view'] })]);
  const clone = useMutation({ mutationFn: async (id: string) => (await post<{ id: string }>(`/timetable/versions/${id}/clone`, {})).data, onSuccess: async (d) => { await refresh(); setOpenId(d.id); } });
  const publish = useMutation({ mutationFn: async (id: string) => post(`/timetable/versions/${id}/publish`, {}), onSuccess: refresh });
  const open = versions.data?.find((v) => v.id === openId) ?? null;
  return (
    <section className="space-y-3" aria-label="Timetable versions" data-testid="tt-builder">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-lg font-semibold">Versions</h2>
        {can('timetable:create') ? <Button size="sm" onClick={() => setCreating(true)} data-testid="new-draft">New draft</Button> : null}
      </div>
      {versions.isLoading ? <Skeleton className="h-24" /> : null}
      {versions.error ? <Alert>{errorText(versions.error)}</Alert> : null}
      {versions.data && versions.data.length === 0 ? <Alert tone="info">No timetable yet. Create a draft, add lessons, then publish it.</Alert> : null}
      {clone.error ? <Alert>{errorText(clone.error)}</Alert> : null}
      {publish.error ? <Alert>{errorText(publish.error)}</Alert> : null}
      <ul className="grid gap-2 sm:grid-cols-2" data-testid="tt-versions">
        {(versions.data ?? []).map((v) => (
          <li key={v.id}>
            <Card className={cn('space-y-2 p-3', openId === v.id && 'ring-1 ring-primary')}>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="font-medium">{v.name}</span>
                <Badge tone={statusTone(v.status)}>{v.status}</Badge>
              </div>
              <p className="text-xs text-muted-foreground">Version {v.versionNo} · {v.lessonCount} lessons{v.publishedAt ? ` · published ${new Date(v.publishedAt).toLocaleDateString('en-IN')}` : ''}</p>
              <div className="flex flex-wrap gap-2">
                <Button size="sm" variant="outline" onClick={() => setOpenId(openId === v.id ? null : v.id)} data-testid={`open-v${v.versionNo}`}>{v.status === 'draft' ? 'Edit lessons' : 'View'}</Button>
                {can('timetable:create') ? <Button size="sm" variant="outline" disabled={clone.isPending} onClick={() => clone.mutate(v.id)} data-testid={`clone-v${v.versionNo}`}>New draft from this</Button> : null}
                {v.status === 'draft' ? <Button size="sm" disabled={publish.isPending || v.lessonCount === 0} onClick={() => { if (window.confirm(`Publish "${v.name}"? It becomes the timetable everyone sees, and the current one is archived.`)) publish.mutate(v.id); }} data-testid={`publish-v${v.versionNo}`}>Publish</Button> : null}
              </div>
            </Card>
          </li>
        ))}
      </ul>
      {open ? <Editor version={open} /> : null}
      {creating ? <NewDraft onClose={() => setCreating(false)} onCreated={async (id) => { setCreating(false); await refresh(); setOpenId(id); }} /> : null}
    </section>
  );
}

function NewDraft({ onClose, onCreated }: { onClose: () => void; onCreated: (id: string) => void }) {
  const [name, setName] = useState('');
  const [lessons, setLessons] = useState(8);
  const [start, setStart] = useState('08:00');
  const [minutes, setMinutes] = useState(40);
  const [breakAfter, setBreakAfter] = useState(4);
  const [breakMinutes, setBreakMinutes] = useState(20);
  const [days, setDays] = useState<number[]>([1, 2, 3, 4, 5, 6]);
  const m = useMutation({
    mutationFn: async () => (await post<{ id: string }>('/timetable/versions', { name: name.trim(), workingDays: days, periods: buildPeriods({ lessons, start, minutes, breakAfter, breakMinutes }) })).data,
    onSuccess: (d) => onCreated(d.id),
  });
  return (
    <Modal open onOpenChange={(o) => !o && onClose()} title="New draft timetable" description="Set the period grid. You can add lessons next; nothing is visible to others until you publish.">
      <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); m.mutate(); }}>
        {m.error ? <Alert>{errorText(m.error)}</Alert> : null}
        <Field label="Name" htmlFor="tt-name"><Input id="tt-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Term 1 timetable" maxLength={80} required data-testid="draft-name" /></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Lesson periods" htmlFor="tt-lessons"><Input id="tt-lessons" type="number" min={1} max={12} value={lessons} onChange={(e) => setLessons(Number(e.target.value))} /></Field>
          <Field label="First bell" htmlFor="tt-start"><Input id="tt-start" type="time" value={start} onChange={(e) => setStart(e.target.value)} /></Field>
          <Field label="Minutes per lesson" htmlFor="tt-min"><Input id="tt-min" type="number" min={10} max={120} value={minutes} onChange={(e) => setMinutes(Number(e.target.value))} /></Field>
          <Field label="Break after period (0 = none)" htmlFor="tt-ba"><Input id="tt-ba" type="number" min={0} max={12} value={breakAfter} onChange={(e) => setBreakAfter(Number(e.target.value))} /></Field>
          <Field label="Break minutes" htmlFor="tt-bm"><Input id="tt-bm" type="number" min={5} max={90} value={breakMinutes} onChange={(e) => setBreakMinutes(Number(e.target.value))} /></Field>
        </div>
        <fieldset>
          <legend className="mb-1.5 text-sm font-medium">Working days</legend>
          <div className="flex flex-wrap gap-2">
            {[1, 2, 3, 4, 5, 6, 7].map((d) => (
              <label key={d} className="inline-flex min-h-11 items-center gap-1.5 rounded-lg border border-input px-3 text-sm">
                <input type="checkbox" checked={days.includes(d)} onChange={(e) => setDays(e.target.checked ? [...days, d].sort() : days.filter((x) => x !== d))} /> {DAY_NAMES[d]!.slice(0, 3)}
              </label>
            ))}
          </div>
        </fieldset>
        <div className="flex justify-end gap-2"><Button type="button" variant="outline" onClick={onClose}>Cancel</Button><Button type="submit" disabled={m.isPending || !name.trim() || days.length === 0} data-testid="create-draft">Create draft</Button></div>
      </form>
    </Modal>
  );
}

function Editor({ version }: { version: VersionRow }) {
  const { me } = useAuth();
  const sections = useSections();
  const [sectionId, setSectionId] = useState('');
  const [cell, setCell] = useState<{ day: number; periodNo: number; lesson?: Lesson } | null>(null);
  const secs = sortSections(sections.data ?? []);
  const q = useQuery({ queryKey: ['tt-edit', me?.activeMembershipId, version.id, sectionId], enabled: Boolean(sectionId), queryFn: async () => (await get<TimetableView>(`/timetable/sections/${sectionId}?versionId=${version.id}`)).data });
  const editable = version.status === 'draft';
  return (
    <Card className="space-y-3 p-4" data-testid="tt-editor">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h3 className="font-semibold">{version.name} <Badge tone={statusTone(version.status)}>{version.status}</Badge></h3>
          <p className="text-sm text-muted-foreground">{editable ? 'Choose a class, then tap a cell to place or change a lesson.' : 'This timetable is read-only. Use “New draft from this” to make changes.'}</p>
        </div>
        <div className="w-56"><Field label="Class" htmlFor="ed-section"><select id="ed-section" className={selectCls} value={sectionId} onChange={(e) => setSectionId(e.target.value)} data-testid="ed-section"><option value="">Choose…</option>{secs.map((s) => <option key={s.id} value={s.id}>{sectionLabel(s)}</option>)}</select></Field></div>
      </div>
      {!sectionId ? <Alert tone="info">Choose a class to edit its week.</Alert> : null}
      {q.isLoading ? <Skeleton className="h-40" /> : null}
      {q.error ? <Alert>{errorText(q.error)}</Alert> : null}
      {q.data ? <TimetableGrid data={{ periods: version.periods, workingDays: version.workingDays, lessons: q.data.lessons }} show="teacher" testId="editor-grid" onCell={editable ? (day, periodNo, lesson) => setCell({ day, periodNo, lesson }) : undefined} /> : null}
      {cell && sectionId ? <LessonModal versionId={version.id} sectionId={sectionId} cell={cell} onClose={() => setCell(null)} /> : null}
    </Card>
  );
}

function LessonModal({ versionId, sectionId, cell, onClose }: { versionId: string; sectionId: string; cell: { day: number; periodNo: number; lesson?: Lesson }; onClose: () => void }) {
  const qc = useQueryClient();
  const subjects = useSubjects();
  const staff = useStaff();
  const [subjectId, setSubjectId] = useState(cell.lesson?.subjectId ?? '');
  const [staffId, setStaffId] = useState(cell.lesson?.staffId ?? '');
  const [room, setRoom] = useState(cell.lesson?.room ?? '');
  const avail = useQuery({ queryKey: ['tt-avail', versionId, cell.day, cell.periodNo], queryFn: async () => (await get<{ busyTeachers: Array<{ id: string }>; busyRooms: string[] }>(`/timetable/versions/${versionId}/availability?day=${cell.day}&periodNo=${cell.periodNo}`)).data });
  const done = async () => { await Promise.all([qc.invalidateQueries({ queryKey: ['tt-edit'] }), qc.invalidateQueries({ queryKey: ['tt-versions'] })]); onClose(); };
  const save = useMutation({ mutationFn: async () => put(`/timetable/versions/${versionId}/lessons`, { sectionId, day: cell.day, periodNo: cell.periodNo, subjectId, staffId, room: room.trim() || null }), onSuccess: done });
  const remove = useMutation({ mutationFn: async () => del(`/timetable/versions/${versionId}/lessons/${cell.lesson!.id}`), onSuccess: done });
  const teachers = (staff.data ?? []).filter((s) => s.kind === 'teaching' && s.status === 'active');
  const busy = new Set((avail.data?.busyTeachers ?? []).map((t) => t.id));
  return (
    <Modal open onOpenChange={(o) => !o && onClose()} title={`${DAY_NAMES[cell.day]} · period ${cell.periodNo}`} description="A teacher can be in one place per period, and a room can host one class.">
      <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); save.mutate(); }}>
        {save.error ? <Alert>{errorText(save.error)}</Alert> : null}
        {remove.error ? <Alert>{errorText(remove.error)}</Alert> : null}
        <Field label="Subject" htmlFor="ls-subject"><select id="ls-subject" className={selectCls} value={subjectId} onChange={(e) => setSubjectId(e.target.value)} required data-testid="lesson-subject"><option value="">Choose…</option>{(subjects.data ?? []).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></Field>
        <Field label="Teacher" htmlFor="ls-teacher"><select id="ls-teacher" className={selectCls} value={staffId} onChange={(e) => setStaffId(e.target.value)} required data-testid="lesson-teacher"><option value="">Choose…</option>{teachers.map((t) => <option key={t.id} value={t.id}>{t.name}{busy.has(t.id) && t.id !== cell.lesson?.staffId ? ' (busy this period)' : ''}</option>)}</select></Field>
        <Field label="Room (optional)" htmlFor="ls-room"><Input id="ls-room" value={room} onChange={(e) => setRoom(e.target.value)} maxLength={30} placeholder="e.g. LAB-1" data-testid="lesson-room" /></Field>
        {avail.data?.busyRooms.length ? <p className="text-xs text-muted-foreground">Rooms in use this period: {avail.data.busyRooms.join(', ')}</p> : null}
        <div className="flex justify-between gap-2">
          {cell.lesson ? <Button type="button" variant="danger" disabled={remove.isPending} onClick={() => remove.mutate()} data-testid="lesson-remove">Remove lesson</Button> : <span />}
          <div className="flex gap-2"><Button type="button" variant="outline" onClick={onClose}>Cancel</Button><Button type="submit" disabled={save.isPending || !subjectId || !staffId} data-testid="lesson-save">Save lesson</Button></div>
        </div>
      </form>
    </Modal>
  );
}
