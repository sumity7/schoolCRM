'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft } from 'lucide-react';
import { errorText, get, patch, post } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { sectionLabel, sortSections, useSections } from '@/lib/lookups';
import { GENDERS, genderLabel, statusTone, type GuardianLink, type StudentDetail } from '@/lib/students';
import { Alert, Badge, Button, Card, Field, Input, PageHeader, Select, Skeleton, Table, Td, Th } from '@/components/ui/primitives';
import { Modal } from '@/components/ui/modal';
import { inr, type StudentFeeSummary } from '@/lib/fees';

const todayInIndia = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date());
const daysAgo = (n: number) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date(Date.now() - n * 86_400_000));

interface History { records: Array<{ date: string; status: string; remark?: string }>; summary: { markedDays: number; present: number; absent: number; late: number; halfDay: number; excused: number; percentage: number | null } }

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[140px_1fr] gap-2 py-1.5 text-sm">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="min-w-0 break-words">{children || '—'}</dd>
    </div>
  );
}

export default function StudentDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { me, can } = useAuth();
  const qc = useQueryClient();
  const sections = useSections({ enabled: can('academics:read') });
  const secBy = new Map((sections.data ?? []).map((s) => [s.id, s]));
  const [editOpen, setEditOpen] = useState(false);
  const [statusOpen, setStatusOpen] = useState(false);
  const [guardianOpen, setGuardianOpen] = useState(false);

  const student = useQuery({ queryKey: ['student', me?.activeMembershipId, id], queryFn: async () => (await get<StudentDetail>(`/students/${id}`)).data, retry: false });
  const guardians = useQuery({ queryKey: ['guardians', me?.activeMembershipId, id], enabled: can('guardians:read') && student.isSuccess, queryFn: async () => (await get<GuardianLink[]>(`/students/${id}/guardians`)).data });
  const history = useQuery({
    queryKey: ['att-history', me?.activeMembershipId, id], enabled: can('attendance:read') && student.isSuccess,
    queryFn: async () => (await get<History>(`/attendance/students/${id}?from=${daysAgo(60)}&to=${todayInIndia()}`)).data,
  });
  const refresh = () => Promise.all([qc.invalidateQueries({ queryKey: ['student'] }), qc.invalidateQueries({ queryKey: ['guardians'] }), qc.invalidateQueries({ queryKey: ['students'] })]);

  const invite = useMutation({
    mutationFn: async (linkId: string) => (await post<{ email: string }>(`/students/${id}/guardians/${linkId}/portal-invite`, {})).data,
  });
  const linkUpdate = useMutation({
    mutationFn: async (v: { linkId: string; body: Record<string, boolean> }) => patch(`/students/${id}/guardians/${v.linkId}`, v.body),
    onSuccess: refresh,
  });

  if (student.isLoading) return <Skeleton className="mx-auto h-60 max-w-4xl" />;
  if (student.error || !student.data) {
    return (
      <div className="mx-auto max-w-4xl space-y-3">
        <Alert>{errorText(student.error, 'Student not found')}</Alert>
        <Link href="/app/students" className="text-sm text-primary hover:underline">Back to students</Link>
      </div>
    );
  }
  const s = student.data;
  const sec = s.enrollment && s.enrollment.status === 'active' ? secBy.get(s.enrollment.sectionId) : undefined;

  return (
    <div className="mx-auto max-w-4xl space-y-4">
      <Link href="/app/students" className="inline-flex min-h-11 items-center gap-1 text-sm text-muted-foreground hover:text-foreground"><ArrowLeft className="h-4 w-4" aria-hidden /> Students</Link>
      <PageHeader
        title={`${s.firstName} ${s.lastName ?? ''}`.trim()}
        description={`Admission no. ${s.admissionNo}${sec ? ` · ${sectionLabel(sec)}${s.enrollment?.rollNo ? ` · Roll ${s.enrollment.rollNo}` : ''}` : ''}`}
        actions={
          can('students:update') ? (
            <>
              <Button variant="outline" onClick={() => setEditOpen(true)} data-testid="edit-student">Edit</Button>
              <Button variant="outline" onClick={() => setStatusOpen(true)} data-testid="change-status">{s.status === 'active' ? 'Transfer / withdraw' : 'Re-admit'}</Button>
            </>
          ) : null
        }
      />

      <div className="grid gap-4 md:grid-cols-2">
        <Card className="p-4">
          <h2 className="mb-2 font-medium">Details</h2>
          <dl>
            <Row label="Status"><Badge tone={statusTone(s.status)}>{s.status}</Badge>{s.statusChangedOn ? <span className="ml-2 text-xs text-muted-foreground">since {s.statusChangedOn}</span> : null}</Row>
            {s.statusReason ? <Row label="Reason">{s.statusReason}</Row> : null}
            <Row label="Date of birth">{s.dob}</Row>
            <Row label="Gender">{genderLabel(s.gender)}</Row>
            <Row label="Admitted on">{s.admissionDate}</Row>
            <Row label="Phone">{s.contact?.phone}</Row>
            <Row label="Email">{s.contact?.email}</Row>
            <Row label="Address">{[s.address?.line1, s.address?.line2, s.address?.city, s.address?.state, s.address?.postalCode].filter(Boolean).join(', ')}</Row>
          </dl>
        </Card>

        {can('attendance:read') ? (
          <Card className="p-4">
            <h2 className="mb-2 font-medium">Attendance — last 60 days</h2>
            {history.isLoading ? <Skeleton className="h-24" /> : null}
            {history.error ? <Alert>{errorText(history.error)}</Alert> : null}
            {history.data ? (
              history.data.summary.markedDays === 0 ? (
                <p className="text-sm text-muted-foreground">No attendance marked in this period.</p>
              ) : (
                <>
                  <p className="text-3xl font-semibold" data-testid="attendance-pct">{history.data.summary.percentage ?? '—'}%</p>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {history.data.summary.markedDays} {history.data.summary.markedDays === 1 ? "day" : "days"} marked · {history.data.summary.present} present · {history.data.summary.absent} absent · {history.data.summary.late} late · {history.data.summary.halfDay} half-day · {history.data.summary.excused} excused
                  </p>
                  <div className="mt-3 flex flex-wrap gap-1" aria-label="Recent days">
                    {history.data.records.slice(-30).map((r) => (
                      <span key={r.date} title={`${r.date}: ${r.status}`} className={`h-3 w-3 rounded-sm ${r.status === 'absent' ? 'bg-danger' : r.status === 'present' ? 'bg-success' : r.status === 'excused' ? 'bg-muted-foreground' : 'bg-warning'}`} />
                    ))}
                  </div>
                </>
              )
            ) : null}
          </Card>
        ) : null}
      </div>

      {can('invoices:read') && can('financial:view') ? <FeesCard studentId={s.id} /> : null}
      {can('students:update') && s.status === 'active' ? <StudentLoginCard studentId={s.id} /> : null}

      {can('guardians:read') ? (
        <section className="space-y-2">
          <div className="flex items-center justify-between gap-2">
            <h2 className="font-medium">Guardians</h2>
            {can('guardians:create') ? <Button size="sm" variant="outline" onClick={() => setGuardianOpen(true)} data-testid="add-guardian">Add guardian</Button> : null}
          </div>
          {linkUpdate.error ? <Alert>{errorText(linkUpdate.error)}</Alert> : null}
          {invite.error ? <Alert>{errorText(invite.error)}</Alert> : null}
          {invite.data ? <Alert tone="success">Portal invitation sent to {invite.data.email} (development: written to the outbox).</Alert> : null}
          {guardians.data && guardians.data.length === 0 ? <Alert tone="info">No guardians linked yet.</Alert> : null}
          {guardians.data && guardians.data.length > 0 ? (
            <Table minWidth={640} testId="guardians-table">
              <thead className="border-b border-border"><tr><Th>Name</Th><Th>Phone</Th><Th>Relationship</Th><Th>Verified</Th><Th>Portal</Th><Th /></tr></thead>
              <tbody>
                {guardians.data.map((g) => (
                  <tr key={g.linkId} className="border-b border-border last:border-0">
                    <Td className="font-medium">{g.name}{g.isPrimary ? <span className="ml-1 text-xs text-muted-foreground">(primary)</span> : null}{g.ended ? <Badge tone="warning">ended</Badge> : null}</Td>
                    <Td>{g.phone}</Td>
                    <Td className="capitalize">{g.relationship}</Td>
                    <Td>{g.verified ? <Badge tone="success">verified</Badge> : <Badge>not verified</Badge>}</Td>
                    <Td>{g.portalAccess ? <Badge tone="primary">on</Badge> : <Badge>off</Badge>}</Td>
                    <Td className="whitespace-nowrap text-right">
                      {can('guardians:update') && !g.ended ? (
                        <div className="flex justify-end gap-1">
                          {!g.verified ? <Button size="sm" variant="ghost" disabled={linkUpdate.isPending} onClick={() => linkUpdate.mutate({ linkId: g.linkId, body: { verified: true } })}>Verify</Button> : null}
                          {g.verified ? <Button size="sm" variant="ghost" disabled={linkUpdate.isPending} onClick={() => linkUpdate.mutate({ linkId: g.linkId, body: { portalAccess: !g.portalAccess } })}>{g.portalAccess ? 'Disable portal' : 'Enable portal'}</Button> : null}
                          {g.verified && g.portalAccess && g.email ? <Button size="sm" variant="ghost" disabled={invite.isPending} onClick={() => invite.mutate(g.linkId)} data-testid={`invite-${g.linkId}`}>Invite to portal</Button> : null}
                          <Button size="sm" variant="ghost" className="text-danger" disabled={linkUpdate.isPending} onClick={() => { if (window.confirm(`End ${g.name}'s link to this student? Portal access stops immediately.`)) linkUpdate.mutate({ linkId: g.linkId, body: { ended: true } }); }}>End link</Button>
                        </div>
                      ) : null}
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          ) : null}
          <p className="text-xs text-muted-foreground">A guardian must be verified (identity checked in person) before portal access can be enabled.</p>
        </section>
      ) : null}

      {/* mounted only while open, so each opening starts from the latest data (and the latest version for optimistic locking) */}
      {editOpen ? <EditModal open onOpenChange={setEditOpen} student={s} onSaved={refresh} /> : null}
      {statusOpen ? <StatusModal open onOpenChange={setStatusOpen} student={s} sections={sortSections(sections.data ?? [])} onSaved={refresh} /> : null}
      {guardianOpen ? <GuardianModal open onOpenChange={setGuardianOpen} studentId={s.id} onSaved={refresh} /> : null}
    </div>
  );
}

function EditModal({ open, onOpenChange, student, onSaved }: { open: boolean; onOpenChange: (o: boolean) => void; student: StudentDetail; onSaved: () => Promise<unknown> }) {
  const [f, setF] = useState({ firstName: student.firstName, lastName: student.lastName ?? '', dob: student.dob, gender: student.gender ?? '', phone: student.contact?.phone ?? '', email: student.contact?.email ?? '', line1: student.address?.line1 ?? '', city: student.address?.city ?? '', state: student.address?.state ?? '', postalCode: student.address?.postalCode ?? '' });
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setF((p) => ({ ...p, [k]: e.target.value }));
  const m = useMutation({
    mutationFn: async () => patch(`/students/${student.id}`, {
      firstName: f.firstName.trim(), lastName: f.lastName.trim(), dob: f.dob, ...(f.gender ? { gender: f.gender } : {}),
      contact: { ...(f.phone.trim() ? { phone: f.phone.trim() } : {}), ...(f.email.trim() ? { email: f.email.trim() } : {}) },
      address: { line1: f.line1, city: f.city, state: f.state, postalCode: f.postalCode }, version: student.version,
    }),
    onSuccess: async () => { await onSaved(); onOpenChange(false); },
  });
  return (
    <Modal open={open} onOpenChange={onOpenChange} title="Edit student">
      <form className="grid gap-3 sm:grid-cols-2" onSubmit={(e) => { e.preventDefault(); m.mutate(); }}>
        <Field label="First name" htmlFor="e-first"><Input id="e-first" required value={f.firstName} onChange={set('firstName')} /></Field>
        <Field label="Last name" htmlFor="e-last"><Input id="e-last" value={f.lastName} onChange={set('lastName')} /></Field>
        <Field label="Date of birth" htmlFor="e-dob"><Input id="e-dob" type="date" required value={f.dob} onChange={set('dob')} /></Field>
        <Field label="Gender" htmlFor="e-gender"><Select id="e-gender" value={f.gender} onChange={set('gender')}><option value="">—</option>{GENDERS.map((g) => <option key={g.value} value={g.value}>{g.label}</option>)}</Select></Field>
        <Field label="Phone" htmlFor="e-phone"><Input id="e-phone" type="tel" value={f.phone} onChange={set('phone')} /></Field>
        <Field label="Email" htmlFor="e-email"><Input id="e-email" type="email" value={f.email} onChange={set('email')} /></Field>
        <div className="sm:col-span-2"><Field label="Address" htmlFor="e-line1"><Input id="e-line1" value={f.line1} onChange={set('line1')} /></Field></div>
        <Field label="City" htmlFor="e-city"><Input id="e-city" value={f.city} onChange={set('city')} /></Field>
        <Field label="State" htmlFor="e-state"><Input id="e-state" value={f.state} onChange={set('state')} /></Field>
        <Field label="PIN code" htmlFor="e-pin"><Input id="e-pin" value={f.postalCode} onChange={set('postalCode')} /></Field>
        {m.error ? <div className="sm:col-span-2"><Alert>{errorText(m.error)}</Alert></div> : null}
        <div className="sm:col-span-2"><Button type="submit" disabled={m.isPending}>{m.isPending ? 'Saving…' : 'Save changes'}</Button></div>
      </form>
    </Modal>
  );
}

function StatusModal({ open, onOpenChange, student, sections, onSaved }: { open: boolean; onOpenChange: (o: boolean) => void; student: StudentDetail; sections: ReturnType<typeof sortSections>; onSaved: () => Promise<unknown> }) {
  const active = student.status === 'active';
  const [status, setStatus] = useState(active ? 'transferred' : 'active');
  const [effectiveOn, setEffectiveOn] = useState(todayInIndia());
  const [reason, setReason] = useState('');
  const [sectionId, setSectionId] = useState('');
  const m = useMutation({
    mutationFn: async () => post(`/students/${student.id}/status`, { status, effectiveOn, ...(reason.trim() ? { reason: reason.trim() } : {}), ...(status === 'active' ? { sectionId } : {}) }),
    onSuccess: async () => { await onSaved(); onOpenChange(false); },
  });
  return (
    <Modal open={open} onOpenChange={onOpenChange} title={active ? 'Change student status' : 'Re-admit student'} description="History (attendance, enrolments) is always kept. The change is recorded in the audit log.">
      <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); m.mutate(); }}>
        {active ? (
          <Field label="New status" htmlFor="st-status">
            <Select id="st-status" value={status} onChange={(e) => setStatus(e.target.value)}>
              <option value="transferred">Transferred (TC issued)</option><option value="withdrawn">Withdrawn</option><option value="graduated">Graduated</option>
            </Select>
          </Field>
        ) : (
          <Field label="Re-admit into" htmlFor="st-section">
            <Select id="st-section" required value={sectionId} onChange={(e) => setSectionId(e.target.value)}>
              <option value="">Choose class & section</option>
              {sections.map((s) => <option key={s.id} value={s.id}>{sectionLabel(s)}</option>)}
            </Select>
          </Field>
        )}
        <Field label="Effective date" htmlFor="st-date"><Input id="st-date" type="date" required value={effectiveOn} onChange={(e) => setEffectiveOn(e.target.value)} /></Field>
        <Field label="Reason" htmlFor="st-reason"><Input id="st-reason" maxLength={300} value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
        {m.error ? <Alert>{errorText(m.error)}</Alert> : null}
        <Button type="submit" variant={active ? 'danger' : 'primary'} disabled={m.isPending}>{m.isPending ? 'Saving…' : 'Confirm'}</Button>
      </form>
    </Modal>
  );
}

function GuardianModal({ open, onOpenChange, studentId, onSaved }: { open: boolean; onOpenChange: (o: boolean) => void; studentId: string; onSaved: () => Promise<unknown> }) {
  const [f, setF] = useState({ name: '', phone: '', email: '', relationship: 'mother', isPrimary: false });
  const m = useMutation({
    mutationFn: async () => post(`/students/${studentId}/guardians`, { name: f.name.trim(), phone: f.phone.trim(), relationship: f.relationship, isPrimary: f.isPrimary, ...(f.email.trim() ? { email: f.email.trim() } : {}) }),
    onSuccess: async () => { await onSaved(); setF({ name: '', phone: '', email: '', relationship: 'mother', isPrimary: false }); onOpenChange(false); },
  });
  return (
    <Modal open={open} onOpenChange={onOpenChange} title="Add guardian">
      <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); m.mutate(); }}>
        <Field label="Name" htmlFor="g-name"><Input id="g-name" required maxLength={120} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
        <Field label="Phone" htmlFor="g-phone"><Input id="g-phone" required type="tel" maxLength={20} value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} /></Field>
        <Field label="Email" htmlFor="g-email"><Input id="g-email" type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} /></Field>
        <Field label="Relationship" htmlFor="g-rel">
          <Select id="g-rel" value={f.relationship} onChange={(e) => setF({ ...f, relationship: e.target.value })}>
            <option value="father">Father</option><option value="mother">Mother</option><option value="guardian">Guardian</option><option value="other">Other</option>
          </Select>
        </Field>
        <label className="flex min-h-11 items-center gap-2 text-sm"><input type="checkbox" className="h-5 w-5" checked={f.isPrimary} onChange={(e) => setF({ ...f, isPrimary: e.target.checked })} /> Primary contact</label>
        {m.error ? <Alert>{errorText(m.error)}</Alert> : null}
        <Button type="submit" disabled={m.isPending}>{m.isPending ? 'Saving…' : 'Add guardian'}</Button>
      </form>
    </Modal>
  );
}

function FeesCard({ studentId }: { studentId: string }) {
  const { me, can } = useAuth();
  const q = useQuery({ queryKey: ['fee-summary', me?.activeMembershipId, studentId], queryFn: async () => (await get<StudentFeeSummary>(`/fees/students/${studentId}/summary`)).data });
  if (q.isLoading) return <Skeleton className="h-24" />;
  if (q.error || !q.data) return null;
  const t = q.data.totals;
  return (
    <Card className="p-4" data-testid="student-fees">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-medium">Fees</h2>
        {can('payments:create') ? <Link href={`/app/fees/collect?studentId=${studentId}`} className="inline-flex min-h-9 items-center rounded-lg bg-primary px-3 text-sm font-medium text-primary-foreground hover:opacity-90">Collect fee</Link> : null}
      </div>
      <div className="mt-2 grid grid-cols-2 gap-3 text-sm sm:grid-cols-5">
        <div><p className="text-xs text-muted-foreground">Billed</p><p className="font-semibold">{inr(t.billedPaise)}</p></div>
        <div><p className="text-xs text-muted-foreground">Paid</p><p className="font-semibold">{inr(t.paidPaise)}</p></div>
        <div><p className="text-xs text-muted-foreground">Balance</p><p className="font-semibold">{inr(t.balancePaise)}</p></div>
        <div><p className="text-xs text-muted-foreground">Overdue</p><p className={`font-semibold ${t.overduePaise ? 'text-danger' : ''}`}>{inr(t.overduePaise)}</p></div>
        <div><p className="text-xs text-muted-foreground">Advance</p><p className="font-semibold">{inr(t.advanceCreditPaise)}</p></div>
      </div>
    </Card>
  );
}

interface AccessStatus { exists: boolean; status?: 'invited' | 'active' | 'suspended'; loginId?: string | null; lastLoginAt?: string | null }

/** Student portal login. Staff hand over a ONE-TIME activation link; the student chooses their own password. */
function StudentLoginCard({ studentId }: { studentId: string }) {
  const { me } = useAuth();
  const qc = useQueryClient();
  const [issued, setIssued] = useState<{ loginId: string; activationUrl: string; expiresAt: string } | null>(null);
  const [copied, setCopied] = useState(false);
  const st = useQuery({ queryKey: ['student-access', me?.activeMembershipId, studentId], queryFn: async () => (await get<AccessStatus>(`/students/${studentId}/portal-access`)).data });
  const refresh = () => qc.invalidateQueries({ queryKey: ['student-access'] });
  const issue = useMutation({ mutationFn: async () => (await post<{ loginId: string; activationUrl: string; expiresAt: string }>(`/students/${studentId}/portal-access`, {})).data, onSuccess: async (d) => { setIssued(d); setCopied(false); await refresh(); } });
  const toggle = useMutation({ mutationFn: async (enable: boolean) => post(`/students/${studentId}/portal-access/${enable ? 'enable' : 'disable'}`, {}), onSuccess: refresh });
  const d = st.data;
  return (
    <Card className="space-y-3 p-4" data-testid="student-login-card">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-medium">Student login</h2>
        {d?.exists ? <Badge tone={d.status === 'active' ? 'success' : d.status === 'invited' ? 'primary' : 'warning'}>{d.status === 'invited' ? 'waiting for activation' : d.status}</Badge> : <Badge>no login yet</Badge>}
      </div>
      {d?.exists ? <p className="text-sm text-muted-foreground">Login id: <span className="font-mono text-foreground">{d.loginId}</span>{d.lastLoginAt ? ` · last sign-in ${new Date(d.lastLoginAt).toLocaleDateString('en-IN')}` : ''}</p> : <p className="text-sm text-muted-foreground">The student has no portal login. Create one-time activation access and give the link to the student — they choose their own password; staff never see it.</p>}
      {issue.error ? <Alert>{errorText(issue.error)}</Alert> : null}
      {toggle.error ? <Alert>{errorText(toggle.error)}</Alert> : null}
      {issued ? (
        <Alert tone="success">
          <div className="space-y-2" data-testid="activation-box">
            <p>Give this link to the student. It works once, expires {new Date(issued.expiresAt).toLocaleDateString('en-IN')}, and is <strong>not shown again</strong>.</p>
            <p className="break-all font-mono text-xs" data-testid="activation-url">{issued.activationUrl}</p>
            <Button size="sm" variant="outline" onClick={() => { void navigator.clipboard?.writeText(issued.activationUrl).then(() => setCopied(true)).catch(() => setCopied(false)); }}>{copied ? 'Copied' : 'Copy link'}</Button>
          </div>
        </Alert>
      ) : null}
      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant="outline" disabled={issue.isPending} onClick={() => { if (!d?.exists || window.confirm('This resets the student\'s password and signs them out everywhere. Continue?')) issue.mutate(); }} data-testid="issue-student-access">{d?.exists ? 'Reset access (new link)' : 'Create login'}</Button>
        {d?.exists && d.status === 'active' ? <Button size="sm" variant="ghost" className="text-danger" disabled={toggle.isPending} onClick={() => toggle.mutate(false)}>Disable login</Button> : null}
        {d?.exists && d.status === 'suspended' ? <Button size="sm" variant="ghost" disabled={toggle.isPending} onClick={() => toggle.mutate(true)}>Enable login</Button> : null}
      </div>
    </Card>
  );
}
