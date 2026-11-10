'use client';

import { cn } from '@/lib/utils';
import { DAY_NAMES, type Lesson, type TimetableView } from '@/lib/timetable';

type Props = {
  data: Pick<TimetableView, 'periods' | 'workingDays' | 'lessons'>;
  /** what to print under the subject: the teacher (class view) or the class (teacher view) */
  show: 'teacher' | 'section';
  /** editors: make every lesson cell a button */
  onCell?: (day: number, periodNo: number, lesson: Lesson | undefined) => void;
  testId?: string;
};

function CellBody({ l, show }: { l: Lesson | undefined; show: 'teacher' | 'section' }) {
  if (!l) return <span className="text-muted-foreground">—</span>;
  return (
    <span className="block text-left">
      <span className="block font-medium">{l.subject}</span>
      <span className="block text-xs text-muted-foreground">{show === 'teacher' ? l.teacher : l.section}{l.room ? ` · ${l.room}` : ''}</span>
    </span>
  );
}

/**
 * Weekly timetable. Wide screens (and print) get a real table; phones get one card per day so nothing scrolls sideways.
 * Cells are plain text for readers and buttons for editors.
 */
export function TimetableGrid({ data, show, onCell, testId = 'timetable-grid' }: Props) {
  const byKey = new Map(data.lessons.map((l) => [`${l.day}:${l.periodNo}`, l]));
  const cell = (day: number, no: number, kind: 'lesson' | 'break') => {
    if (kind === 'break') return <span className="text-xs uppercase tracking-wide text-muted-foreground">Break</span>;
    const l = byKey.get(`${day}:${no}`);
    return onCell ? (
      <button type="button" onClick={() => onCell(day, no, l)} data-testid={`cell-${day}-${no}`} className={cn('min-h-11 w-full rounded-md border border-dashed border-input px-2 py-1 text-left text-sm hover:bg-muted', l && 'border-solid bg-primary/5')}>
        <CellBody l={l} show={show} />
      </button>
    ) : (
      <span data-testid={`cell-${day}-${no}`}><CellBody l={l} show={show} /></span>
    );
  };

  if (data.periods.length === 0 || data.workingDays.length === 0) return null;
  return (
    <div data-testid={testId}>
      <div className="hidden overflow-x-auto md:block print:block">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr>
              <th className="border border-border bg-muted p-2 text-left">Day</th>
              {data.periods.map((p) => (
                <th key={p.no} className="border border-border bg-muted p-2 text-left font-medium">{p.label}<span className="block text-xs font-normal text-muted-foreground">{p.start}–{p.end}</span></th>
              ))}
            </tr>
          </thead>
          <tbody>
            {data.workingDays.map((d) => (
              <tr key={d}>
                <th scope="row" className="border border-border bg-muted/50 p-2 text-left font-medium">{DAY_NAMES[d]}</th>
                {data.periods.map((p) => (
                  <td key={p.no} className={cn('border border-border p-1.5 align-top', p.kind === 'break' && 'bg-muted/40')}>{cell(d, p.no, p.kind)}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="space-y-3 md:hidden print:hidden">
        {data.workingDays.map((d) => (
          <section key={d} aria-label={DAY_NAMES[d]} className="rounded-xl border border-border">
            <h3 className="border-b border-border bg-muted px-3 py-2 text-sm font-semibold">{DAY_NAMES[d]}</h3>
            <ul className="divide-y divide-border">
              {data.periods.map((p) => (
                <li key={p.no} className="flex items-start gap-3 px-3 py-2 text-sm">
                  <span className="w-20 shrink-0 text-xs text-muted-foreground">{p.start}–{p.end}<span className="block">{p.label}</span></span>
                  <span className="min-w-0 flex-1">{cell(d, p.no, p.kind)}</span>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </div>
  );
}
