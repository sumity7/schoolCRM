import { join, resolve } from 'node:path';
import pdfmake from 'pdfmake';

/**
 * Shared PDF engine (ADR-6: pdfmake, approved after the Hindi spike 2026-11-10). pdfmake has no font fallback, so text
 * is split into script runs: Devanagari → Noto Sans Devanagari, everything else → Noto Sans. Fonts are vendored under
 * apps/api/assets/fonts (SIL OFL 1.1); FONTS_DIR overrides the location. No network access is ever allowed.
 */
const FONTS = resolve(process.env.FONTS_DIR ?? join(process.cwd(), 'assets', 'fonts'));
let configured = false;
export function configurePdf() {
  if (configured) return;
  pdfmake.setFonts({
    Latin: { normal: join(FONTS, 'NotoSans-Regular.ttf'), bold: join(FONTS, 'NotoSans-Bold.ttf') },
    Deva: { normal: join(FONTS, 'NotoSansDevanagari-Regular.ttf'), bold: join(FONTS, 'NotoSansDevanagari-Bold.ttf') },
  });
  pdfmake.setLocalAccessPolicy((p) => resolve(p).startsWith(FONTS));
  pdfmake.setUrlAccessPolicy(() => false);
  configured = true;
}

/** Devanagari, Devanagari Extended, Vedic Extensions, ZWNJ/ZWJ (conjunct control) and the rupee sign. */
function isDeva(ch: string): boolean {
  const c = ch.codePointAt(0)!;
  return (c >= 0x0900 && c <= 0x097f) || (c >= 0xa8e0 && c <= 0xa8ff) || (c >= 0x1cd0 && c <= 0x1cff) || c === 0x200c || c === 0x200d || c === 0x20b9;
}
export function scriptRuns(text: string, extra: Record<string, unknown> = {}) {
  const out: Array<{ text: string; font: string } & Record<string, unknown>> = [];
  for (const ch of text) {
    const prev = out[out.length - 1];
    const font = isDeva(ch) ? 'Deva' : /\s/.test(ch) && prev ? prev.font : 'Latin';
    if (prev && prev.font === font) prev.text += ch;
    else out.push({ text: ch, font, ...extra });
  }
  return out.length ? out : [{ text: '', font: 'Latin', ...extra }];
}

/** Text node with script runs. */
export const pdfText = (s: string, extra: Record<string, unknown> = {}) => ({ text: scriptRuns(s), ...extra });

export async function renderPdf(doc: Record<string, unknown>): Promise<Buffer> {
  configurePdf();
  return pdfmake.createPdf(doc as never).getBuffer();
}
