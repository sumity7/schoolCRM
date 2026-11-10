import { createHash } from 'node:crypto';
import { validationFailed } from '../errors';

/**
 * What may be uploaded. An ALLOW-list: the type is decided from the file's own bytes (magic numbers), never from the
 * client-supplied MIME type, and the extension must agree with it. Anything executable, scriptable or renderable by a
 * browser as active content (.exe .js .html .svg .sh …) is simply not on the list.
 */
interface Kind { mime: string; exts: string[]; matches: (b: Buffer) => boolean }

const startsWith = (b: Buffer, sig: number[]) => b.length >= sig.length && sig.every((x, i) => b[i] === x);
const isUtf8Text = (b: Buffer) => {
  if (b.includes(0)) return false; // NUL byte ⇒ binary
  try { new TextDecoder('utf-8', { fatal: true }).decode(b); return true; } catch { return false; }
};

const KINDS: Record<string, Kind> = {
  pdf: { mime: 'application/pdf', exts: ['pdf'], matches: (b) => startsWith(b, [0x25, 0x50, 0x44, 0x46, 0x2d]) },
  png: { mime: 'image/png', exts: ['png'], matches: (b) => startsWith(b, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]) },
  jpeg: { mime: 'image/jpeg', exts: ['jpg', 'jpeg'], matches: (b) => startsWith(b, [0xff, 0xd8, 0xff]) },
  // Office Open XML files are ZIP containers. Macro-enabled variants (docm/xlsm/pptm) are not allowed.
  docx: { mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', exts: ['docx'], matches: (b) => startsWith(b, [0x50, 0x4b, 0x03, 0x04]) },
  xlsx: { mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', exts: ['xlsx'], matches: (b) => startsWith(b, [0x50, 0x4b, 0x03, 0x04]) },
  pptx: { mime: 'application/vnd.openxmlformats-officedocument.presentationml.presentation', exts: ['pptx'], matches: (b) => startsWith(b, [0x50, 0x4b, 0x03, 0x04]) },
  txt: { mime: 'text/plain; charset=utf-8', exts: ['txt', 'csv'], matches: isUtf8Text },
};

export const ALLOWED_EXTENSIONS = Object.values(KINDS).flatMap((k) => k.exts);

export interface CheckedFile { name: string; ext: string; mime: string; size: number; sha256: string }

/** Display name only: no path parts, no control or markup characters, bounded length. Never used to build a storage path. */
export function safeDisplayName(raw: string): string {
  const base = raw.replace(/\\/g, '/').split('/').pop() ?? '';
  // eslint-disable-next-line no-control-regex
  const cleaned = base.replace(/[\u0000-\u001f\u007f<>:"|?*]/g, '').replace(/\s+/g, ' ').trim().replace(/^\.+/, '');
  return cleaned.slice(0, 100);
}

export function checkUpload(filename: string, data: Buffer, maxBytes: number): CheckedFile {
  if (data.length === 0) throw validationFailed('The file is empty');
  if (data.length > maxBytes) throw validationFailed(`The file is too large (limit ${Math.floor(maxBytes / (1024 * 1024))} MB)`);
  const name = safeDisplayName(filename);
  const dot = name.lastIndexOf('.');
  const ext = dot > 0 ? name.slice(dot + 1).toLowerCase() : '';
  const kind = Object.values(KINDS).find((k) => k.exts.includes(ext));
  if (!name || !kind) throw validationFailed(`This file type is not allowed. Allowed: ${[...new Set(ALLOWED_EXTENSIONS)].join(', ')}`);
  if (!kind.matches(data)) throw validationFailed('The file content does not match its extension');
  // a file whose name hides another extension before the real one (report.exe.pdf) is refused too
  const inner = name.slice(0, dot).split('.').pop()?.toLowerCase() ?? '';
  if (['exe', 'dll', 'bat', 'cmd', 'com', 'scr', 'msi', 'js', 'mjs', 'vbs', 'ps1', 'sh', 'jar', 'html', 'htm', 'svg', 'php', 'py'].includes(inner)) throw validationFailed('This file name is not allowed');
  return { name, ext, mime: kind.mime, size: data.length, sha256: createHash('sha256').update(data).digest('hex') };
}
