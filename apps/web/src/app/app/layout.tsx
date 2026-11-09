'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import { CalendarCheck, GraduationCap, LayoutDashboard, LogOut, Menu, Moon, Sun, X } from 'lucide-react';
import type { PermissionKey } from '@edunex/shared';
import { useAuth } from '@/lib/auth';
import { cn } from '@/lib/utils';
import { Skeleton } from '@/components/ui/primitives';

interface NavItem {
  href: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  perm?: PermissionKey;
}

/** Navigation is filtered by permissions for UX only; the API enforces everything. */
const NAV: NavItem[] = [
  { href: '/app', label: 'Dashboard', icon: LayoutDashboard },
  { href: '/app/attendance', label: 'Attendance', icon: CalendarCheck, perm: 'attendance:read' },
  { href: '/app/students', label: 'Students', icon: GraduationCap, perm: 'students:read' },
  // Users, School settings and Audit log screens are not built yet — intentionally absent (no dead links).
];

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const { me, loading, can, logout } = useAuth();
  const path = usePathname();
  const [open, setOpen] = useState(false);
  const [dark, setDark] = useState(false);

  useEffect(() => {
    if (loading) return;
    if (!me) window.location.assign('/login');
    else if (!me.activeMembershipId) window.location.assign('/select-school');
  }, [loading, me]);

  useEffect(() => {
    try {
      const stored = localStorage.getItem('theme');
      if (stored) {
        document.documentElement.dataset.theme = stored;
        setDark(stored === 'dark');
      }
    } catch {
      /* storage unavailable: theme simply follows the system */
    }
  }, []);

  function toggleTheme() {
    const next = dark ? 'light' : 'dark';
    document.documentElement.dataset.theme = next;
    setDark(!dark);
    try {
      localStorage.setItem('theme', next);
    } catch {
      /* non-critical */
    }
  }

  if (loading || !me || !me.activeMembershipId) {
    return (
      <div className="p-6">
        <Skeleton className="h-8 w-48" />
      </div>
    );
  }

  const items = NAV.filter((n) => !n.perm || can(n.perm));
  const nav = (
    <nav aria-label="Main" className="flex flex-col gap-1 p-3">
      {items.map((n) => {
        const active = n.href === '/app' ? path === '/app' : path.startsWith(n.href);
        return (
          <Link key={n.href} href={n.href} onClick={() => setOpen(false)} aria-current={active ? 'page' : undefined}
            className={cn('flex min-h-11 items-center gap-3 rounded-lg px-3 text-sm text-sidebar-foreground hover:bg-sidebar-active', active && 'bg-sidebar-active text-white')}>
            <n.icon className="h-4 w-4" aria-hidden /> {n.label}
          </Link>
        );
      })}
    </nav>
  );

  return (
    <div className="min-h-dvh md:grid md:grid-cols-[240px_1fr]">
      <aside className="hidden bg-sidebar md:block">
        <div className="px-5 py-4 text-base font-semibold text-white">EduNex</div>
        {nav}
      </aside>
      {open ? (
        <div className="fixed inset-0 z-40 md:hidden" role="dialog" aria-modal="true" aria-label="Menu">
          <div className="absolute inset-0 bg-black/50" onClick={() => setOpen(false)} />
          <aside className="absolute inset-y-0 left-0 w-64 bg-sidebar">
            <div className="flex items-center justify-between px-5 py-4 text-white">
              <span className="font-semibold">EduNex</span>
              <button aria-label="Close menu" onClick={() => setOpen(false)} className="min-h-11 min-w-11"><X className="mx-auto h-5 w-5" /></button>
            </div>
            {nav}
          </aside>
        </div>
      ) : null}
      <div className="flex min-w-0 flex-col">
        <header className="sticky top-0 z-30 flex min-h-14 items-center gap-2 border-b border-border bg-card px-3 sm:px-5">
          <button aria-label="Open menu" className="min-h-11 min-w-11 md:hidden" onClick={() => setOpen(true)}><Menu className="mx-auto h-5 w-5" /></button>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold" data-testid="school-name">{me.school?.name}</p>
            <p className="truncate text-xs text-muted-foreground">{me.user.name} · {me.roleKeys.join(', ')}</p>
          </div>
          {me.memberships.length > 1 ? (
            <Link href="/select-school" className="min-h-11 rounded-lg px-3 py-2.5 text-sm hover:bg-muted" data-testid="switch-school">Switch school</Link>
          ) : null}
          <button aria-label="Toggle theme" onClick={toggleTheme} className="min-h-11 min-w-11 rounded-lg hover:bg-muted">{dark ? <Sun className="mx-auto h-4 w-4" /> : <Moon className="mx-auto h-4 w-4" />}</button>
          <button aria-label="Sign out" onClick={logout} data-testid="logout" className="min-h-11 min-w-11 rounded-lg hover:bg-muted"><LogOut className="mx-auto h-4 w-4" /></button>
        </header>
        <main className="flex-1 p-3 sm:p-6">{children}</main>
      </div>
    </div>
  );
}
