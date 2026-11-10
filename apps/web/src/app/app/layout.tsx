'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import { ArrowUpRight, BadgeCheck, Baby, ShieldCheck, BarChart3, Megaphone, NotebookPen, Building2, Coins, FileText, Percent, Receipt, Wallet, Wrench, CalendarCheck, CalendarDays, ClipboardCheck, GraduationCap, History, Layers, LayoutDashboard, LogOut, Menu, Moon, Sun, Upload, UserCog, Users, X } from 'lucide-react';
import type { PermissionKey, Scope } from '@edunex/shared';
import { useAuth } from '@/lib/auth';
import { cn } from '@/lib/utils';
import { Skeleton } from '@/components/ui/primitives';

interface NavItem {
  href: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  perm?: PermissionKey;
  /** Require at least school-wide scope (hides admin screens from teachers who hold the key only for their own records). */
  schoolScope?: boolean;
  /** Additional permission (finance screens also need financial:view). */
  also?: PermissionKey;
}

/** Navigation is filtered by permissions for UX only; the API enforces everything. Only built screens appear (no dead links). */
/** Parents get their own, minimal menu (their permissions are 'own' scope and only parent routes serve them). */
const PARENT_NAV: Array<{ group?: string; items: NavItem[] }> = [
  { items: [{ href: '/app', label: 'My children', icon: Baby }, { href: '/app/notices', label: 'Notices', icon: Megaphone }] },
];

const NAV: Array<{ group?: string; items: NavItem[] }> = [
  {
    items: [
      { href: '/app', label: 'Dashboard', icon: LayoutDashboard },
      { href: '/app/attendance', label: 'Attendance', icon: CalendarCheck, perm: 'attendance:read' },
      { href: '/app/attendance/reports', label: 'Attendance reports', icon: BarChart3, perm: 'attendance:read' },
      { href: '/app/attendance/corrections', label: 'Corrections', icon: ClipboardCheck, perm: 'attendance:approve' },
      { href: '/app/students', label: 'Students', icon: GraduationCap, perm: 'students:read' },
      { href: '/app/imports', label: 'Imports', icon: Upload, perm: 'imports:create' },
      { href: '/app/staff', label: 'Staff', icon: Users, perm: 'staff:read', schoolScope: true },
      { href: '/app/exams', label: 'Exams & results', icon: NotebookPen, perm: 'exams:read' },
      { href: '/app/notices', label: 'Notices', icon: Megaphone, perm: 'notices:read' },
    ],
  },
  {
    group: 'Fees',
    items: [
      { href: '/app/fees/collect', label: 'Collect fee', icon: Wallet, perm: 'payments:create', also: 'financial:view' },
      { href: '/app/fees/invoices', label: 'Invoices', icon: FileText, perm: 'invoices:read', also: 'financial:view' },
      { href: '/app/fees/payments', label: 'Payments', icon: Receipt, perm: 'payments:read', also: 'financial:view' },
      { href: '/app/fees/concessions', label: 'Concessions', icon: Percent, perm: 'discounts:apply', also: 'financial:view' },
      { href: '/app/fees/approvals', label: 'Approvals', icon: BadgeCheck, perm: 'refunds:request', also: 'financial:view' },
      { href: '/app/fees/reports', label: 'Fee reports', icon: Coins, perm: 'reports:read', also: 'financial:view' },
      { href: '/app/fees/setup', label: 'Fee setup', icon: Wrench, perm: 'fees.config:read', also: 'financial:view' },
    ],
  },
  {
    group: 'Setup',
    items: [
      { href: '/app/settings/academic-sessions', label: 'Academic sessions', icon: CalendarDays, perm: 'academics:create' },
      { href: '/app/settings/classes', label: 'Classes & sections', icon: Layers, perm: 'academics:create' },
      { href: '/app/settings/calendar', label: 'Holidays & events', icon: CalendarDays, perm: 'academics:create' },
      { href: '/app/settings/promotion', label: 'Year-end promotion', icon: ArrowUpRight, perm: 'academics:approve' },
      { href: '/app/settings/users', label: 'Users & roles', icon: UserCog, perm: 'users:read' },
      { href: '/app/settings/school', label: 'School settings', icon: Building2, perm: 'school.settings:update' },
      { href: '/app/audit', label: 'Audit log', icon: History, perm: 'audit:read' },
    ],
  },
];
export default function AppLayout({ children }: { children: React.ReactNode }) {
  const { me, loading, can, logout } = useAuth();
  const path = usePathname();
  const [open, setOpen] = useState(false);
  const [dark, setDark] = useState(false);

  useEffect(() => {
    if (loading) return;
    if (!me || me.mfa?.pending) window.location.assign('/login');
    else if (!me.activeMembershipId) window.location.assign(me.platformRole && me.memberships.length === 0 ? '/platform' : '/select-school');
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

  const scopeOf = (k: PermissionKey) => me.permissions.find((p) => p.key === k)?.scope as Scope | undefined;
  const allowed = (n: NavItem) => !n.perm || (can(n.perm) && (!n.also || can(n.also)) && (!n.schoolScope || scopeOf(n.perm) === 'school'));
  const isParent = me.roleKeys.includes('parent');
  const groups = (isParent ? PARENT_NAV : NAV).map((g) => ({ ...g, items: g.items.filter(allowed) })).filter((g) => g.items.length > 0);
  // the most specific matching entry is the active one (/app/attendance/reports must not also light up /app/attendance)
  const activeHref = groups.flatMap((g) => g.items).map((n) => n.href)
    .filter((h) => (h === '/app' ? path === '/app' : path === h || path.startsWith(`${h}/`)))
    .sort((a, b) => b.length - a.length)[0];
  const nav = (
    <nav aria-label="Main" className="flex flex-col gap-1 overflow-y-auto p-3">
      {groups.map((g) => (
        <div key={g.group ?? 'main'} className="flex flex-col gap-1">
          {g.group ? <p className="mt-3 px-3 text-xs font-medium uppercase tracking-wide text-sidebar-foreground/60">{g.group}</p> : null}
          {g.items.map((n) => {
            const active = n.href === activeHref;
            return (
              <Link key={n.href} href={n.href} onClick={() => setOpen(false)} aria-current={active ? 'page' : undefined}
                className={cn('flex min-h-11 items-center gap-3 rounded-lg px-3 text-sm text-sidebar-foreground hover:bg-sidebar-active', active && 'bg-sidebar-active text-white')}>
                <n.icon className="h-4 w-4" aria-hidden /> {n.label}
              </Link>
            );
          })}
        </div>
      ))}
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
          <Link href="/app/security" aria-label="Security" className="flex min-h-11 min-w-11 items-center justify-center rounded-lg hover:bg-muted" data-testid="security-link"><ShieldCheck className="h-4 w-4" /></Link>
          <button aria-label="Toggle theme" onClick={toggleTheme} className="min-h-11 min-w-11 rounded-lg hover:bg-muted">{dark ? <Sun className="mx-auto h-4 w-4" /> : <Moon className="mx-auto h-4 w-4" />}</button>
          <button aria-label="Sign out" onClick={logout} data-testid="logout" className="min-h-11 min-w-11 rounded-lg hover:bg-muted"><LogOut className="mx-auto h-4 w-4" /></button>
        </header>
        <main className="flex-1 p-3 sm:p-6">{children}</main>
      </div>
    </div>
  );
}
