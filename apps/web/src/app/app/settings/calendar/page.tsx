'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Trash2 } from 'lucide-react';
import { del, errorText, get, post } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { Alert, Badge, Button, Card, Field, Input, PageHeader, Select, Skeleton, Table, Td, Th } from '@/components/ui/primitives';

interface EventRow { id: string; date: string; endDate?: string; type: 'holiday' | 'event' | 'exam' | 'ptm'; title: string }

export default function CalendarPage() {
  const { me, can } = useAuth();
  const qc = useQueryClient();
  const events = useQuery({ queryKey: ['events', me?.activeMembershipId], queryFn: async () => (await get<EventRow[]>('/academics/calendar/events')).data });
  const [f, setF] = useState({ date: '', endDate: '', type: 'holiday', title: '' });
  const add = useMutation({
    mutationFn: async () => post('/academics/calendar/events', { date: f.date, type: f.type, title: f.title.trim(), ...(f.endDate ? { endDate: f.endDate } : {}) }),
    onSuccess: async () => { setF({ date: '', endDate: '', type: 'holiday', title: '' }); await qc.invalidateQueries({ queryKey: ['events'] }); },
  });
  const remove = useMutation({ mutationFn: async (id: string) => del(`/academics/calendar/events/${id}`), onSuccess: () => qc.invalidateQueries({ queryKey: ['events'] }) });

  return (
    <div className="mx-auto max-w-4xl space-y-4">
      <PageHeader title="Holidays & events" description="Holidays block attendance marking for that day. Weekly off-days are set in School settings." />
      {can('academics:create') ? (
        <Card className="p-4">
          <form className="grid gap-3 sm:grid-cols-[1fr_1fr_140px]" onSubmit={(e) => { e.preventDefault(); add.mutate(); }}>
            <div className="sm:col-span-3"><Field label="Title" htmlFor="ev-title"><Input id="ev-title" required maxLength={120} placeholder="Diwali vacation" value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} /></Field></div>
            <Field label="From" htmlFor="ev-date"><Input id="ev-date" type="date" required value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} /></Field>
            <Field label="To (optional)" htmlFor="ev-end"><Input id="ev-end" type="date" min={f.date} value={f.endDate} onChange={(e) => setF({ ...f, endDate: e.target.value })} /></Field>
            <Field label="Type" htmlFor="ev-type">
              <Select id="ev-type" value={f.type} onChange={(e) => setF({ ...f, type: e.target.value })}>
                <option value="holiday">Holiday</option><option value="event">Event</option><option value="exam">Exam</option><option value="ptm">PTM</option>
              </Select>
            </Field>
            {add.error ? <div className="sm:col-span-3"><Alert>{errorText(add.error)}</Alert></div> : null}
            <div className="sm:col-span-3"><Button type="submit" disabled={add.isPending}>Add</Button></div>
          </form>
        </Card>
      ) : null}
      {remove.error ? <Alert>{errorText(remove.error)}</Alert> : null}
      {events.isLoading ? <Skeleton className="h-24" /> : null}
      {events.error ? <Alert>{errorText(events.error)}</Alert> : null}
      {events.data && events.data.length === 0 ? <Alert tone="info">Nothing on the calendar for the active session.</Alert> : null}
      {events.data && events.data.length > 0 ? (
        <Table minWidth={480}>
          <thead className="border-b border-border"><tr><Th>Date</Th><Th>Title</Th><Th>Type</Th><Th /></tr></thead>
          <tbody>
            {events.data.map((e) => (
              <tr key={e.id} className="border-b border-border last:border-0">
                <Td className="whitespace-nowrap">{e.date}{e.endDate && e.endDate !== e.date ? ` → ${e.endDate}` : ''}</Td>
                <Td className="font-medium">{e.title}</Td>
                <Td><Badge tone={e.type === 'holiday' ? 'warning' : 'muted'}>{e.type}</Badge></Td>
                <Td className="text-right">{can('academics:delete') ? <Button size="sm" variant="ghost" aria-label={`Delete ${e.title}`} onClick={() => { if (window.confirm(`Delete “${e.title}”?`)) remove.mutate(e.id); }}><Trash2 className="h-4 w-4" /></Button> : null}</Td>
              </tr>
            ))}
          </tbody>
        </Table>
      ) : null}
    </div>
  );
}
