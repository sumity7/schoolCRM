'use client';

import { useQuery } from '@tanstack/react-query';
import { get } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { Card, Skeleton } from '@/components/ui/primitives';
import { inr } from '@/lib/fees';
import { ParentHome } from '@/components/parent-home';

const todayInIndia = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date());

interface Entitlements { limits: { students: number; staff: number } }

/** Real data only: counts come from the API; nothing is fabricated. Charts arrive with reports that have data to show. */
export default function DashboardPage() {
  const { me } = useAuth();
  return me?.roleKeys.includes('parent') ? <ParentHome /> : <StaffDashboard />;
}

function StaffDashboard() {
  const { me, can } = useAuth();
  const students = useQuery({ queryKey: ['students-count'], enabled: can('students:read'), queryFn: async () => (await get<unknown[]>('/students?limit=1')).meta?.total ?? 0 });
  const ent = useQuery({ queryKey: ['entitlements'], queryFn: async () => (await get<Entitlements>('/schools/me/entitlements')).data });
  const finance = can('reports:read') && can('financial:view');
  const collected = useQuery({ queryKey: ['dash-collected', me?.activeMembershipId], enabled: finance, queryFn: async () => (await get<{ totalPaise: number; count: number }>(`/fees/reports/collection?from=${todayInIndia()}&to=${todayInIndia()}`)).data });
  const dues = useQuery({ queryKey: ['dash-dues', me?.activeMembershipId], enabled: finance, queryFn: async () => (await get<{ totalPaise: number; overduePaise: number; students: number }>('/fees/reports/outstanding')).data });
  const sections = useQuery({ queryKey: ['sections-mine'], enabled: can('academics:read'), queryFn: async () => (await get<Array<{ id: string; name: string; className?: string; strength: number }>>('/sections')).data });

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div>
        <h1 className="text-xl font-semibold">Welcome, {me?.user.name}</h1>
        <p className="text-sm text-muted-foreground">{me?.school?.name}</p>
      </div>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {can('students:read') ? (
          <Card className="p-4" data-testid="stat-students">
            <p className="text-sm text-muted-foreground">Students you can see</p>
            {students.isLoading ? <Skeleton className="mt-2 h-8 w-16" /> : <p className="mt-1 text-3xl font-semibold">{students.data ?? 0}</p>}
            {ent.data ? <p className="mt-1 text-xs text-muted-foreground">Plan limit: {ent.data.limits.students}</p> : null}
          </Card>
        ) : null}
        {can('academics:read') ? (
          <Card className="p-4">
            <p className="text-sm text-muted-foreground">Sections</p>
            {sections.isLoading ? <Skeleton className="mt-2 h-8 w-16" /> : <p className="mt-1 text-3xl font-semibold">{sections.data?.length ?? 0}</p>}
          </Card>
        ) : null}
        {finance ? (
          <Card className="p-4" data-testid="stat-collected">
            <p className="text-sm text-muted-foreground">Collected today</p>
            {collected.isLoading ? <Skeleton className="mt-2 h-8 w-24" /> : <p className="mt-1 text-3xl font-semibold">{inr(collected.data?.totalPaise ?? 0)}</p>}
            <p className="mt-1 text-xs text-muted-foreground">{collected.data?.count ?? 0} receipts</p>
          </Card>
        ) : null}
        {finance ? (
          <Card className="p-4">
            <p className="text-sm text-muted-foreground">Fees outstanding</p>
            {dues.isLoading ? <Skeleton className="mt-2 h-8 w-24" /> : <p className="mt-1 text-3xl font-semibold">{inr(dues.data?.totalPaise ?? 0)}</p>}
            <p className="mt-1 text-xs text-muted-foreground">{inr(dues.data?.overduePaise ?? 0)} overdue · {dues.data?.students ?? 0} students</p>
          </Card>
        ) : null}
      </div>
      {can('students:read') && students.data === 0 ? (
        <Card className="p-5">
          <h2 className="font-medium">Get started</h2>
          <p className="mt-1 text-sm text-muted-foreground">No students yet. Set up the academic session, classes and sections, then add or import students.</p>
        </Card>
      ) : null}
    </div>
  );
}
