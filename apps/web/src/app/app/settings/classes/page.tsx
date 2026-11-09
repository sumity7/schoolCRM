'use client';

import Link from 'next/link';
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Trash2 } from 'lucide-react';
import { del, errorText, get, patch, post } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { sectionLabel, sortSections, useClasses, useSections, useSessions, useStaff, useSubjects, type ClassRow, type SectionRow } from '@/lib/lookups';
import { cn } from '@/lib/utils';
import { Alert, Badge, Button, Card, Field, Input, PageHeader, Select, Skeleton, Table, Td, Th } from '@/components/ui/primitives';
import { Modal } from '@/components/ui/modal';

type Tab = 'classes' | 'subjects' | 'teachers';
interface Assignment { id: string; staffId: string; sectionId: string; subjectId: string | null; isClassTeacher: boolean }

export default function ClassesPage() {
  const { me, can } = useAuth();
  const qc = useQueryClient();
  const [tab, setTab] = useState<Tab>('classes');
  const sessions = useSessions();
  const active = sessions.data?.find((s) => s.status === 'active');
  const classes = useClasses(Boolean(active));
  const sections = useSections({ enabled: Boolean(active) });
  const subjects = useSubjects();
  const staff = useStaff(can('staff:read'));
  const assignments = useQuery({ queryKey: ['assignments', me?.activeMembershipId], enabled: Boolean(active), queryFn: async () => (await get<Assignment[]>('/academics/teacher-assignments')).data });
  const [classModal, setClassModal] = useState<ClassRow | 'new' | null>(null);
  const [sectionModal, setSectionModal] = useState<{ classId: string; section?: SectionRow } | null>(null);
  const [subjectOpen, setSubjectOpen] = useState(false);
  const [assignOpen, setAssignOpen] = useState(false);
  const refresh = () => qc.invalidateQueries();
  const remove = useMutation({ mutationFn: async (path: string) => del(path), onSuccess: refresh });

  const staffBy = new Map((staff.data ?? []).map((s) => [s.id, s]));
  const secBy = new Map((sections.data ?? []).map((s) => [s.id, s]));
  const subBy = new Map((subjects.data ?? []).map((s) => [s.id, s]));

  if (sessions.isLoading) return <Skeleton className="mx-auto h-40 max-w-5xl" />;
  if (!active) {
    return (
      <div className="mx-auto max-w-5xl space-y-4">
        <PageHeader title="Classes & sections" />
        <Alert tone="info">There is no active academic session. <Link href="/app/settings/academic-sessions" className="font-medium text-primary underline">Create and activate one</Link> first.</Alert>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-5xl space-y-4">
      <PageHeader title="Classes & sections" description={`Session ${active.name}. Class names are your own (e.g. Nursery, LKG, Class 1 … Class 12).`} />
      <div role="tablist" className="flex gap-1 border-b border-border">
        {([['classes', 'Classes & sections'], ['subjects', 'Subjects'], ['teachers', 'Teacher assignments']] as Array<[Tab, string]>).map(([k, label]) => (
          <button key={k} role="tab" aria-selected={tab === k} onClick={() => setTab(k)} className={cn('min-h-11 border-b-2 px-3 text-sm', tab === k ? 'border-primary font-medium text-foreground' : 'border-transparent text-muted-foreground')}>{label}</button>
        ))}
      </div>
      {remove.error ? <Alert>{errorText(remove.error)}</Alert> : null}

      {tab === 'classes' ? (
        <div className="space-y-3">
          {can('academics:create') ? <Button onClick={() => setClassModal('new')} data-testid="new-class">Add class</Button> : null}
          {classes.data && classes.data.length === 0 ? <Alert tone="info">No classes yet.</Alert> : null}
          {(classes.data ?? []).map((c) => {
            const secs = sortSections((sections.data ?? []).filter((s) => s.classId === c.id));
            return (
              <Card key={c.id} className="p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h2 className="font-medium">{c.name}{c.stream ? <span className="ml-1 text-sm font-normal text-muted-foreground">({c.stream})</span> : null}</h2>
                  <div className="flex gap-1">
                    {can('academics:create') ? <Button size="sm" variant="outline" onClick={() => setSectionModal({ classId: c.id })}>Add section</Button> : null}
                    {can('academics:update') ? <Button size="sm" variant="ghost" onClick={() => setClassModal(c)}>Edit</Button> : null}
                    {can('academics:delete') ? <Button size="sm" variant="ghost" aria-label={`Delete ${c.name}`} disabled={remove.isPending} onClick={() => { if (window.confirm(`Delete ${c.name}? Only possible when it has no sections.`)) remove.mutate(`/classes/${c.id}`); }}><Trash2 className="h-4 w-4" /></Button> : null}
                  </div>
                </div>
                {secs.length === 0 ? <p className="mt-2 text-sm text-muted-foreground">No sections.</p> : (
                  <ul className="mt-2 divide-y divide-border">
                    {secs.map((s) => (
                      <li key={s.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
                        <span><span className="font-medium">Section {s.name}</span> · {s.strength}{s.capacity ? ` / ${s.capacity}` : ''} students{s.classTeacherId ? ` · Class teacher: ${staffBy.get(s.classTeacherId)?.name ?? '—'}` : ''}</span>
                        <span className="flex gap-1">
                          {can('academics:update') ? <Button size="sm" variant="ghost" onClick={() => setSectionModal({ classId: c.id, section: s })}>Edit</Button> : null}
                          {can('academics:delete') ? <Button size="sm" variant="ghost" aria-label={`Delete section ${s.name}`} disabled={remove.isPending} onClick={() => { if (window.confirm(`Delete section ${s.name}? Only possible when no students are enrolled.`)) remove.mutate(`/sections/${s.id}`); }}><Trash2 className="h-4 w-4" /></Button> : null}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </Card>
            );
          })}
        </div>
      ) : null}

      {tab === 'subjects' ? (
        <div className="space-y-3">
          {can('academics:create') ? <Button onClick={() => setSubjectOpen(true)}>Add subject</Button> : null}
          {subjects.data && subjects.data.length === 0 ? <Alert tone="info">No subjects yet.</Alert> : null}
          {subjects.data && subjects.data.length > 0 ? (
            <Table minWidth={420}>
              <thead className="border-b border-border"><tr><Th>Code</Th><Th>Name</Th><Th>Type</Th><Th /></tr></thead>
              <tbody>
                {subjects.data.map((s) => (
                  <tr key={s.id} className="border-b border-border last:border-0">
                    <Td>{s.code}</Td><Td className="font-medium">{s.name}</Td><Td><Badge>{s.type.replace('_', '-')}</Badge></Td>
                    <Td className="text-right">{can('academics:delete') ? <Button size="sm" variant="ghost" aria-label={`Delete ${s.name}`} onClick={() => { if (window.confirm(`Delete ${s.name}?`)) remove.mutate(`/subjects/${s.id}`); }}><Trash2 className="h-4 w-4" /></Button> : null}</Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          ) : null}
        </div>
      ) : null}

      {tab === 'teachers' ? (
        <div className="space-y-3">
          <p className="text-sm text-muted-foreground">Teachers see and mark attendance only for sections they are assigned to. Link a teacher’s login to their staff record when inviting them (Users).</p>
          {can('academics:update') ? <Button onClick={() => setAssignOpen(true)} disabled={!staff.data?.length}>Assign teacher</Button> : null}
          {!can('staff:read') ? <Alert tone="info">You need staff access to manage assignments.</Alert> : null}
          {assignments.data && assignments.data.length === 0 ? <Alert tone="info">No assignments yet.</Alert> : null}
          {assignments.data && assignments.data.length > 0 ? (
            <Table minWidth={480} testId="assignments-table">
              <thead className="border-b border-border"><tr><Th>Teacher</Th><Th>Section</Th><Th>Subject</Th><Th /></tr></thead>
              <tbody>
                {assignments.data.map((a) => (
                  <tr key={a.id} className="border-b border-border last:border-0">
                    <Td className="font-medium">{staffBy.get(a.staffId)?.name ?? '—'}</Td>
                    <Td>{secBy.get(a.sectionId) ? sectionLabel(secBy.get(a.sectionId)!) : '—'}{a.isClassTeacher ? <span className="ml-1"><Badge tone="primary">class teacher</Badge></span> : null}</Td>
                    <Td>{a.subjectId ? subBy.get(a.subjectId)?.name ?? '—' : '—'}</Td>
                    <Td className="text-right">{can('academics:update') ? <Button size="sm" variant="ghost" aria-label="Remove assignment" onClick={() => { if (window.confirm('Remove this assignment?')) remove.mutate(`/academics/teacher-assignments/${a.id}`); }}><Trash2 className="h-4 w-4" /></Button> : null}</Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          ) : null}
        </div>
      ) : null}

      {classModal ? <ClassModal sessionId={active.id} cls={classModal === 'new' ? null : classModal} onClose={() => setClassModal(null)} onSaved={refresh} /> : null}
      {sectionModal ? <SectionModal classId={sectionModal.classId} section={sectionModal.section} teachers={(staff.data ?? []).filter((s) => s.kind === 'teaching' && s.status === 'active')} onClose={() => setSectionModal(null)} onSaved={refresh} /> : null}
      {subjectOpen ? <SubjectModal onClose={() => setSubjectOpen(false)} onSaved={refresh} /> : null}
      {assignOpen ? <AssignModal sections={sortSections(sections.data ?? [])} subjects={subjects.data ?? []} teachers={(staff.data ?? []).filter((s) => s.kind === 'teaching' && s.status === 'active')} onClose={() => setAssignOpen(false)} onSaved={refresh} /> : null}
    </div>
  );
}

function useSave(fn: () => Promise<unknown>, onSaved: () => Promise<unknown>, onClose: () => void) {
  return useMutation({ mutationFn: fn, onSuccess: async () => { await onSaved(); onClose(); } });
}

function ClassModal({ sessionId, cls, onClose, onSaved }: { sessionId: string; cls: ClassRow | null; onClose: () => void; onSaved: () => Promise<unknown> }) {
  const [f, setF] = useState({ name: cls?.name ?? '', order: String(cls?.order ?? ''), stream: cls?.stream ?? '' });
  const body = { name: f.name.trim(), ...(f.order !== '' ? { order: Number(f.order) } : {}), ...(f.stream.trim() ? { stream: f.stream.trim() } : {}) };
  const m = useSave(() => (cls ? patch(`/classes/${cls.id}`, body) : post('/classes', { sessionId, ...body })), onSaved, onClose);
  return (
    <Modal open onOpenChange={(o) => { if (!o) onClose(); }} title={cls ? 'Edit class' : 'Add class'}>
      <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); m.mutate(); }}>
        <Field label="Name" htmlFor="c-name"><Input id="c-name" required maxLength={60} placeholder="e.g. Class 5" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
        <Field label="Order (for sorting)" htmlFor="c-order"><Input id="c-order" type="number" min={0} max={100} value={f.order} onChange={(e) => setF({ ...f, order: e.target.value })} /></Field>
        <Field label="Stream (optional)" htmlFor="c-stream"><Input id="c-stream" maxLength={40} placeholder="Science / Commerce / Arts" value={f.stream} onChange={(e) => setF({ ...f, stream: e.target.value })} /></Field>
        {m.error ? <Alert>{errorText(m.error)}</Alert> : null}
        <Button type="submit" disabled={m.isPending}>Save</Button>
      </form>
    </Modal>
  );
}

function SectionModal({ classId, section, teachers, onClose, onSaved }: { classId: string; section?: SectionRow; teachers: Array<{ id: string; name: string }>; onClose: () => void; onSaved: () => Promise<unknown> }) {
  const [f, setF] = useState({ name: section?.name ?? '', capacity: String(section?.capacity ?? ''), classTeacherId: section?.classTeacherId ?? '' });
  const body = { name: f.name.trim(), ...(f.capacity ? { capacity: Number(f.capacity) } : {}), classTeacherId: f.classTeacherId || null };
  const m = useSave(() => (section ? patch(`/sections/${section.id}`, body) : post('/sections', { classId, ...body })), onSaved, onClose);
  return (
    <Modal open onOpenChange={(o) => { if (!o) onClose(); }} title={section ? `Edit section ${section.name}` : 'Add section'}>
      <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); m.mutate(); }}>
        <Field label="Name" htmlFor="sec-name"><Input id="sec-name" required maxLength={30} placeholder="A" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
        <Field label="Capacity (optional)" htmlFor="sec-cap"><Input id="sec-cap" type="number" min={1} max={500} value={f.capacity} onChange={(e) => setF({ ...f, capacity: e.target.value })} /></Field>
        <Field label="Class teacher" htmlFor="sec-ct">
          <Select id="sec-ct" value={f.classTeacherId} onChange={(e) => setF({ ...f, classTeacherId: e.target.value })}>
            <option value="">None</option>
            {teachers.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </Select>
        </Field>
        {m.error ? <Alert>{errorText(m.error)}</Alert> : null}
        <Button type="submit" disabled={m.isPending}>Save</Button>
      </form>
    </Modal>
  );
}

function SubjectModal({ onClose, onSaved }: { onClose: () => void; onSaved: () => Promise<unknown> }) {
  const [f, setF] = useState({ code: '', name: '', type: 'core' });
  const m = useSave(() => post('/subjects', { code: f.code.trim(), name: f.name.trim(), type: f.type }), onSaved, onClose);
  return (
    <Modal open onOpenChange={(o) => { if (!o) onClose(); }} title="Add subject">
      <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); m.mutate(); }}>
        <Field label="Code" htmlFor="sub-code"><Input id="sub-code" required maxLength={20} placeholder="MAT" value={f.code} onChange={(e) => setF({ ...f, code: e.target.value })} /></Field>
        <Field label="Name" htmlFor="sub-name"><Input id="sub-name" required maxLength={80} placeholder="Mathematics" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
        <Field label="Type" htmlFor="sub-type">
          <Select id="sub-type" value={f.type} onChange={(e) => setF({ ...f, type: e.target.value })}>
            <option value="core">Core</option><option value="optional">Optional</option><option value="co_scholastic">Co-scholastic</option>
          </Select>
        </Field>
        {m.error ? <Alert>{errorText(m.error)}</Alert> : null}
        <Button type="submit" disabled={m.isPending}>Save</Button>
      </form>
    </Modal>
  );
}

function AssignModal({ sections, subjects, teachers, onClose, onSaved }: { sections: SectionRow[]; subjects: Array<{ id: string; name: string }>; teachers: Array<{ id: string; name: string }>; onClose: () => void; onSaved: () => Promise<unknown> }) {
  const [f, setF] = useState({ staffId: '', sectionId: '', subjectId: '' });
  const m = useSave(() => post('/academics/teacher-assignments', { staffId: f.staffId, sectionId: f.sectionId, subjectId: f.subjectId || null }), onSaved, onClose);
  return (
    <Modal open onOpenChange={(o) => { if (!o) onClose(); }} title="Assign teacher">
      <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); m.mutate(); }}>
        <Field label="Teacher" htmlFor="as-staff"><Select id="as-staff" required value={f.staffId} onChange={(e) => setF({ ...f, staffId: e.target.value })}><option value="">Choose</option>{teachers.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</Select></Field>
        <Field label="Section" htmlFor="as-sec"><Select id="as-sec" required value={f.sectionId} onChange={(e) => setF({ ...f, sectionId: e.target.value })}><option value="">Choose</option>{sections.map((s) => <option key={s.id} value={s.id}>{sectionLabel(s)}</option>)}</Select></Field>
        <Field label="Subject (optional)" htmlFor="as-sub"><Select id="as-sub" value={f.subjectId} onChange={(e) => setF({ ...f, subjectId: e.target.value })}><option value="">Any / class work</option>{subjects.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</Select></Field>
        {m.error ? <Alert>{errorText(m.error)}</Alert> : null}
        <Button type="submit" disabled={m.isPending}>Assign</Button>
      </form>
    </Modal>
  );
}
