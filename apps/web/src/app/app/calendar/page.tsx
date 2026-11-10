'use client';

import Link from 'next/link';
import { useAuth } from '@/lib/auth';
import { SchoolCalendar } from '@/components/school-calendar';
import { Alert, PageHeader, Skeleton } from '@/components/ui/primitives';

/** Students: own class exam schedule + school holidays/events. Parents use each child's Calendar tab. */
export default function CalendarPage() {
  const { me } = useAuth();
  if (!me) return <Skeleton className="mx-auto h-40 max-w-3xl" />;
  if (me.roleKeys.includes('parent')) return <Alert tone="info">Open a child from <Link className="underline" href="/app">My children</Link> and choose the Calendar tab.</Alert>;
  if (!me.roleKeys.includes('student')) return <Alert tone="info">Staff manage holidays and events under <Link className="underline" href="/app/settings/calendar">Holidays & events</Link>.</Alert>;
  return (
    <div className="mx-auto max-w-3xl space-y-3">
      <PageHeader title="Calendar" description="Your exam schedule and school holidays." />
      <SchoolCalendar path="/student/me/calendar" />
    </div>
  );
}
