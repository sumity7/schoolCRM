'use client';

import { useQuery } from '@tanstack/react-query';
import { BookOpen, Building2, Presentation, ShieldCheck, Users, Wallet, type LucideIcon } from 'lucide-react';
import { get } from '@/lib/api';
import { cn } from '@/lib/utils';
import { Button, Card } from '@/components/ui/primitives';

export interface DemoAccount { key: string; label: string; description: string; available: boolean; identifier?: string; password?: string }

const ICONS: Record<string, LucideIcon> = { super_admin: ShieldCheck, school_admin: Building2, teacher: Presentation, accountant: Wallet, parent: Users, student: BookOpen };

/**
 * DEVELOPMENT-ONLY quick access. The list comes from the API (`/auth/demo-accounts`), which exists only when the
 * server flag DEMO_LOGIN_ENABLED is on and which verifies each account really exists. No credential lives in this
 * bundle, and in a production build this component renders nothing and never calls the API. Clicking a card only
 * FILLS the form — the person still presses the normal Sign in button.
 */
type Props = { selectedKey: string | null; onPick: (a: DemoAccount) => void; onClear: () => void };

export function DemoAccounts(props: Props) {
  // NODE_ENV is a build-time constant: in a production build this branch (and DemoAccountsDev, its endpoint path and its
  // copy) is dead code and is removed from the bundle entirely.
  if (process.env.NODE_ENV === 'production') return null;
  return <DemoAccountsDev {...props} />;
}

function DemoAccountsDev({ selectedKey, onPick, onClear }: Props) {
  const q = useQuery({ queryKey: ['demo-accounts'], retry: false, staleTime: 60_000, queryFn: async () => (await get<DemoAccount[]>('/auth/demo-accounts')).data });
  if (!q.data || !Array.isArray(q.data) || q.data.length === 0) return null;
  return (
    <section aria-labelledby="demo-title" className="mt-6" data-testid="demo-section">
      <Card className="p-4">
        <h2 id="demo-title" className="text-base font-semibold">Try EduNex ERP Demo</h2>
        <p className="mb-3 text-sm text-muted-foreground">Explore EduNex ERP using demo accounts for different user roles.</p>
        <ul className="grid grid-cols-1 gap-2 min-[380px]:grid-cols-2">
          {q.data.map((a) => {
            const Icon = ICONS[a.key] ?? Users;
            const selected = selectedKey === a.key;
            return (
              <li key={a.key}>
                <button
                  type="button"
                  disabled={!a.available}
                  aria-pressed={selected}
                  data-testid={`demo-${a.key}`}
                  onClick={() => onPick(a)}
                  className={cn(
                    'flex h-full min-h-11 w-full flex-col gap-1 rounded-lg border p-3 text-left text-sm transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary',
                    a.available ? 'border-input bg-card hover:bg-muted' : 'cursor-not-allowed border-dashed border-border bg-muted/40 text-muted-foreground',
                    selected && 'border-primary bg-primary/10 ring-1 ring-primary',
                  )}
                >
                  <span className="flex items-center gap-2 font-medium"><Icon className="h-4 w-4 shrink-0" aria-hidden /> {a.label}</span>
                  <span className="text-xs text-muted-foreground">{a.description}</span>
                  <span className={cn('mt-auto text-xs font-medium', a.available ? 'text-primary' : '')}>{a.available ? (selected ? 'Selected — now press Sign in' : 'Try Demo') : 'Demo account not configured yet.'}</span>
                </button>
              </li>
            );
          })}
        </ul>
        {selectedKey ? (
          <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
            <p role="status" className="text-sm text-success" data-testid="demo-loaded">Demo credentials loaded.</p>
            <Button type="button" size="sm" variant="ghost" onClick={onClear} data-testid="demo-clear">Clear demo credentials</Button>
          </div>
        ) : null}
      </Card>
    </section>
  );
}
