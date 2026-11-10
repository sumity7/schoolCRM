import { pdfText as t, renderPdf } from '../../core/pdf/pdf';

export interface ReportCardData {
  school: { name: string; address?: string };
  exam: { name: string; session: string };
  student: { name: string; admissionNo: string; className: string; rollNo?: number | null };
  subjects: Array<{ subject: string; max: number; obtained: number | null; status: string; grade: string | null; passed: boolean | null }>;
  totalObtained: number; totalMax: number; percentage: number | null; grade: string | null; resultStatus: string; rank: number | null;
  version: number; correction?: { reason: string; previousVersion: number } | null;
  bands: Array<{ minPct: number; grade: string }>;
}

const cell = (s: { obtained: number | null; status: string }) => (s.status === 'absent' ? 'AB' : s.status === 'exempt' ? 'EX' : s.obtained === null ? '—' : String(s.obtained));

export function renderReportCard(r: ReportCardData): Promise<Buffer> {
  return renderPdf({
    pageSize: 'A4',
    pageMargins: [36, 36, 36, 40],
    defaultStyle: { font: 'Latin', fontSize: 10 },
    info: { title: `Report card — ${r.student.name} — ${r.exam.name}`, producer: 'EduNex ERP' },
    footer: { text: 'Computer-generated report card. AB = absent, EX = exempt.', alignment: 'center', fontSize: 7, color: '#666', margin: [0, 10, 0, 0] },
    content: [
      t(r.school.name, { fontSize: 15, bold: true, alignment: 'center' }),
      ...(r.school.address ? [t(r.school.address, { alignment: 'center', color: '#444' })] : []),
      { text: `REPORT CARD — ${r.exam.name.toUpperCase()}`, alignment: 'center', bold: true, fontSize: 12, margin: [0, 10, 0, 2] },
      { text: `Session ${r.exam.session}`, alignment: 'center', color: '#444', margin: [0, 0, 0, 10] },
      {
        table: { widths: [70, '*', 60, 90], body: [
          [{ text: 'Student', bold: true }, t(r.student.name), { text: 'Adm. No.', bold: true }, t(r.student.admissionNo)],
          [{ text: 'Class', bold: true }, t(r.student.className), { text: 'Roll No.', bold: true }, r.student.rollNo ? String(r.student.rollNo) : '—'],
        ] },
        layout: 'noBorders', margin: [0, 0, 0, 10],
      },
      {
        table: {
          headerRows: 1, widths: ['*', 50, 60, 45, 50],
          body: [
            ['Subject', 'Max', 'Obtained', 'Grade', 'Result'].map((h) => ({ text: h, bold: true })),
            ...r.subjects.map((s) => [t(s.subject), String(s.max), cell(s), s.grade ?? '—', s.passed === null ? '—' : s.passed ? 'Pass' : { text: 'Fail', color: '#b91c1c' }]),
            [{ text: 'Total', bold: true }, { text: String(r.totalMax), bold: true }, { text: String(r.totalObtained), bold: true }, { text: r.grade ?? '—', bold: true }, ''],
          ],
        },
        layout: 'lightHorizontalLines',
      },
      {
        columns: [
          { text: [{ text: 'Percentage: ', bold: true }, r.percentage === null ? '—' : `${r.percentage.toFixed(2)}%`] },
          { text: [{ text: 'Result: ', bold: true }, r.resultStatus.toUpperCase()] },
          { text: [{ text: 'Rank in section: ', bold: true }, r.rank ? String(r.rank) : '—'] },
        ],
        margin: [0, 12, 0, 0],
      },
      ...(r.correction ? [t(`Corrected result (version ${r.version}; replaces version ${r.correction.previousVersion}). Reason: ${r.correction.reason}`, { bold: true, color: '#b45309', margin: [0, 8, 0, 0] })] : []),
      { text: `Grading: ${[...r.bands].sort((a, b) => b.minPct - a.minPct).map((b) => `${b.grade} ≥ ${b.minPct}%`).join(' · ')}`, fontSize: 8, color: '#555', margin: [0, 14, 0, 0] },
      { columns: [{ text: 'Class teacher: ____________________' }, { text: 'Principal: ____________________', alignment: 'right' }], margin: [0, 40, 0, 0] },
    ],
  });
}
