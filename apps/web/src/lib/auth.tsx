'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, type ReactNode } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { MeResponse, PermissionKey } from '@edunex/shared';
import { ApiError, get, post, setActiveMembershipHeader } from './api';

interface AuthState {
  me: MeResponse | null;
  loading: boolean;
  /** UX hint only — the server re-checks every request. */
  can: (key: PermissionKey) => boolean;
  refresh: () => Promise<void>;
  logout: () => Promise<void>;
}

const Ctx = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ['me'],
    queryFn: async () => {
      try {
        return (await get<MeResponse>('/auth/me')).data;
      } catch (e) {
        if (e instanceof ApiError && e.status === 401) return null;
        throw e;
      }
    },
    staleTime: 30_000,
    retry: false,
  });
  const me = q.data ?? null;

  // If another tab switched school (same session), a background refetch of /auth/me reveals it: reload at once so this
  // tab never keeps showing (or acting on) the previous school's data. The API's 409 TENANT_CONTEXT_CHANGED is the
  // server-side guarantee; this is the faster client-side path.
  const shownMembership = useRef<string | null>(null);
  useEffect(() => {
    const current = me?.activeMembershipId ?? null;
    if (shownMembership.current && current && current !== shownMembership.current) {
      window.location.reload();
      return;
    }
    if (current) shownMembership.current = current;
    setActiveMembershipHeader(current);
  }, [me?.activeMembershipId]);

  const refresh = useCallback(async () => {
    await qc.invalidateQueries({ queryKey: ['me'] });
  }, [qc]);

  const logout = useCallback(async () => {
    await post('/auth/logout').catch(() => undefined);
    setActiveMembershipHeader(null);
    qc.clear();
    window.location.assign('/login');
  }, [qc]);

  const value = useMemo<AuthState>(() => {
    const perms = new Set((me?.permissions ?? []).map((p) => p.key));
    return { me, loading: q.isLoading, can: (k) => perms.has(k), refresh, logout };
  }, [me, q.isLoading, refresh, logout]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAuth(): AuthState {
  const v = useContext(Ctx);
  if (!v) throw new Error('useAuth outside AuthProvider');
  return v;
}
