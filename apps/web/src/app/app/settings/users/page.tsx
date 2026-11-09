'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { errorText, get, patch, post } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useStaff } from '@/lib/lookups';
import { Alert, Badge, Button, Field, Input, PageHeader, Select, Skeleton, Table, Td, Th } from '@/components/ui/primitives';
import { Modal } from '@/components/ui/modal';

interface Member { membershipId: string; userId: string; name?: string; email?: string; phone?: string; roleKeys: string[]; status: string; personType: string; version: number }
interface Role { id: string; key: string; name: string; description: string; isSystem: boolean }

const PORTAL_ROLES = new Set(['parent', 'student']);

export default function UsersPage() {
  const { me, can } = useAuth();
  const qc = useQueryClient();
  const [page, setPage] = useState(1);
  const [invite, setInvite] = useState(false);
  const [editing, setEditing] = useState<Member | null>(null);
  const list = useQuery({ queryKey: ['users', me?.activeMembershipId, page], queryFn: async () => get<Member[]>(`/users?page=${page}&limit=25`), placeholderData: (p) => p });
  const roles = useQuery({ queryKey: ['roles', me?.activeMembershipId], queryFn: async () => (await get<Role[]>('/roles')).data });
  const roleName = new Map((roles.data ?? []).map((r) => [r.key, r.name]));
  const staffRoles = (roles.data ?? []).filter((r) => !PORTAL_ROLES.has(r.key));
  const refresh = () => qc.invalidateQueries({ queryKey: ['users'] });
  const setStatus = useMutation({ mutationFn: async (v: { m: Member; status: 'active' | 'suspended' }) => patch(`/users/${v.m.membershipId}`, { status: v.status, version: v.m.version }), onSuccess: refresh });
  const meta = list.data?.meta;

  return (
    <div className="mx-auto max-w-5xl space-y-4">
      <PageHeader
        title="Users & roles"
        description="People who can sign in to this school. Suspending someone signs them out everywhere immediately."
        actions={can('users:create') ? <Button onClick={() => setInvite(true)} data-testid="invite-user">Invite staff</Button> : null}
      />
      {setStatus.error ? <Alert>{errorText(setStatus.error)}</Alert> : null}
      {list.isLoading ? <Skeleton className="h-24" /> : null}
      {list.error ? <Alert>{errorText(list.error)}</Alert> : null}
      {list.data && list.data.data.length > 0 ? (
        <Table minWidth={640} testId="users-table">
          <thead className="border-b border-border"><tr><Th>Name</Th><Th>Roles</Th><Th>Status</Th><Th /></tr></thead>
          <tbody>
            {list.data.data.map((m) => {
              const self = m.membershipId === me?.activeMembershipId;
              return (
                <tr key={m.membershipId} className="border-b border-border last:border-0">
                  <Td className="font-medium">{m.name}{self ? <span className="ml-1 text-xs text-muted-foreground">(you)</span> : null}<span className="block text-xs font-normal text-muted-foreground">{m.email ?? m.phone}</span></Td>
                  <Td>{m.roleKeys.map((k) => roleName.get(k) ?? k).join(', ')}</Td>
                  <Td><Badge tone={m.status === 'active' ? 'success' : m.status === 'invited' ? 'primary' : 'warning'}>{m.status}</Badge></Td>
                  <Td className="whitespace-nowrap text-right">
                    {can('users:update') && !self ? (
                      <div className="flex justify-end gap-1">
                        <Button size="sm" variant="ghost" onClick={() => setEditing(m)}>Roles</Button>
                        {m.status === 'active' ? <Button size="sm" variant="ghost" className="text-danger" disabled={setStatus.isPending} onClick={() => { if (window.confirm(`Suspend ${m.name}? They are signed out immediately.`)) setStatus.mutate({ m, status: 'suspended' }); }}>Suspend</Button> : null}
                        {m.status === 'suspended' ? <Button size="sm" variant="ghost" disabled={setStatus.isPending} onClick={() => setStatus.mutate({ m, status: 'active' })}>Reactivate</Button> : null}
                      </div>
                    ) : null}
                  </Td>
                </tr>
              );
            })}
          </tbody>
        </Table>
      ) : null}
      {meta && meta.totalPages > 1 ? (
        <div className="flex justify-end gap-2">
          <Button size="sm" variant="outline" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>Previous</Button>
          <Button size="sm" variant="outline" disabled={page >= meta.totalPages} onClick={() => setPage((p) => p + 1)}>Next</Button>
        </div>
      ) : null}
      {invite ? <InviteModal roles={staffRoles} onClose={() => setInvite(false)} onSaved={refresh} /> : null}
      {editing ? <RolesModal member={editing} roles={staffRoles} onClose={() => setEditing(null)} onSaved={refresh} /> : null}
    </div>
  );
}

function RolePicker({ roles, value, onChange }: { roles: Role[]; value: string[]; onChange: (v: string[]) => void }) {
  return (
    <fieldset className="space-y-1">
      <legend className="mb-1 text-sm font-medium">Roles</legend>
      {roles.map((r) => (
        <label key={r.key} className="flex min-h-11 items-start gap-2 text-sm">
          <input type="checkbox" className="mt-1 h-5 w-5" checked={value.includes(r.key)} onChange={(e) => onChange(e.target.checked ? [...value, r.key] : value.filter((k) => k !== r.key))} />
          <span><span className="font-medium">{r.name}</span><span className="block text-xs text-muted-foreground">{r.description}</span></span>
        </label>
      ))}
    </fieldset>
  );
}

function InviteModal({ roles, onClose, onSaved }: { roles: Role[]; onClose: () => void; onSaved: () => Promise<unknown> }) {
  const { can } = useAuth();
  const staff = useStaff(can('staff:read'));
  const [f, setF] = useState({ name: '', email: '', phone: '', staffId: '' });
  const [roleKeys, setRoleKeys] = useState<string[]>(['teacher']);
  const [done, setDone] = useState(false);
  const m = useMutation({
    mutationFn: async () => post('/users/invite', { name: f.name.trim(), email: f.email.trim(), roleKeys, ...(f.phone.trim() ? { phone: f.phone.trim() } : {}), ...(f.staffId ? { staffId: f.staffId } : {}) }),
    onSuccess: async () => { await onSaved(); setDone(true); },
  });
  return (
    <Modal open onOpenChange={(o) => { if (!o) onClose(); }} title="Invite a staff member" description="They receive a link to set their password. (Development: links are written to the local mail outbox — no email provider is connected.)">
      {done ? (
        <div className="space-y-3"><Alert tone="success">Invitation created.</Alert><Button onClick={onClose}>Close</Button></div>
      ) : (
        <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); m.mutate(); }}>
          <Field label="Name" htmlFor="inv-name"><Input id="inv-name" required maxLength={120} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
          <Field label="Email" htmlFor="inv-email"><Input id="inv-email" required type="email" maxLength={254} value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} /></Field>
          <Field label="Phone (optional)" htmlFor="inv-phone"><Input id="inv-phone" type="tel" maxLength={20} value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} /></Field>
          {staff.data ? (
            <Field label="Staff record (links the login to their classes)" htmlFor="inv-staff">
              <Select id="inv-staff" value={f.staffId} onChange={(e) => setF({ ...f, staffId: e.target.value })}>
                <option value="">Not linked</option>
                {staff.data.filter((s) => s.status === 'active').map((s) => <option key={s.id} value={s.id}>{s.name} ({s.employeeId})</option>)}
              </Select>
            </Field>
          ) : null}
          <RolePicker roles={roles} value={roleKeys} onChange={setRoleKeys} />
          {m.error ? <Alert>{errorText(m.error)}</Alert> : null}
          <Button type="submit" disabled={m.isPending || roleKeys.length === 0}>{m.isPending ? 'Sending…' : 'Send invitation'}</Button>
        </form>
      )}
    </Modal>
  );
}

function RolesModal({ member, roles, onClose, onSaved }: { member: Member; roles: Role[]; onClose: () => void; onSaved: () => Promise<unknown> }) {
  const [roleKeys, setRoleKeys] = useState<string[]>(member.roleKeys);
  const m = useMutation({ mutationFn: async () => patch(`/users/${member.membershipId}`, { roleKeys, version: member.version }), onSuccess: async () => { await onSaved(); onClose(); } });
  return (
    <Modal open onOpenChange={(o) => { if (!o) onClose(); }} title={`Roles — ${member.name ?? ''}`} description="Changes take effect on their next request. You cannot grant permissions you do not have.">
      <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); m.mutate(); }}>
        <RolePicker roles={roles} value={roleKeys} onChange={setRoleKeys} />
        {m.error ? <Alert>{errorText(m.error)}</Alert> : null}
        <Button type="submit" disabled={m.isPending || roleKeys.length === 0}>Save</Button>
      </form>
    </Modal>
  );
}
