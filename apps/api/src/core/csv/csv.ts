import type { Response } from 'express';

/**
 * Minimal RFC 4180 CSV reader/writer (no dependency: the SheetJS npm package has a licensing/advisory history, doc 04).
 *  - Reader: BOM, quoted fields with "" escapes, newlines inside quotes, CRLF/LF/CR, delimiter auto-detected (, ; tab).
 *  - Writer: every cell is FORMULA-INJECTION SANITISED (threat T16) and quoted when needed; UTF-8 BOM so Excel shows
 *    Hindi/regional names correctly.
 */

export interface ParsedCsv {
  headers: string[];
  rows: string[][];
  delimiter: string;
}

function detectDelimiter(text: string): string {
  const firstLine: string[] = [];
  let inQ = false;
  for (const ch of text) {
    if (ch === '"') inQ = !inQ;
    if (!inQ && (ch === '\n' || ch === '\r')) break;
    firstLine.push(ch);
  }
  const line = firstLine.join('');
  const count = (d: string) => {
    let n = 0;
    let q = false;
    for (const ch of line) {
      if (ch === '"') q = !q;
      else if (!q && ch === d) n++;
    }
    return n;
  };
  const candidates = [',', ';', '\t'].map((d) => ({ d, n: count(d) })).sort((a, b) => b.n - a.n);
  return candidates[0]!.n > 0 ? candidates[0]!.d : ',';
}

export class CsvParseError extends Error {}

export function parseCsv(input: string, opts: { maxRows?: number } = {}): ParsedCsv {
  const text = input.charCodeAt(0) === 0xfeff ? input.slice(1) : input;
  const delimiter = detectDelimiter(text);
  const records: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  let i = 0;
  const pushRow = () => {
    row.push(field);
    field = '';
    // skip completely blank lines
    if (!(row.length === 1 && row[0]!.trim() === '')) records.push(row);
    row = [];
    if (opts.maxRows !== undefined && records.length > opts.maxRows + 1) throw new CsvParseError(`The file has more than ${opts.maxRows} rows`);
  };
  while (i < text.length) {
    const ch = text[i]!;
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') { field += '"'; i += 2; continue; }
        inQuotes = false; i++; continue;
      }
      field += ch; i++; continue;
    }
    if (ch === '"' && field.trim() === '') { field = ''; inQuotes = true; i++; continue; }
    if (ch === delimiter) { row.push(field); field = ''; i++; continue; }
    if (ch === '\r' || ch === '\n') {
      pushRow();
      i += ch === '\r' && text[i + 1] === '\n' ? 2 : 1;
      continue;
    }
    field += ch; i++;
  }
  if (inQuotes) throw new CsvParseError('The file has an unclosed quote (") — check the last rows');
  if (field !== '' || row.length > 0) pushRow();
  if (records.length === 0) throw new CsvParseError('The file is empty');
  const headers = records[0]!.map((h) => h.trim());
  if (headers.every((h) => h === '')) throw new CsvParseError('The first row must contain column headings');
  const width = headers.length;
  const rows = records.slice(1).map((r) => {
    const out = r.map((c) => c.trim());
    while (out.length < width) out.push('');
    return out;
  });
  return { headers, rows, delimiter };
}

const FORMULA_START = /^[=+\-@\t\r]/;

/** Neutralises spreadsheet formula injection: cells starting with = + - @ TAB CR are prefixed with a quote. */
export function sanitizeCell(value: unknown): string {
  if (value === null || value === undefined) return '';
  const s = value instanceof Date ? value.toISOString() : String(value);
  return FORMULA_START.test(s) ? `'${s}` : s;
}

function quote(s: string): string {
  return /[",\r\n;\t]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(headers: string[], rows: unknown[][]): string {
  const lines = [headers, ...rows].map((r) => r.map((c) => quote(sanitizeCell(c))).join(','));
  return `${String.fromCharCode(0xfeff)}${lines.join('\r\n')}\r\n`;
}

/** Sends a CSV download. Filenames are restricted to a safe charset (no header injection). */
export function sendCsv(res: Response, filename: string, headers: string[], rows: unknown[][]): void {
  const safe = filename.replace(/[^A-Za-z0-9._-]+/g, '_').slice(0, 100) || 'export.csv';
  res.status(200);
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${safe}"`);
  res.send(toCsv(headers, rows));
}
