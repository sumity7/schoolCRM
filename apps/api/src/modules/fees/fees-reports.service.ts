import { Types } from 'mongoose';
import { isValidDay, todayInTz } from '@edunex/shared';
import { validationFailed } from '../../core/errors';
import { requireTenant } from '../../core/tenancy/context';
import { toObjectId } from '../../core/tenancy/repository';
import { classRepo, sectionRepo } from '../academics/academics.repository';
import { studentRepo } from '../students/students.repository';
import { getSchoolById } from '../schools/schools.service';
import { invoiceRepo, paymentRepo } from './fees.repository';

const daysBetween = (a: string, b: string) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);

export const FeeReports = {
  /** Collection register / day-book: money received in a date range (reversed payments listed, excluded from totals). */
  async collection(from: string, to: string) {
    if (!isValidDay(from) || !isValidDay(to) || from > to || daysBetween(from, to) > 400) throw validationFailed('Invalid date range (max 400 days)');
    const pays = await paymentRepo.find({ paidOn: { $gte: from, $lte: to } }, { sort: { paidOn: 1, receiptNo: 1 } });
    const students = await studentRepo.findByIds(pays.map((p) => p.studentId), { select: 'firstName lastName admissionNo' });
    const sBy = new Map(students.map((s) => [String(s._id), s]));
    const live = pays.filter((p) => p.status === 'recorded');
    const sum = <K extends string>(key: (p: (typeof live)[number]) => K) => {
      const m = new Map<K, number>();
      for (const p of live) m.set(key(p), (m.get(key(p)) ?? 0) + p.amountPaise);
      return [...m.entries()].map(([k, v]) => ({ key: k, amountPaise: v })).sort((a, b) => String(a.key).localeCompare(String(b.key)));
    };
    return {
      from, to,
      totalPaise: live.reduce((a, p) => a + p.amountPaise, 0),
      count: live.length,
      reversedCount: pays.length - live.length,
      byMode: sum((p) => p.mode),
      byDay: sum((p) => p.paidOn),
      byCashier: sum((p) => p.receivedByName),
      rows: pays.map((p) => {
        const s = sBy.get(String(p.studentId));
        return { id: String(p._id), receiptNo: p.receiptNo, paidOn: p.paidOn, student: s ? [s.firstName, s.lastName].filter(Boolean).join(' ') : '—', admissionNo: s?.admissionNo ?? '', amountPaise: p.amountPaise, mode: p.mode, reference: p.reference ?? '', receivedByName: p.receivedByName, status: p.status };
      }),
    };
  },

  /** Outstanding dues per student (non-void invoices with a balance), optionally for one class/section. */
  async outstanding(filter: { classId?: string; sectionId?: string }) {
    const tenant = requireTenant('fees.outstanding');
    const today = todayInTz((await getSchoolById(tenant.schoolId)).settings.timezone);
    const f: Record<string, unknown> = { status: { $in: ['open', 'partially_paid'] }, balancePaise: { $gt: 0 } };
    if (filter.classId) f.classId = toObjectId(filter.classId) ?? new Types.ObjectId();
    if (filter.sectionId) f.sectionId = toObjectId(filter.sectionId) ?? new Types.ObjectId();
    const invs = await invoiceRepo.find(f, { select: 'studentId classId sectionId balancePaise dueDate totalPaise paidPaise' });
    const by = new Map<string, { studentId: string; classId: string; sectionId: string; balancePaise: number; overduePaise: number; oldestDue: string; invoices: number }>();
    for (const i of invs) {
      const k = String(i.studentId);
      const r = by.get(k) ?? { studentId: k, classId: String(i.classId), sectionId: String(i.sectionId), balancePaise: 0, overduePaise: 0, oldestDue: i.dueDate, invoices: 0 };
      r.balancePaise += i.balancePaise;
      if (i.dueDate < today) r.overduePaise += i.balancePaise;
      if (i.dueDate < r.oldestDue) r.oldestDue = i.dueDate;
      r.invoices++;
      by.set(k, r);
    }
    const rows = [...by.values()];
    const [students, classes, sections] = await Promise.all([
      studentRepo.findByIds(rows.map((r) => r.studentId), { select: 'firstName lastName admissionNo' }),
      classRepo.findByIds([...new Set(rows.map((r) => r.classId))]),
      sectionRepo.findByIds([...new Set(rows.map((r) => r.sectionId))]),
    ]);
    const sBy = new Map(students.map((s) => [String(s._id), s]));
    const cBy = new Map(classes.map((c) => [String(c._id), c.name]));
    const secBy = new Map(sections.map((s) => [String(s._id), s.name]));
    return {
      asOf: today,
      totalPaise: rows.reduce((a, r) => a + r.balancePaise, 0),
      overduePaise: rows.reduce((a, r) => a + r.overduePaise, 0),
      students: rows.length,
      rows: rows
        .map((r) => {
          const s = sBy.get(r.studentId);
          return { ...r, name: s ? [s.firstName, s.lastName].filter(Boolean).join(' ') : '—', admissionNo: s?.admissionNo ?? '', className: `${cBy.get(r.classId) ?? ''} ${secBy.get(r.sectionId) ?? ''}`.trim() };
        })
        .sort((a, b) => b.overduePaise - a.overduePaise || b.balancePaise - a.balancePaise),
    };
  },
};
