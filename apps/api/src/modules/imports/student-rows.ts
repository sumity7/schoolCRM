import type { Types } from 'mongoose';
import { parseImportDate, type ImportDateFormat, type ImportMapping, type ImportRowStatus, type StudentImportFieldKey } from '@edunex/shared';

/**
 * Pure row validation for student imports (no DB access: the service loads the context once per run).
 * Every rejected row gets at least one human-readable reason; no row is ever silently dropped.
 */

export interface SectionInfo { id: Types.ObjectId; classId: Types.ObjectId; name: string; capacity?: number; activeCount: number }
export interface ClassInfo { id: Types.ObjectId; name: string; sections: Map<string, SectionInfo>; ambiguous?: boolean }

export interface StudentRowContext {
  today: string;
  classes: Map<string, ClassInfo>;
  existingAdmissionNos: Set<string>;
  /** sectionId → roll numbers held by active enrolments */
  usedRollNos: Map<string, Set<number>>;
  /** How many more ACTIVE students the plan allows. */
  remainingStudentSlots: number;
}

export interface StudentRowValues {
  admissionNo: string;
  firstName: string;
  lastName?: string;
  dob: string;
  gender?: 'm' | 'f' | 'o' | 'undisclosed';
  admissionDate?: string;
  phone?: string;
  email?: string;
  section?: { classId: Types.ObjectId; sectionId: Types.ObjectId; rollNo?: number; className: string; sectionName: string };
  guardian?: { name: string; phone: string; email?: string; relationship: 'father' | 'mother' | 'guardian' | 'other' };
  address?: { line1?: string; city?: string; state?: string; postalCode?: string };
}

export interface StudentRowResult {
  line: number;
  status: Exclude<ImportRowStatus, 'created'>;
  messages: string[];
  values?: StudentRowValues;
}

export const normClassName = (s: string) =>
  s.toLowerCase().replace(/^(class|std\.?|standard|grade)\s*/i, '').replace(/(\d+)(st|nd|rd|th)\b/g, '$1').replace(/[\s\-_.]+/g, ' ').trim();
export const normSectionName = (s: string) => s.toLowerCase().replace(/[\s\-_.]+/g, ' ').trim();

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const normPhone = (s: string) => s.replace(/[\s\-().]/g, '');
const PHONE = /^\+?\d{7,15}$/;

function gender(raw: string): StudentRowValues['gender'] | null {
  const v = raw.trim().toLowerCase();
  if (['m', 'male', 'boy'].includes(v)) return 'm';
  if (['f', 'female', 'girl'].includes(v)) return 'f';
  if (['o', 'other', 'transgender', 't'].includes(v)) return 'o';
  if (['undisclosed', 'prefer not to say', 'na', 'n/a'].includes(v)) return 'undisclosed';
  return null;
}

function relationship(raw: string): NonNullable<StudentRowValues['guardian']>['relationship'] | null {
  const v = raw.trim().toLowerCase();
  if (!v) return 'guardian';
  if (['father', 'dad', 'papa'].includes(v)) return 'father';
  if (['mother', 'mom', 'mummy', 'mum'].includes(v)) return 'mother';
  if (['guardian', 'parent', 'local guardian'].includes(v)) return 'guardian';
  if (['other', 'grandfather', 'grandmother', 'uncle', 'aunt', 'brother', 'sister'].includes(v)) return 'other';
  return null;
}

export function validateStudentRows(rows: string[][], mapping: ImportMapping, dateFormat: ImportDateFormat, ctx: StudentRowContext): StudentRowResult[] {
  const get = (row: string[], k: StudentImportFieldKey) => {
    const idx = mapping[k];
    return idx === undefined || idx === null ? '' : (row[idx] ?? '').trim();
  };
  const seenAdmission = new Map<string, number>();
  const rollTaken = new Map<string, Set<number>>([...ctx.usedRollNos].map(([k, v]) => [k, new Set(v)]));
  const sectionLoad = new Map<string, number>();
  let accepted = 0;
  const out: StudentRowResult[] = [];

  rows.forEach((row, i) => {
    const line = i + 2;
    const errs: string[] = [];
    const admissionNo = get(row, 'admissionNo');
    let firstName = get(row, 'firstName');
    let lastName = get(row, 'lastName');
    if (!firstName && mapping.fullName !== undefined && mapping.fullName !== null) {
      const parts = get(row, 'fullName').split(/\s+/).filter(Boolean);
      firstName = parts[0] ?? '';
      if (!lastName) lastName = parts.slice(1).join(' ');
    }

    if (!admissionNo) errs.push('Admission No is empty');
    else if (admissionNo.length > 30) errs.push('Admission No is longer than 30 characters');
    if (!firstName) errs.push('Student name is empty');
    else if (firstName.length > 80) errs.push('First name is longer than 80 characters');
    if (lastName.length > 80) errs.push('Last name is longer than 80 characters');

    const dobRaw = get(row, 'dob');
    const dob = parseImportDate(dobRaw, dateFormat);
    if (!dobRaw) errs.push('Date of Birth is empty');
    else if (!dob) errs.push(`Date of Birth "${dobRaw}" is not a valid ${dateFormat} date (4-digit year)`);
    else if (dob >= ctx.today) errs.push('Date of Birth must be in the past');
    else if (dob < '1950-01-01') errs.push('Date of Birth is before 1950 — check the date order');

    const gRaw = get(row, 'gender');
    const g = gRaw ? gender(gRaw) : undefined;
    if (gRaw && !g) errs.push(`Gender "${gRaw}" is not recognised (use M, F or O)`);

    const adRaw = get(row, 'admissionDate');
    const admissionDate = adRaw ? parseImportDate(adRaw, dateFormat) : undefined;
    if (adRaw && !admissionDate) errs.push(`Admission Date "${adRaw}" is not a valid ${dateFormat} date`);
    else if (admissionDate && admissionDate > ctx.today) errs.push('Admission Date is in the future');

    const phoneRaw = get(row, 'phone');
    const phone = phoneRaw ? normPhone(phoneRaw) : undefined;
    if (phone && !PHONE.test(phone)) errs.push(`Student Phone "${phoneRaw}" is not a valid phone number`);
    const email = get(row, 'email') || undefined;
    if (email && (!EMAIL.test(email) || email.length > 254)) errs.push(`Student Email "${email}" is not valid`);

    // --- class / section / roll
    let section: StudentRowValues['section'];
    const className = get(row, 'className');
    const sectionName = get(row, 'sectionName');
    const rollRaw = get(row, 'rollNo');
    let rollNo: number | undefined;
    if (rollRaw) {
      if (!/^\d{1,3}$/.test(rollRaw) || Number(rollRaw) < 1) errs.push(`Roll No "${rollRaw}" must be a whole number from 1 to 999`);
      else rollNo = Number(rollRaw);
    }
    if (className) {
      const cls = ctx.classes.get(normClassName(className));
      if (!cls) errs.push(`Class "${className}" does not exist in the active session`);
      else if (cls.ambiguous) errs.push(`Class "${className}" matches more than one class (e.g. different streams) — rename the classes or the file`);
      else {
        let sec: SectionInfo | undefined;
        if (sectionName) {
          sec = cls.sections.get(normSectionName(sectionName));
          if (!sec) errs.push(`Section "${sectionName}" does not exist in ${cls.name}`);
        } else if (cls.sections.size === 1) {
          sec = [...cls.sections.values()][0];
        } else {
          errs.push(`Section is required for ${cls.name} (${[...cls.sections.values()].map((s) => s.name).join(', ') || 'no sections yet'})`);
        }
        if (sec) section = { classId: cls.id, sectionId: sec.id, rollNo, className: cls.name, sectionName: sec.name };
      }
    } else if (sectionName || rollRaw) {
      errs.push('Section / Roll No given without a Class');
    }

    // --- guardian
    let guardian: StudentRowValues['guardian'];
    const gName = get(row, 'guardianName');
    const gPhoneRaw = get(row, 'guardianPhone');
    const gEmail = get(row, 'guardianEmail') || undefined;
    const gRelRaw = get(row, 'guardianRelationship');
    if (gName || gPhoneRaw || gEmail) {
      const gPhone = normPhone(gPhoneRaw);
      const rel = relationship(gRelRaw);
      if (!gName) errs.push('Guardian Name is empty (a guardian phone/email was given)');
      else if (gName.length > 120) errs.push('Guardian Name is longer than 120 characters');
      if (!gPhoneRaw) errs.push('Guardian Phone is empty (a guardian name was given)');
      else if (!PHONE.test(gPhone)) errs.push(`Guardian Phone "${gPhoneRaw}" is not a valid phone number`);
      if (gEmail && !EMAIL.test(gEmail)) errs.push(`Guardian Email "${gEmail}" is not valid`);
      if (!rel) errs.push(`Guardian Relationship "${gRelRaw}" is not recognised (father / mother / guardian / other)`);
      if (gName && gPhoneRaw && rel) guardian = { name: gName, phone: gPhone, email: gEmail?.toLowerCase(), relationship: rel };
    }

    const address = { line1: get(row, 'addressLine1') || undefined, city: get(row, 'city') || undefined, state: get(row, 'state') || undefined, postalCode: get(row, 'postalCode') || undefined };
    if ((address.line1?.length ?? 0) > 200 || (address.city?.length ?? 0) > 80 || (address.state?.length ?? 0) > 80 || (address.postalCode?.length ?? 0) > 12) errs.push('Address field is too long');
    const hasAddress = Object.values(address).some(Boolean);

    // --- duplicates (only meaningful once the row itself is readable)
    if (admissionNo) {
      const first = seenAdmission.get(admissionNo);
      if (first !== undefined) errs.push(`Admission No ${admissionNo} is repeated (first on line ${first})`);
      else seenAdmission.set(admissionNo, line);
    }
    if (errs.length === 0 && ctx.existingAdmissionNos.has(admissionNo)) {
      out.push({ line, status: 'duplicate', messages: [`Admission No ${admissionNo} already exists — not imported`] });
      return;
    }

    // --- capacity checks consume shared budgets only for otherwise-valid rows
    if (errs.length === 0 && section) {
      const sid = String(section.sectionId);
      if (section.rollNo !== undefined) {
        const taken = rollTaken.get(sid) ?? new Set<number>();
        if (taken.has(section.rollNo)) errs.push(`Roll No ${section.rollNo} is already used in ${section.className} ${section.sectionName}`);
      }
      const secInfo = ctx.classes.get(normClassName(section.className))?.sections.get(normSectionName(section.sectionName));
      const load = (sectionLoad.get(sid) ?? secInfo?.activeCount ?? 0) + 1;
      if (secInfo?.capacity && load > secInfo.capacity) errs.push(`${section.className} ${section.sectionName} is full (capacity ${secInfo.capacity})`);
      if (errs.length === 0) {
        sectionLoad.set(sid, load);
        if (section.rollNo !== undefined) rollTaken.set(sid, new Set([...(rollTaken.get(sid) ?? []), section.rollNo]));
      }
    }
    if (errs.length === 0 && accepted >= ctx.remainingStudentSlots) errs.push('Student limit for your plan has been reached');

    if (errs.length) {
      out.push({ line, status: 'error', messages: errs });
      return;
    }
    accepted++;
    out.push({
      line, status: 'ok', messages: [],
      values: {
        admissionNo, firstName, lastName: lastName || undefined, dob: dob!, gender: g ?? undefined, admissionDate: admissionDate ?? undefined,
        phone, email: email?.toLowerCase(), section, guardian, address: hasAddress ? address : undefined,
      },
    });
  });
  return out;
}
