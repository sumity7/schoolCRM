import { pdfText, renderPdf } from '../../core/pdf/pdf';
import { amountInWords, formatINR } from '@edunex/shared';

/**
 * Receipt PDF (ADR-6: pdfmake, approved after the Hindi spike 2026-11-10). pdfmake has no font fallback, so text is
 * split into script runs: Devanagari → Noto Sans Devanagari, everything else → Noto Sans. Fonts are vendored under
 * apps/api/assets/fonts (SIL OFL 1.1); FONTS_DIR overrides the location. No network access is ever allowed.
 */
const t = pdfText;
const ddmmyyyy = (d: string) => d.split('-').reverse().join('/');

export interface ReceiptData {
  school: { name: string; address?: string; phone?: string };
  receiptNo: string;
  paidOn: string;
  student: { name: string; admissionNo: string; className?: string };
  lines: Array<{ invoiceNo: string | null; description: string; amountPaise: number }>;
  amountPaise: number;
  mode: string;
  reference?: string | null;
  receivedByName: string;
  status: 'recorded' | 'reversed';
}

export async function renderReceipt(r: ReceiptData): Promise<Buffer> {
  const cancelled = r.status === 'reversed';
  const doc = {
    pageSize: 'A5',
    pageMargins: [28, 28, 28, 36],
    defaultStyle: { font: 'Latin', fontSize: 9 },
    info: { title: `Receipt ${r.receiptNo}`, producer: 'EduNex ERP' },
    watermark: cancelled ? { text: 'CANCELLED', color: '#b91c1c', opacity: 0.18, bold: true, font: 'Latin' } : undefined,
    footer: { text: 'Computer-generated receipt. Keep it for your records.', alignment: 'center', fontSize: 7, color: '#666', margin: [0, 10, 0, 0] },
    content: [
      t(r.school.name, { fontSize: 14, bold: true, alignment: 'center' }),
      ...(r.school.address ? [t(r.school.address, { alignment: 'center', color: '#444' })] : []),
      ...(r.school.phone ? [t(`Phone: ${r.school.phone}`, { alignment: 'center', color: '#444' })] : []),
      { text: cancelled ? 'FEE RECEIPT — CANCELLED' : 'FEE RECEIPT', alignment: 'center', bold: true, fontSize: 11, margin: [0, 10, 0, 8], color: cancelled ? '#b91c1c' : '#111' },
      {
        table: {
          widths: [70, '*', 50, 70],
          body: [
            [{ text: 'Receipt No.', bold: true }, r.receiptNo, { text: 'Date', bold: true }, ddmmyyyy(r.paidOn)],
            [{ text: 'Student', bold: true }, t(r.student.name), { text: 'Adm. No.', bold: true }, t(r.student.admissionNo)],
            [{ text: 'Class', bold: true }, t(r.student.className ?? '—'), { text: 'Mode', bold: true }, r.mode.replace('_', ' ').toUpperCase()],
            ...(r.reference ? [[{ text: 'Reference', bold: true }, { text: r.reference, colSpan: 3 }, {}, {}]] : []),
          ],
        },
        layout: 'noBorders',
        margin: [0, 0, 0, 10],
      },
      {
        table: {
          headerRows: 1,
          widths: [90, '*', 70],
          body: [
            [{ text: 'Invoice', bold: true }, { text: 'Particulars', bold: true }, { text: 'Amount', bold: true, alignment: 'right' }],
            ...r.lines.map((l) => [l.invoiceNo ?? '—', t(l.description), { text: formatINR(l.amountPaise), alignment: 'right' }]),
            [{ text: 'Total received', bold: true, colSpan: 2 }, {}, { text: formatINR(r.amountPaise), bold: true, alignment: 'right' }],
          ],
        },
        layout: 'lightHorizontalLines',
      },
      { text: amountInWords(r.amountPaise), margin: [0, 8, 0, 0] },
      { columns: [{ text: '' }, { stack: [t(`Received by: ${r.receivedByName}`), { text: 'Signature: ____________________', margin: [0, 14, 0, 0] }], width: 'auto' }], margin: [0, 18, 0, 0] },
    ],
  };
  return renderPdf(doc);
}
