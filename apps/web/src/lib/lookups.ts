'use client';

import { useQuery } from '@tanstack/react-query';
import { get } from './api';
import { useAuth } from './auth';

export interface SectionRow { id: string; classId: string; className?: string; classOrder: number; name: string; capacity?: number; classTeacherId: string | null; strength: number; version: number }
export interface ClassRow { id: string; sessionId: string; name: string; order: number; stream?: string; version: number }
export interface SessionRow { id: string; name: string; startDate: string; endDate: string; status: 'draft' | 'active' | 'closed'; version: number }
export interface StaffRow { id: string; employeeId: string; name: string; phone?: string; email?: string; designation: string; department?: string; kind: 'teaching' | 'non_teaching'; joiningDate?: string; status: string; endDate?: string; version: number }
export interface SubjectRow { id: string; code: string; name: string; type: string; version: number }

/** Lookups are keyed by the active membership so a school switch never shows the previous school's data. */
export function useSections(opts: { mine?: boolean; enabled?: boolean } = {}) {
  const { me } = useAuth();
  return useQuery({
    queryKey: ['sections', me?.activeMembershipId, opts.mine ? 'mine' : 'all'],
    enabled: opts.enabled ?? true,
    queryFn: async () => (await get<SectionRow[]>(opts.mine ? '/sections?mine=true' : '/sections')).data,
  });
}
export function useClasses(enabled = true) {
  const { me } = useAuth();
  return useQuery({ queryKey: ['classes', me?.activeMembershipId], enabled, queryFn: async () => (await get<ClassRow[]>('/classes')).data });
}
export function useSessions(enabled = true) {
  const { me } = useAuth();
  return useQuery({ queryKey: ['sessions', me?.activeMembershipId], enabled, queryFn: async () => (await get<SessionRow[]>('/academics/sessions')).data });
}
export function useStaff(enabled = true) {
  const { me } = useAuth();
  return useQuery({ queryKey: ['staff-all', me?.activeMembershipId], enabled, queryFn: async () => (await get<StaffRow[]>('/staff?limit=100')).data });
}
export function useSubjects(enabled = true) {
  const { me } = useAuth();
  return useQuery({ queryKey: ['subjects', me?.activeMembershipId], enabled, queryFn: async () => (await get<SubjectRow[]>('/subjects')).data });
}

export const sectionLabel = (s: Pick<SectionRow, 'className' | 'name'>) => `${s.className ?? ''} ${s.name}`.trim();
export const sortSections = (rows: SectionRow[]) => [...rows].sort((a, b) => a.classOrder - b.classOrder || (a.className ?? '').localeCompare(b.className ?? '') || a.name.localeCompare(b.name));
