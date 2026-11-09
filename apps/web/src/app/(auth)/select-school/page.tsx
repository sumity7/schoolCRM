'use client';

import { useEffect, useState } from 'react';
import type { MeResponse } from '@edunex/shared';
import { ApiError, post } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { Alert, Button, Card, Skeleton } from '@/components/ui/primitives';

export default function SelectSchoolPage() {
  const { me, loading, logout } = useAuth();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    if (!loading && !me) window.location.assign('/login');
  }, [loading, me]);

  async function choose(membershipId: string) {
    setBusy(membershipId);
    setError(null);
    try {
      await post<MeResponse>('/auth/select-school', { membershipId });
      window.location.assign('/app'); // full reload: every cached view is dropped when the school changes
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not select school');
      setBusy(null);
    }
  }

  if (loading || !me) return <Skeleton className="h-40 w-full" />;
  return (
    <Card className="p-6">
      <h2 className="mb-1 text-lg font-semibold">Choose a school</h2>
      <p className="mb-4 text-sm text-muted-foreground">You belong to more than one school. You can switch later from the top bar.</p>
      {error ? <Alert>{error}</Alert> : null}
      {me.memberships.length === 0 ? <Alert tone="info">Your account is not linked to an active school. Contact your school administrator.</Alert> : null}
      <ul className="mt-3 space-y-2">
        {me.memberships.map((m) => (
          <li key={m.membershipId}>
            <Button variant="outline" className="w-full justify-between" onClick={() => choose(m.membershipId)} disabled={busy !== null} data-testid={`school-${m.schoolCode}`}>
              <span>{m.schoolName}</span>
              <span className="text-xs text-muted-foreground">{m.roleKeys.join(', ')}</span>
            </Button>
          </li>
        ))}
      </ul>
      <Button variant="ghost" className="mt-4 w-full" onClick={logout}>
        Sign out
      </Button>
    </Card>
  );
}
