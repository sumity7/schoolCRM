'use client';

import Link from 'next/link';
import { Badge, Card } from '@/components/ui/primitives';
import { dueText, stateTone, type Homework } from '@/lib/homework';

/** One card per homework item. `href` is omitted where the viewer cannot open a detail page (parents). */
export function HomeworkCards({ items, hrefBase, empty = 'No homework yet.' }: { items: Homework[]; hrefBase?: string; empty?: string }) {
  if (items.length === 0) return <p className="text-sm text-muted-foreground" data-testid="homework-empty">{empty}</p>;
  return (
    <ul className="space-y-2" data-testid="homework-list">
      {items.map((h) => {
        const body = (
          <Card className="space-y-1 p-3 hover:bg-muted/40" data-testid={`hw-${h.id}`}>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="font-medium">{h.title}</span>
              {h.state ? <Badge tone={stateTone(h.state)}>{h.state}</Badge> : h.status === 'withdrawn' ? <Badge>withdrawn</Badge> : null}
            </div>
            <p className="text-sm text-muted-foreground">{h.subject} · {h.sectionName ? `Section ${h.sectionName} · ` : ''}due {dueText(h.dueAt)}{h.maxMarks != null ? ` · ${h.maxMarks} marks` : ''}</p>
            {h.mine?.status === 'reviewed' ? <p className="text-sm">{h.mine.marks != null ? `Marks: ${h.mine.marks}${h.maxMarks != null ? ` / ${h.maxMarks}` : ''}` : 'Reviewed'}{h.mine.feedback ? ` · “${h.mine.feedback}”` : ''}</p> : null}
          </Card>
        );
        return <li key={h.id}>{hrefBase ? <Link href={`${hrefBase}/${h.id}`} className="block">{body}</Link> : body}</li>;
      })}
    </ul>
  );
}
