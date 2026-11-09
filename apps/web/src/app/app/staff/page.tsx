'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { errorText, get, patch, post } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import type { StaffRow } from '@/lib/lookups';
import { Alert, Badge, Button, Field, Input, PageHeader, Select, Skeleton, Table, Td, Th } from '@/components/ui/primitives';
import { Modal } from '@/components/ui/modal';

const todayInIndia = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date());

export default function StaffPage() {
  const { me, can } = useAuth();
  const qc = useQueryClient();
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState('active');
  const [modal, setModal] = useState<StaffRow | 'new' | null>(null);
  const [statusFor, setStatusFor] = useState<StaffRow | null>(null);
  const list = useQuery({
    queryKey: ['staff', me?.activeMembershipId, page, status],
    queryFn: async () => get<StaffRow[]>(`/staff?page=${page}&limit=25${status ? `&status=${status}` : ''}`),
    placeholderData: (p) => p,
  });
  const refresh = () => qc.invalidateQueries();
  const meta = list.data?.meta;

  return (
    <div className="mx-auto max-w-5xl space-y-4">
      <PageHeader
        title="Staff"
        description="Staff records exist with or without a login. Give someone a login under Users and link it to their staff record."
        actions={can('staff:create') ? <Button onClick={() => setModal('new')} data-testid="add-staff">Add staff</Button> : null}
      />
      <Select aria-label="Filter by status" value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }} className="max-w-48">
        <option value="">Any status</option><option value="active">Active</option><option value="on_leave">On leave</option><option value="resigned">Resigned</option><option value="terminated">Terminated</option>
      </Select>
      {list.isLoading ? <Skeleton className="h-24" /> : null}
      {list.error ? <Alert>{errorText(list.error)}</Alert> : null}
      {list.data && list.data.data.length === 0 ? <Alert tone="info">No staff to show.</Alert> : null}
      {list.data && list.data.data.length > 0 ? (
        <Table minWidth={640} testId="staff-table">
          <thead className="border-b border-border"><tr><Th>Emp. ID</Th><Th>Name</Th><Th>Designation</Th><Th>Type</Th><Th>Status</Th><Th /></tr></thead>
          <tbody>
            {list.data.data.map((s) => (
              <tr key={s.id} className="border-b border-border last:border-0">
                <Td>{s.employeeId}</Td>
                <Td className="font-medium">{s.name}<span className="block text-xs font-normal text-muted-foreground">{[s.phone, s.email].filter(Boolean).join(' · ')}</span></Td>
                <Td>{s.designation}{s.department ? <span className="block text-xs text-muted-foreground">{s.department}</span> : null}</Td>
                <Td>{s.kind === 'teaching' ? 'Teaching' : 'Non-teaching'}</Td>
                <Td><Badge tone={s.status === 'active' ? 'success' : s.status === 'on_leave' ? 'warning' : 'muted'}>{s.status.replace('_', ' ')}</Badge></Td>
                <Td className="whitespace-nowrap text-right">
                  {can('staff:update') ? (
                    <div className="flex justify-end gap-1">
                      <Button size="sm" variant="ghost" onClick={() => setModal(s)}>Edit</Button>
                      <Button size="sm" variant="ghost" onClick={() => setStatusFor(s)}>Status</Button>
                    </div>
                  ) : null}
                </Td>
              </tr>
            ))}
          </tbody>
        </Table>
      ) : null}
      {meta && meta.totalPages > 1 ? (
        <div className="flex items-center justify-between text-sm">
          <span className="text-muted-foreground">{meta.total} staff · page {meta.page} of {meta.totalPages}</span>
          <div className="flex gap-2">
            <Button size="sm" variant="outline" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>Previous</Button>
            <Button size="sm" variant="outline" disabled={page >= meta.totalPages} onClick={() => setPage((p) => p + 1)}>Next</Button>
          </div>
        </div>
      ) : null}
      {modal ? <StaffModal staff={modal === 'new' ? null : modal} onClose={() => setModal(null)} onSaved={refresh} /> : null}
      {statusFor ? <StatusModal staff={statusFor} onClose={() => setStatusFor(null)} onSaved={refresh} /> : null}
    </div>
  );
}

function StaffModal({ staff, onClose, onSaved }: { staff: StaffRow | null; onClose: () => void; onSaved: () => Promise<unknown> }) {
  const [f, setF] = useState({ employeeId: staff?.employeeId ?? '', name: staff?.name ?? '', phone: staff?.phone ?? '', email: staff?.email ?? '', designation: staff?.designation ?? '', department: staff?.department ?? '', kind: staff?.kind ?? 'teaching', joiningDate: staff?.joiningDate ?? '' });
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setF((p) => ({ ...p, [k]: e.target.value }));
  const opt = (k: 'phone' | 'email' | 'department') => (f[k].trim() ? { [k]: f[k].trim() } : {});
  const m = useMutation({
    mutationFn: async () => staff
      ? patch(`/staff/${staff.id}`, { name: f.name.trim(), designation: f.designation.trim(), ...opt('phone'), ...opt('email'), ...opt('department'), version: staff.version })
      : post('/staff', { employeeId: f.employeeId.trim(), name: f.name.trim(), designation: f.designation.trim(), kind: f.kind, ...opt('phone'), ...opt('email'), ...opt('department'), ...(f.joiningDate ? { joiningDate: f.joiningDate } : {}) }),
    onSuccess: async () => { await onSaved(); onClose(); },
  });
  return (
    <Modal open onOpenChange={(o) => { if (!o) onClose(); }} title={staff ? `Edit ${staff.name}` : 'Add staff member'}>
      <form className="grid gap-3 sm:grid-cols-2" onSubmit={(e) => { e.preventDefault(); m.mutate(); }}>
        <Field label="Employee ID" htmlFor="st-emp"><Input id="st-emp" required maxLength={30} value={f.employeeId} onChange={set('employeeId')} disabled={Boolean(staff)} /></Field>
        <Field label="Name" htmlFor="st-name"><Input id="st-name" required maxLength={120} value={f.name} onChange={set('name')} /></Field>
        <Field label="Designation" htmlFor="st-des"><Input id="st-des" required maxLength={80} placeholder="TGT Maths" value={f.designation} onChange={set('designation')} /></Field>
        <Field label="Department" htmlFor="st-dep"><Input id="st-dep" maxLength={80} value={f.department} onChange={set('department')} /></Field>
        <Field label="Phone" htmlFor="st-phone"><Input id="st-phone" type="tel" maxLength={20} value={f.phone} onChange={set('phone')} /></Field>
        <Field label="Email" htmlFor="st-email"><Input id="st-email" type="email" maxLength={254} value={f.email} onChange={set('email')} /></Field>
        {!staff ? (
          <>
            <Field label="Type" htmlFor="st-kind"><Select id="st-kind" value={f.kind} onChange={set('kind')}><option value="teaching">Teaching</option><option value="non_teaching">Non-teaching</option></Select></Field>
            <Field label="Joining date" htmlFor="st-join"><Input id="st-join" type="date" max={todayInIndia()} value={f.joiningDate} onChange={set('joiningDate')} /></Field>
          </>
        ) : null}
        {m.error ? <div className="sm:col-span-2"><Alert>{errorText(m.error)}</Alert></div> : null}
        <div className="sm:col-span-2"><Button type="submit" disabled={m.isPending}>{m.isPending ? 'Saving…' : 'Save'}</Button></div>
      </form>
    </Modal>
  );
}

function StatusModal({ staff, onClose, onSaved }: { staff: StaffRow; onClose: () => void; onSaved: () => Promise<unknown> }) {
  const [status, setStatus] = useState(staff.status);
  const [endDate, setEndDate] = useState(todayInIndia());
  const ending = status === 'resigned' || status === 'terminated';
  const m = useMutation({
    mutationFn: async () => post(`/staff/${staff.id}/status`, { status, ...(ending ? { endDate } : {}) }),
    onSuccess: async () => { await onSaved(); onClose(); },
  });
  return (
    <Modal open onOpenChange={(o) => { if (!o) onClose(); }} title={`Employment status — ${staff.name}`} description="Resigned/terminated staff lose system access immediately; their history is kept.">
      <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); m.mutate(); }}>
        <Field label="Status" htmlFor="ss-status">
          <Select id="ss-status" value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="active">Active</option><option value="on_leave">On leave</option><option value="resigned">Resigned</option><option value="terminated">Terminated</option>
          </Select>
        </Field>
        {ending ? <Field label="Last working day" htmlFor="ss-end"><Input id="ss-end" type="date" required value={endDate} onChange={(e) => setEndDate(e.target.value)} /></Field> : null}
        {m.error ? <Alert>{errorText(m.error)}</Alert> : null}
        <Button type="submit" variant={ending ? 'danger' : 'primary'} disabled={m.isPending || status === staff.status}>Save</Button>
      </form>
    </Modal>
  );
}
