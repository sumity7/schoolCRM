'use client';

import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { errorText, get, patch } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { Alert, Button, Card, Field, Input, PageHeader, Select, Skeleton } from '@/components/ui/primitives';

interface Settings {
  timezone: string; dateFormat: string; workingDays: number[]; academicYearStartMonth: number; themeColor: string; language: string;
  attendancePolicy: { teacherEditWindowDays: number; lateCountsAsPresent: boolean; halfDayWeight: number; lowAttendanceThresholdPct: number };
}
interface School { id: string; name: string; code: string; phone?: string; officialEmail?: string; website?: string; address?: { line1?: string; line2?: string; city?: string; state?: string; postalCode?: string }; status: string; settings: Settings; limits: { students: number; staff: number } }

const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

export default function SchoolSettingsPage() {
  const { me, can, refresh } = useAuth();
  const qc = useQueryClient();
  const editable = can('school.settings:update');
  const school = useQuery({ queryKey: ['school', me?.activeMembershipId], queryFn: async () => (await get<School>('/schools/me')).data });
  const [p, setP] = useState({ name: '', phone: '', officialEmail: '', website: '', line1: '', city: '', state: '', postalCode: '' });
  const [s, setS] = useState<Settings | null>(null);
  const [saved, setSaved] = useState<string | null>(null);

  useEffect(() => {
    const d = school.data;
    if (!d) return;
    setP({ name: d.name, phone: d.phone ?? '', officialEmail: d.officialEmail ?? '', website: d.website ?? '', line1: d.address?.line1 ?? '', city: d.address?.city ?? '', state: d.address?.state ?? '', postalCode: d.address?.postalCode ?? '' });
    setS(d.settings);
  }, [school.data]);

  const saveProfile = useMutation({
    mutationFn: async () => patch('/schools/me', {
      name: p.name.trim(),
      ...(p.phone.trim() ? { phone: p.phone.trim() } : {}), ...(p.officialEmail.trim() ? { officialEmail: p.officialEmail.trim() } : {}), ...(p.website.trim() ? { website: p.website.trim() } : {}),
      address: { line1: p.line1, city: p.city, state: p.state, postalCode: p.postalCode },
    }),
    onSuccess: async () => { setSaved('Profile saved'); await qc.invalidateQueries({ queryKey: ['school'] }); await refresh(); },
  });
  const saveSettings = useMutation({
    mutationFn: async () => patch('/schools/me/settings', { workingDays: s!.workingDays, dateFormat: s!.dateFormat, academicYearStartMonth: s!.academicYearStartMonth, attendancePolicy: s!.attendancePolicy }),
    onSuccess: async () => { setSaved('Policies saved'); await qc.invalidateQueries(); },
  });

  if (school.isLoading || !s) return <Skeleton className="mx-auto h-60 max-w-3xl" />;
  if (school.error) return <Alert>{errorText(school.error)}</Alert>;
  const ap = s.attendancePolicy;
  const setAp = (k: keyof Settings['attendancePolicy'], v: number | boolean) => setS({ ...s, attendancePolicy: { ...ap, [k]: v } });

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <PageHeader title="School settings" description={`School code: ${school.data?.code} · plan limits: ${school.data?.limits.students} students, ${school.data?.limits.staff} staff`} />
      {saved ? <Alert tone="success">{saved}</Alert> : null}

      <Card className="p-4">
        <form className="grid gap-3 sm:grid-cols-2" onSubmit={(e) => { e.preventDefault(); setSaved(null); saveProfile.mutate(); }}>
          <h2 className="font-medium sm:col-span-2">Profile</h2>
          <div className="sm:col-span-2"><Field label="School name" htmlFor="sc-name"><Input id="sc-name" required minLength={2} maxLength={160} disabled={!editable} value={p.name} onChange={(e) => setP({ ...p, name: e.target.value })} /></Field></div>
          <Field label="Phone" htmlFor="sc-phone"><Input id="sc-phone" type="tel" maxLength={30} disabled={!editable} value={p.phone} onChange={(e) => setP({ ...p, phone: e.target.value })} /></Field>
          <Field label="Official email" htmlFor="sc-email"><Input id="sc-email" type="email" disabled={!editable} value={p.officialEmail} onChange={(e) => setP({ ...p, officialEmail: e.target.value })} /></Field>
          <div className="sm:col-span-2"><Field label="Website" htmlFor="sc-web"><Input id="sc-web" type="url" placeholder="https://" disabled={!editable} value={p.website} onChange={(e) => setP({ ...p, website: e.target.value })} /></Field></div>
          <div className="sm:col-span-2"><Field label="Address" htmlFor="sc-line1"><Input id="sc-line1" maxLength={200} disabled={!editable} value={p.line1} onChange={(e) => setP({ ...p, line1: e.target.value })} /></Field></div>
          <Field label="City" htmlFor="sc-city"><Input id="sc-city" maxLength={80} disabled={!editable} value={p.city} onChange={(e) => setP({ ...p, city: e.target.value })} /></Field>
          <Field label="State" htmlFor="sc-state"><Input id="sc-state" maxLength={80} disabled={!editable} value={p.state} onChange={(e) => setP({ ...p, state: e.target.value })} /></Field>
          <Field label="PIN code" htmlFor="sc-pin"><Input id="sc-pin" maxLength={12} disabled={!editable} value={p.postalCode} onChange={(e) => setP({ ...p, postalCode: e.target.value })} /></Field>
          {saveProfile.error ? <div className="sm:col-span-2"><Alert>{errorText(saveProfile.error)}</Alert></div> : null}
          {editable ? <div className="sm:col-span-2"><Button type="submit" disabled={saveProfile.isPending}>Save profile</Button></div> : null}
        </form>
      </Card>

      <Card className="p-4">
        <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); setSaved(null); saveSettings.mutate(); }}>
          <h2 className="font-medium">Calendar & attendance policy</h2>
          <fieldset>
            <legend className="mb-1.5 text-sm font-medium">Working days</legend>
            <div className="flex flex-wrap gap-1.5">
              {DAYS.map((d, i) => {
                const on = s.workingDays.includes(i + 1);
                return (
                  <button key={d} type="button" aria-pressed={on} disabled={!editable}
                    onClick={() => setS({ ...s, workingDays: on ? s.workingDays.filter((x) => x !== i + 1) : [...s.workingDays, i + 1].sort() })}
                    className={`min-h-11 min-w-14 rounded-lg border text-sm font-medium ${on ? 'border-primary bg-primary text-primary-foreground' : 'border-input bg-card'}`}>{d}</button>
                );
              })}
            </div>
          </fieldset>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Academic year starts in" htmlFor="sc-month">
              <Select id="sc-month" disabled={!editable} value={s.academicYearStartMonth} onChange={(e) => setS({ ...s, academicYearStartMonth: Number(e.target.value) })}>
                {MONTHS.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}
              </Select>
            </Field>
            <Field label="Date format" htmlFor="sc-df">
              <Select id="sc-df" disabled={!editable} value={s.dateFormat} onChange={(e) => setS({ ...s, dateFormat: e.target.value })}>
                <option value="DD/MM/YYYY">DD/MM/YYYY</option><option value="MM/DD/YYYY">MM/DD/YYYY</option><option value="YYYY-MM-DD">YYYY-MM-DD</option>
              </Select>
            </Field>
            <Field label="Teachers may edit attendance for (days after the date)" htmlFor="sc-win"><Input id="sc-win" type="number" min={0} max={30} disabled={!editable} value={ap.teacherEditWindowDays} onChange={(e) => setAp('teacherEditWindowDays', Number(e.target.value))} /></Field>
            <Field label="Low-attendance threshold (%)" htmlFor="sc-low"><Input id="sc-low" type="number" min={1} max={100} disabled={!editable} value={ap.lowAttendanceThresholdPct} onChange={(e) => setAp('lowAttendanceThresholdPct', Number(e.target.value))} /></Field>
            <Field label="A half day counts as" htmlFor="sc-half">
              <Select id="sc-half" disabled={!editable} value={ap.halfDayWeight} onChange={(e) => setAp('halfDayWeight', Number(e.target.value))}>
                <option value={0.5}>Half a day present</option><option value={1}>A full day present</option><option value={0}>Absent</option>
              </Select>
            </Field>
            <label className="flex min-h-11 items-center gap-2 self-end text-sm"><input type="checkbox" className="h-5 w-5" disabled={!editable} checked={ap.lateCountsAsPresent} onChange={(e) => setAp('lateCountsAsPresent', e.target.checked)} /> Late counts as present</label>
          </div>
          {saveSettings.error ? <Alert>{errorText(saveSettings.error)}</Alert> : null}
          {editable ? <Button type="submit" disabled={saveSettings.isPending || s.workingDays.length === 0}>Save policies</Button> : null}
        </form>
      </Card>
    </div>
  );
}
