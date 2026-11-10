'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect } from 'react';
import { History, LayoutDashboard, LogOut } from 'lucide-react';
import { useAuth } from '@/lib/auth';
import { cn } from '@/lib/utils';
import { Alert, Skeleton } from '@/components/ui/primitives';
import { TwoFactor } from '@/components/two-factor';

/** Platform console shell (R5). Separate from the school app: no school is selected here. */
export default function PlatformLayout({ children }: { children: React.ReactNode }) {
  const { me, loading, logout } = useAuth();
  const path = usePathname();
  useEffect(() => {
    if (!loading && (!me || me.mfa?.pending)) window.location.assign('/login');
  }, [loading, me]);
  if (loading || !me) return <div className="p-6"><Skeleton className="h-8 w-48" /></div>;
  if (!me.platformRole) return <div className="mx-auto max-w-xl p-6"><Alert>This console is for EduNex platform staff only.</Alert></div>;
  const items = [{ href: '/platform', label: 'Schools', icon: LayoutDashboard }, { href: '/platform/audit', label: 'Audit log', icon: History }];
  return (
    <div className="min-h-dvh">
      <header className="flex min-h-14 flex-wrap items-center gap-2 border-b border-border bg-sidebar px-4 text-white">
        <span className="font-semibold">EduNex · Platform</span>
        <nav aria-label="Platform" className="flex flex-1 gap-1">
          {items.map((n) => (
            <Link key={n.href} href={n.href} className={cn('flex min-h-11 items-center gap-2 rounded-lg px-3 text-sm text-sidebar-foreground hover:bg-sidebar-active', path === n.href && 'bg-sidebar-active text-white')}>
              <n.icon className="h-4 w-4" aria-hidden /> {n.label}
            </Link>
          ))}
        </nav>
        <span className="text-xs text-sidebar-foreground">{me.user.name} · {me.platformRole.replace('_', ' ')}</span>
        <button aria-label="Sign out" onClick={logout} className="min-h-11 min-w-11 rounded-lg hover:bg-sidebar-active"><LogOut className="mx-auto h-4 w-4" /></button>
      </header>
      <main className="mx-auto max-w-6xl p-3 sm:p-6">
        {me.mfa?.enabled ? children : (
          <div className="mx-auto max-w-2xl space-y-3">
            <Alert tone="info">Turn on two-factor authentication to use the platform console.</Alert>
            <TwoFactor />
          </div>
        )}
      </main>
    </div>
  );
}
