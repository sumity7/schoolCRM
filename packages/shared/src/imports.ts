/**
 * Student import field catalogue — shared by the API (validation) and the web mapping screen.
 * The CSV EXPORT uses exactly these labels as headers, so an exported file re-imports without re-mapping.
 * R1 import is synchronous and capped (doc 15 §R1); D-24: commit valid rows, report rejected rows.
 */

export const IMPORT_MAX_ROWS = 2000;
/** Max size of the uploaded CSV text (characters). */
export const IMPORT_MAX_CHARS = 3_000_000;

export const IMPORT_DATE_FORMATS = ['DMY', 'YMD', 'MDY'] as const;
export type ImportDateFormat = (typeof IMPORT_DATE_FORMATS)[number];

export const IMPORT_BATCH_STATUSES = ['uploaded', 'validated', 'committing', 'committed', 'failed', 'rolled_back'] as const;
export type ImportBatchStatus = (typeof IMPORT_BATCH_STATUSES)[number];

export const IMPORT_ROW_STATUSES = ['ok', 'duplicate', 'error', 'created'] as const;
export type ImportRowStatus = (typeof IMPORT_ROW_STATUSES)[number];

export interface ImportFieldDef {
  key: string;
  label: string;
  /** Required unless an alternative (`orKey`) is mapped. */
  required?: boolean;
  orKey?: string;
  hint?: string;
  synonyms: string[];
}

export const STUDENT_IMPORT_FIELDS = [
  { key: 'admissionNo', label: 'Admission No', required: true, synonyms: ['admission no', 'admission number', 'adm no', 'admno', 'admission', 'sr no', 'scholar no', 'registration no', 'reg no'] },
  { key: 'firstName', label: 'First Name', required: true, orKey: 'fullName', synonyms: ['first name', 'firstname', 'given name', 'student first name'] },
  { key: 'lastName', label: 'Last Name', synonyms: ['last name', 'lastname', 'surname', 'family name', 'student last name'] },
  { key: 'fullName', label: 'Student Name', hint: 'Used when there are no separate first/last name columns', synonyms: ['student name', 'name', 'full name', 'name of student', 'student'] },
  { key: 'dob', label: 'Date of Birth', required: true, hint: 'Day/month/year order is chosen on the mapping screen', synonyms: ['date of birth', 'dob', 'birth date', 'birthdate', 'd.o.b', 'd o b'] },
  { key: 'gender', label: 'Gender', hint: 'M / F / O', synonyms: ['gender', 'sex'] },
  { key: 'className', label: 'Class', hint: 'Must match a class in the active session', synonyms: ['class', 'class name', 'grade', 'std', 'standard'] },
  { key: 'sectionName', label: 'Section', synonyms: ['section', 'sec', 'division', 'div'] },
  { key: 'rollNo', label: 'Roll No', synonyms: ['roll no', 'roll number', 'roll', 'rollno'] },
  { key: 'admissionDate', label: 'Admission Date', synonyms: ['admission date', 'date of admission', 'doa', 'joining date'] },
  { key: 'phone', label: 'Student Phone', synonyms: ['student phone', 'phone', 'mobile', 'contact', 'contact no', 'mobile no', 'phone no'] },
  { key: 'email', label: 'Student Email', synonyms: ['student email', 'email', 'e-mail', 'email id'] },
  { key: 'guardianName', label: 'Guardian Name', synonyms: ['guardian name', 'parent name', 'father name', "father's name", 'fathers name', 'mother name', "mother's name", 'guardian'] },
  { key: 'guardianRelationship', label: 'Guardian Relationship', hint: 'father / mother / guardian / other', synonyms: ['guardian relationship', 'relationship', 'relation', 'guardian relation'] },
  { key: 'guardianPhone', label: 'Guardian Phone', synonyms: ['guardian phone', 'parent phone', 'father phone', 'mother phone', 'parent mobile', 'guardian mobile', 'father mobile', 'parent contact'] },
  { key: 'guardianEmail', label: 'Guardian Email', synonyms: ['guardian email', 'parent email', 'father email', 'mother email'] },
  { key: 'addressLine1', label: 'Address', synonyms: ['address', 'address line 1', 'address1', 'residential address', 'street'] },
  { key: 'city', label: 'City', synonyms: ['city', 'town', 'village'] },
  { key: 'state', label: 'State', synonyms: ['state'] },
  { key: 'postalCode', label: 'PIN Code', synonyms: ['pin code', 'pincode', 'pin', 'postal code', 'zip', 'zip code'] },
] as const satisfies readonly ImportFieldDef[];

export type StudentImportFieldKey = (typeof STUDENT_IMPORT_FIELDS)[number]['key'];
export const STUDENT_IMPORT_FIELD_KEYS = STUDENT_IMPORT_FIELDS.map((f) => f.key) as StudentImportFieldKey[];

/** field key → 0-based column index (absent/null = not mapped). */
export type ImportMapping = Partial<Record<StudentImportFieldKey, number | null>>;

const normHeader = (h: string) => h.toLowerCase().replace(/[_\-.:/]+/g, ' ').replace(/\s+/g, ' ').trim();

/** Best-effort automatic mapping from header names. Exact label/synonym matches only — no fuzzy guessing. */
export function suggestStudentMapping(headers: string[]): ImportMapping {
  const out: ImportMapping = {};
  const used = new Set<number>();
  const norm = headers.map(normHeader);
  for (const f of STUDENT_IMPORT_FIELDS) {
    const candidates = [normHeader(f.label), ...f.synonyms.map(normHeader)];
    for (const c of candidates) {
      const idx = norm.findIndex((h, i) => h === c && !used.has(i));
      if (idx >= 0) {
        out[f.key] = idx;
        used.add(idx);
        break;
      }
    }
  }
  // "Name" alone maps to fullName only when there are no first/last columns.
  if (out.firstName !== undefined && out.fullName !== undefined && out.lastName === undefined) {
    // e.g. "First Name" + "Student Name" — keep firstName, drop the ambiguous one
    delete out.fullName;
  }
  return out;
}

/** Problems with a mapping that make validation pointless (missing required columns, duplicates, out of range). */
export function mappingProblems(mapping: ImportMapping, columnCount: number): string[] {
  const problems: string[] = [];
  const seen = new Map<number, string>();
  for (const [k, v] of Object.entries(mapping)) {
    if (v === null || v === undefined) continue;
    if (!Number.isInteger(v) || v < 0 || v >= columnCount) problems.push(`${k}: column ${v} does not exist`);
    else if (seen.has(v)) problems.push(`Column ${v + 1} is mapped to both ${seen.get(v)} and ${k}`);
    else seen.set(v, k);
  }
  const has = (k: StudentImportFieldKey) => mapping[k] !== undefined && mapping[k] !== null;
  for (const f of STUDENT_IMPORT_FIELDS as readonly ImportFieldDef[]) {
    if (!f.required) continue;
    if (has(f.key as StudentImportFieldKey)) continue;
    if (f.orKey && has(f.orKey as StudentImportFieldKey)) continue;
    problems.push(`Map a column to "${f.label}"${f.orKey ? ` (or "${STUDENT_IMPORT_FIELDS.find((x) => x.key === f.orKey)?.label}")` : ''}`);
  }
  if (has('sectionName') && !has('className')) problems.push('A "Section" column needs a "Class" column too');
  return problems;
}

/**
 * Parses a calendar date written in the given order (separators / - . or space) into YYYY-MM-DD.
 * ISO `YYYY-MM-DD` is always accepted. Two-digit years are rejected (ambiguous century).
 */
export function parseImportDate(raw: string, format: ImportDateFormat): string | null {
  const s = raw.trim();
  if (!s) return null;
  const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(s);
  let y: number, m: number, d: number;
  if (iso) {
    [y, m, d] = [Number(iso[1]), Number(iso[2]), Number(iso[3])];
  } else {
    const parts = s.split(/[/\-. ]+/);
    if (parts.length !== 3 || parts.some((p) => !/^\d+$/.test(p))) return null;
    const [a, b, c] = parts.map(Number) as [number, number, number];
    if (format === 'DMY') [d, m, y] = [a, b, c];
    else if (format === 'MDY') [m, d, y] = [a, b, c];
    else [y, m, d] = [a, b, c];
    const yearPart = format === 'YMD' ? parts[0]! : parts[2]!;
    if (yearPart.length !== 4) return null;
  }
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null;
  return `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}
