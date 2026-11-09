'use client';

import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Download } from 'lucide-react';
import { downloadFile, errorText, get } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { sectionLabel, sortSections, useSections } from '@/lib/lookups';
import { Alert, Button, Card, Input, PageHeader, Select, Skeleton, Table, Td, Th } from '@/components/ui/primitives';

interface Summary { markedDays: number; present: number; absent: number; late: number; halfDay: number; excused: number; percentage: number | null }
interface Monthly { month: string; markedDays: number; rows: Array<{ studentId: string; rollNo?: number; name: string } & Summary> }
interface Low { threshold: number; rows: Array<{ studentId: string; sectionId: string; name: string } & Summary> }

const thisMonth = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date()).slice(0, 7);

export default function AttendanceReportsPage() {
  const { me, can } = useAuth();
  const assigned = me?.permissions.find((p) => p.key === 'attendance:read')?.scope === 'assigned';
  const sections = useSections({ mine: assigned });
  const sorted = sortSections(sections.data ?? []);
  const secBy = new Map(sorted.map((s) => [s.id, s]));
  const [sectionId, setSectionId] = useState('');
  const [month, setMonth] = useState(thisMonth());
  const [dlError, setDlError] = useState<string | null>(null);
  useEffect(() => {
    if (!sectionId && sorted.length) setSectionId(sorted[0]!.id);
  }, [sorted, sectionId]);

  const monthly = useQuery({
    queryKey: ['att-monthly', me?.activeMembershipId, sectionId, month], enabled: Boolean(sectionId && month),
    queryFn: async () => (await get<Monthly>(`/attendance/reports/monthly?sectionId=${sectionId}&month=${month}`)).data,
  });
  const low = useQuery({ queryKey: ['att-low', me?.activeMembershipId], queryFn: async () => (await get<Low>('/attendance/reports/low-attendance')).data });
  const dl = (path: string, name: string) => { setDlError(null); downloadFile(path, name).catch((e) => setDlError(errorText(e))); };
  const canExport = can('attendance:export');

  return (
    <div className="mx-auto max-w-5xl space-y-4">
      <PageHeader title="Attendance reports" description="Percentages follow your school's attendance policy (late and half-day rules)." />
      {dlError ? <Alert>{dlError}</Alert> : null}
      <Card className="space-y-3 p-4">
        <div className="flex flex-wrap items-end justify-between gap-2">
          <h2 className="font-medium">Monthly register</h2>
          {canExport && sectionId ? <Button size="sm" variant="outline" onClick={() => dl(`/attendance/reports/monthly.csv?sectionId=${sectionId}&month=${month}`, `attendance-${month}.csv`)} data-testid="export-monthly"><Download className="h-4 w-4" aria-hidden /> CSV</Button> : null}
        </div>
        <div className="grid gap-2 sm:grid-cols-2">
          <Select aria-label="Section" value={sectionId} onChange={(e) => setSectionId(e.target.value)}>
            {sorted.length === 0 ? <option value="">No sections</option> : null}
            {sorted.map((s) => <option key={s.id} value={s.id}>{sectionLabel(s)}</option>)}
          </Select>
          <Input type="month" aria-label="Month" value={month} max={thisMonth()} onChange={(e) => setMonth(e.target.value)} />
        </div>
        {monthly.isLoading ? <Skeleton className="h-32" /> : null}
        {monthly.error ? <Alert>{errorText(monthly.error)}</Alert> : null}
        {monthly.data ? (
          monthly.data.rows.length === 0 ? <Alert tone="info">No students in this section.</Alert> : (
            <>
              <p className="text-sm text-muted-foreground">{monthly.data.markedDays} day(s) marked this month.</p>
              <Table minWidth={640} testId="monthly-table">
                <thead className="border-b border-border"><tr><Th>Roll</Th><Th>Name</Th><Th>Days</Th><Th>P</Th><Th>A</Th><Th>L</Th><Th>H</Th><Th>E</Th><Th>%</Th></tr></thead>
                <tbody>
                  {monthly.data.rows.map((r) => (
                    <tr key={r.studentId} className="border-b border-border last:border-0">
                      <Td>{r.rollNo ?? '—'}</Td><Td className="font-medium">{r.name}</Td><Td>{r.markedDays}</Td><Td>{r.present}</Td><Td>{r.absent}</Td><Td>{r.late}</Td><Td>{r.halfDay}</Td><Td>{r.excused}</Td>
                      <Td className={r.percentage !== null && low.data && r.percentage < low.data.threshold ? 'font-semibold text-danger' : ''}>{r.percentage ?? '—'}</Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            </>
          )
        ) : null}
      </Card>

      <Card className="space-y-3 p-4">
        <div className="flex flex-wrap items-end justify-between gap-2">
          <h2 className="font-medium">Below {low.data?.threshold ?? '…'}% this session</h2>
          {canExport ? <Button size="sm" variant="outline" onClick={() => dl('/attendance/reports/low-attendance.csv', 'low-attendance.csv')}><Download className="h-4 w-4" aria-hidden /> CSV</Button> : null}
        </div>
        <p className="text-xs text-muted-foreground">Students with at least 5 marked days.</p>
        {low.isLoading ? <Skeleton className="h-24" /> : null}
        {low.error ? <Alert>{errorText(low.error)}</Alert> : null}
        {low.data && low.data.rows.length === 0 ? <Alert tone="success">No students below the threshold.</Alert> : null}
        {low.data && low.data.rows.length > 0 ? (
          <Table minWidth={480} testId="low-table">
            <thead className="border-b border-border"><tr><Th>Name</Th><Th>Class</Th><Th>Days</Th><Th>Absent</Th><Th>%</Th></tr></thead>
            <tbody>
              {low.data.rows.map((r) => (
                <tr key={r.studentId} className="border-b border-border last:border-0">
                  <Td className="font-medium">{r.name}</Td><Td>{secBy.get(r.sectionId) ? sectionLabel(secBy.get(r.sectionId)!) : '—'}</Td><Td>{r.markedDays}</Td><Td>{r.absent}</Td><Td className="font-semibold text-danger">{r.percentage}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        ) : null}
      </Card>
    </div>
  );
}
