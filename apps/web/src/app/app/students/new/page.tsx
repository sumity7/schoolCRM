'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { errorText, post } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { sectionLabel, sortSections, useSections } from '@/lib/lookups';
import { GENDERS } from '@/lib/students';
import { Alert, Button, Card, Field, Input, PageHeader, Select } from '@/components/ui/primitives';

const todayInIndia = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date());

export default function NewStudentPage() {
  const router = useRouter();
  const qc = useQueryClient();
  const { can } = useAuth();
  const sections = useSections({ enabled: can('academics:read') });
  const [f, setF] = useState({
    admissionNo: '', firstName: '', lastName: '', dob: '', gender: '', phone: '', email: '', admissionDate: todayInIndia(),
    sectionId: '', rollNo: '', gName: '', gPhone: '', gEmail: '', gRel: 'father',
  });
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setF((p) => ({ ...p, [k]: e.target.value }));

  const create = useMutation({
    mutationFn: async () => {
      const body: Record<string, unknown> = {
        admissionNo: f.admissionNo.trim(), firstName: f.firstName.trim(), dob: f.dob, admissionDate: f.admissionDate,
      };
      if (f.lastName.trim()) body.lastName = f.lastName.trim();
      if (f.gender) body.gender = f.gender;
      if (f.phone.trim() || f.email.trim()) body.contact = { ...(f.phone.trim() ? { phone: f.phone.trim() } : {}), ...(f.email.trim() ? { email: f.email.trim() } : {}) };
      if (f.sectionId) body.enrollment = { sectionId: f.sectionId, ...(f.rollNo ? { rollNo: Number(f.rollNo) } : {}) };
      if (f.gName.trim() || f.gPhone.trim()) {
        body.guardians = [{ name: f.gName.trim(), phone: f.gPhone.trim(), relationship: f.gRel, isPrimary: true, ...(f.gEmail.trim() ? { email: f.gEmail.trim() } : {}) }];
      }
      return (await post<{ id: string }>('/students', body)).data;
    },
    onSuccess: async (s) => {
      await qc.invalidateQueries({ queryKey: ['students'] });
      router.push(`/app/students/${s.id}`);
    },
  });

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <PageHeader title="Add student" description="Fields marked * are required. Aadhaar, caste and religion are intentionally not collected." />
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          create.mutate();
        }}
      >
        <Card className="grid gap-4 p-4 sm:grid-cols-2">
          <h2 className="font-medium sm:col-span-2">Student</h2>
          <Field label="Admission no. *" htmlFor="admissionNo"><Input id="admissionNo" required maxLength={30} value={f.admissionNo} onChange={set('admissionNo')} /></Field>
          <Field label="Admission date *" htmlFor="admissionDate"><Input id="admissionDate" type="date" required value={f.admissionDate} onChange={set('admissionDate')} max={todayInIndia()} /></Field>
          <Field label="First name *" htmlFor="firstName"><Input id="firstName" required maxLength={80} value={f.firstName} onChange={set('firstName')} /></Field>
          <Field label="Last name" htmlFor="lastName"><Input id="lastName" maxLength={80} value={f.lastName} onChange={set('lastName')} /></Field>
          <Field label="Date of birth *" htmlFor="dob"><Input id="dob" type="date" required value={f.dob} onChange={set('dob')} max={todayInIndia()} /></Field>
          <Field label="Gender" htmlFor="gender">
            <Select id="gender" value={f.gender} onChange={set('gender')}>
              <option value="">—</option>
              {GENDERS.map((g) => <option key={g.value} value={g.value}>{g.label}</option>)}
            </Select>
          </Field>
          <Field label="Phone" htmlFor="phone"><Input id="phone" type="tel" inputMode="tel" maxLength={20} value={f.phone} onChange={set('phone')} /></Field>
          <Field label="Email" htmlFor="email"><Input id="email" type="email" maxLength={254} value={f.email} onChange={set('email')} /></Field>
        </Card>

        <Card className="grid gap-4 p-4 sm:grid-cols-2">
          <h2 className="font-medium sm:col-span-2">Class</h2>
          <Field label="Class & section" htmlFor="sectionId">
            <Select id="sectionId" value={f.sectionId} onChange={set('sectionId')}>
              <option value="">Not enrolled yet</option>
              {sortSections(sections.data ?? []).map((s) => <option key={s.id} value={s.id}>{sectionLabel(s)}{s.capacity ? ` (${s.strength}/${s.capacity})` : ''}</option>)}
            </Select>
          </Field>
          <Field label="Roll no." htmlFor="rollNo"><Input id="rollNo" type="number" min={1} max={999} value={f.rollNo} onChange={set('rollNo')} disabled={!f.sectionId} /></Field>
          {sections.data && sections.data.length === 0 ? <p className="text-sm text-muted-foreground sm:col-span-2">No sections in the active session yet — create them under Classes & sections.</p> : null}
        </Card>

        {can('guardians:create') ? (
          <Card className="grid gap-4 p-4 sm:grid-cols-2">
            <h2 className="font-medium sm:col-span-2">Primary guardian <span className="text-sm font-normal text-muted-foreground">(optional — more can be added later)</span></h2>
            <Field label="Name" htmlFor="gName"><Input id="gName" maxLength={120} value={f.gName} onChange={set('gName')} /></Field>
            <Field label="Relationship" htmlFor="gRel">
              <Select id="gRel" value={f.gRel} onChange={set('gRel')}>
                <option value="father">Father</option><option value="mother">Mother</option><option value="guardian">Guardian</option><option value="other">Other</option>
              </Select>
            </Field>
            <Field label="Phone" htmlFor="gPhone"><Input id="gPhone" type="tel" inputMode="tel" maxLength={20} value={f.gPhone} onChange={set('gPhone')} required={Boolean(f.gName.trim())} /></Field>
            <Field label="Email" htmlFor="gEmail"><Input id="gEmail" type="email" maxLength={254} value={f.gEmail} onChange={set('gEmail')} /></Field>
          </Card>
        ) : null}

        {create.error ? <Alert>{errorText(create.error)}</Alert> : null}
        <div className="flex flex-wrap gap-2">
          <Button type="submit" disabled={create.isPending} data-testid="save-student">{create.isPending ? 'Saving…' : 'Save student'}</Button>
          <Link href="/app/students" className="inline-flex min-h-11 items-center rounded-lg px-4 text-sm hover:bg-muted">Cancel</Link>
        </div>
      </form>
    </div>
  );
}
