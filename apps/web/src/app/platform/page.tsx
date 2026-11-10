'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { errorText, get, patch, post } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { Alert, Badge, Button, Card, Field, Input, PageHeader, Select, Skeleton, Table, Td, Th } from '@/components/ui/primitives';
import { Modal } from '@/components/ui/modal';

interface Overview { schools: number; byStatus: Record<string, number>; activeStudents: number; activeStaff: number; parentLogins: number }
interface SchoolRow { id: string; name: string; code: string; status: string; limits: { students: number; staff: number }; owner: { name?: string; email?: string } | null; usage: { students: number; staff: number; parents: number; receipts30d: number }; createdAt: string | null }

const tone = (s: string) => (s === 'live' ? 'success' : s === 'suspended' ? 'warning' : s === 'deactivated' ? 'danger' : 'primary') as 'success' | 'warning' | 'danger' | 'primary';

export default function PlatformHome() {
  const { me } = useAuth();
  const isAdmin = me?.platformRole === 'super_admin';
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<SchoolRow | null>(null);
  const ov = useQuery({ queryKey: ['pl-overview'], queryFn: async () => (await get<Overview>('/platform/overview')).data });
  const schools = useQuery({ queryKey: ['pl-schools'], queryFn: async () => (await get<SchoolRow[]>('/platform/schools')).data });

  return (
    <div className="space-y-4">
      <PageHeader title="Schools" description="Usage counts only — school data is never shown in the console." actions={isAdmin ? <Button onClick={() => setCreating(true)} data-testid="pl-new-school">New school</Button> : null} />
      {ov.data ? (
        <div className="grid gap-3 sm:grid-cols-4" data-testid="pl-overview">
          {[['Schools', ov.data.schools], ['Active students', ov.data.activeStudents], ['Staff logins', ov.data.activeStaff], ['Parent logins', ov.data.parentLogins]].map(([l, v]) => (
            <Card key={String(l)} className="p-4"><p className="text-sm text-muted-foreground">{l}</p><p className="text-2xl font-semibold">{v}</p></Card>
          ))}
        </div>
      ) : <Skeleton className="h-20" />}
      {schools.error ? <Alert>{errorText(schools.error)}</Alert> : null}
      {schools.data ? (
        <Table minWidth={820} testId="pl-schools">
          <thead className="border-b border-border"><tr><Th>School</Th><Th>Owner</Th><Th>Students</Th><Th>Staff</Th><Th>Parents</Th><Th>Receipts (30 d)</Th><Th>Status</Th><Th /></tr></thead>
          <tbody>
            {schools.data.map((s) => (
              <tr key={s.id} className="border-b border-border last:border-0">
                <Td className="font-medium">{s.name}<span className="block font-mono text-xs text-muted-foreground">{s.code}</span></Td>
                <Td>{s.owner?.name}<span className="block text-xs text-muted-foreground">{s.owner?.email}</span></Td>
                <Td className={s.usage.students >= s.limits.students ? 'text-danger' : ''}>{s.usage.students} / {s.limits.students}</Td>
                <Td>{s.usage.staff} / {s.limits.staff}</Td><Td>{s.usage.parents}</Td><Td>{s.usage.receipts30d}</Td>
                <Td><Badge tone={tone(s.status)}>{s.status}</Badge></Td>
                <Td className="text-right">{isAdmin ? <Button size="sm" variant="ghost" onClick={() => setEditing(s)}>Manage</Button> : null}</Td>
              </tr>
            ))}
          </tbody>
        </Table>
      ) : null}
      {creating ? <CreateSchool onClose={() => setCreating(false)} /> : null}
      {editing ? <ManageSchool school={editing} onClose={() => setEditing(null)} /> : null}
    </div>
  );
}

function CreateSchool({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const [f, setF] = useState({ name: '', code: '', ownerName: '', ownerEmail: '', students: '500', staff: '50' });
  const m = useMutation({
    mutationFn: async () => post('/platform/schools', { name: f.name.trim(), code: f.code.trim().toLowerCase(), ownerName: f.ownerName.trim(), ownerEmail: f.ownerEmail.trim(), limits: { students: Number(f.students), staff: Number(f.staff) } }),
    onSuccess: async () => { await qc.invalidateQueries({ queryKey: ['pl-schools'] }); await qc.invalidateQueries({ queryKey: ['pl-overview'] }); },
  });
  return (
    <Modal open onOpenChange={(o) => { if (!o) onClose(); }} title="New school" description="The owner receives an invitation to set a password (development: written to the outbox).">
      {m.isSuccess ? <div className="space-y-3"><Alert tone="success">School created; owner invited.</Alert><Button onClick={onClose}>Close</Button></div> : (
        <form className="grid gap-3 sm:grid-cols-2" onSubmit={(e) => { e.preventDefault(); m.mutate(); }}>
          <div className="sm:col-span-2"><Field label="School name" htmlFor="ns-name"><Input id="ns-name" required minLength={2} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field></div>
          <Field label="Code (short, permanent)" htmlFor="ns-code"><Input id="ns-code" required pattern="[a-z0-9][a-z0-9-]{1,38}[a-z0-9]" value={f.code} onChange={(e) => setF({ ...f, code: e.target.value.toLowerCase() })} /></Field>
          <div />
          <Field label="Owner name" htmlFor="ns-on"><Input id="ns-on" required value={f.ownerName} onChange={(e) => setF({ ...f, ownerName: e.target.value })} /></Field>
          <Field label="Owner email" htmlFor="ns-oe"><Input id="ns-oe" required type="email" value={f.ownerEmail} onChange={(e) => setF({ ...f, ownerEmail: e.target.value })} /></Field>
          <Field label="Student limit" htmlFor="ns-sl"><Input id="ns-sl" inputMode="numeric" value={f.students} onChange={(e) => setF({ ...f, students: e.target.value })} /></Field>
          <Field label="Staff limit" htmlFor="ns-tl"><Input id="ns-tl" inputMode="numeric" value={f.staff} onChange={(e) => setF({ ...f, staff: e.target.value })} /></Field>
          {m.error ? <div className="sm:col-span-2"><Alert>{errorText(m.error)}</Alert></div> : null}
          <div className="sm:col-span-2"><Button type="submit" disabled={m.isPending} data-testid="pl-create">Create school</Button></div>
        </form>
      )}
    </Modal>
  );
}

function ManageSchool({ school, onClose }: { school: SchoolRow; onClose: () => void }) {
  const qc = useQueryClient();
  const [status, setStatus] = useState(school.status);
  const [limits, setLimits] = useState({ students: String(school.limits.students), staff: String(school.limits.staff) });
  const [reason, setReason] = useState('');
  const m = useMutation({
    mutationFn: async () => {
      const changedLimits = Number(limits.students) !== school.limits.students || Number(limits.staff) !== school.limits.staff;
      return patch(`/platform/schools/${school.id}`, { reason, ...(status !== school.status ? { status } : {}), ...(changedLimits ? { limits: { students: Number(limits.students), staff: Number(limits.staff) } } : {}) });
    },
    onSuccess: async () => { await qc.invalidateQueries({ queryKey: ['pl-schools'] }); onClose(); },
  });
  return (
    <Modal open onOpenChange={(o) => { if (!o) onClose(); }} title={school.name} description="Suspending or deactivating stops all access for the school's users immediately. Data is never deleted here.">
      <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); m.mutate(); }}>
        <Field label="Status" htmlFor="ms-st"><Select id="ms-st" value={status} onChange={(e) => setStatus(e.target.value)}>{['onboarding', 'live', 'suspended', 'deactivated'].map((x) => <option key={x} value={x}>{x}</option>)}</Select></Field>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Student limit" htmlFor="ms-sl"><Input id="ms-sl" inputMode="numeric" value={limits.students} onChange={(e) => setLimits({ ...limits, students: e.target.value })} /></Field>
          <Field label="Staff limit" htmlFor="ms-tl"><Input id="ms-tl" inputMode="numeric" value={limits.staff} onChange={(e) => setLimits({ ...limits, staff: e.target.value })} /></Field>
        </div>
        <Field label="Reason (recorded in the audit log)" htmlFor="ms-r"><Input id="ms-r" required minLength={3} maxLength={300} value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
        {m.error ? <Alert>{errorText(m.error)}</Alert> : null}
        <Button type="submit" variant={status === 'suspended' || status === 'deactivated' ? 'danger' : 'primary'} disabled={m.isPending}>Save</Button>
      </form>
    </Modal>
  );
}
