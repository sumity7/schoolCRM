import { createCipheriv, createDecipheriv, randomBytes, scrypt as scryptCb } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { open, rm, stat } from 'node:fs/promises';
import { createGunzip, createGzip } from 'node:zlib';
import { pipeline } from 'node:stream/promises';
import { PassThrough, Writable } from 'node:stream';

/**
 * EduNex backup archive (".edxbak"): encrypted, compressed NDJSON.
 *
 *   MAGIC "EDXBAK01" (8) | salt (16) | iv (12) | AES-256-GCM( gzip( NDJSON ) ) | GCM tag (16)
 *
 * Key = scrypt(passphrase, salt). Every line is one JSON object: a `header`, then per collection a `collection`
 * line (with index specs) followed by its `doc` lines (canonical Extended JSON, so types survive exactly), and a
 * final `footer` with per-collection counts and SHA-256 digests. GCM authenticates the whole file, so ANY tampering
 * or a wrong passphrase is detected; readers always verify fully before anything is written (see `verifyArchive`).
 * The format is open (EJSON lines) and can be decoded without EduNex code — documented in docs/build/BACKUP-RESTORE.md.
 */

const MAGIC = Buffer.from('EDXBAK01', 'ascii');
const SALT_LEN = 16;
const IV_LEN = 12;
const TAG_LEN = 16;
const HEADER_LEN = MAGIC.length + SALT_LEN + IV_LEN;
const SCRYPT = { N: 1 << 15, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };

export class BackupError extends Error {}

export type ArchiveLine =
  | { type: 'header'; [k: string]: unknown }
  | { type: 'collection'; name: string; indexes: Array<Record<string, unknown>> }
  | { type: 'doc'; c: string; d: unknown }
  | { type: 'footer'; counts: Record<string, number>; sha256: Record<string, string> };

export function assertPassphrase(p: string | undefined): string {
  if (!p || p.length < 16) throw new BackupError('BACKUP_PASSPHRASE must be set and at least 16 characters (backups are always encrypted)');
  return p;
}

function deriveKey(passphrase: string, salt: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => scryptCb(passphrase, salt, 32, SCRYPT, (err, key) => (err ? reject(err) : resolve(key))));
}

/** Writes an archive. `produce` receives a `write(line)` function and must emit header → collections/docs → footer. */
export async function writeArchive(file: string, passphrase: string, produce: (write: (line: ArchiveLine) => Promise<void>) => Promise<void>): Promise<void> {
  assertPassphrase(passphrase);
  const salt = randomBytes(SALT_LEN);
  const iv = randomBytes(IV_LEN);
  const key = await deriveKey(passphrase, salt);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  // Exclusive create BEFORE anything else: an existing file (e.g. an older backup) makes this throw and is never touched.
  const fh = await open(file, 'wx', 0o600);
  const out = fh.createWriteStream(); // owns the handle (closes it when the stream finishes or is destroyed)
  out.write(Buffer.concat([MAGIC, salt, iv]));

  const source = new PassThrough();
  const gzip = createGzip({ level: 6 });
  let failure: unknown = null;
  let rejectDone: (e: unknown) => void = () => undefined;
  // out stays open after the cipher ends: the GCM tag is appended last. Any stage error rejects instead of hanging.
  const cipherDone = new Promise<void>((resolve, reject) => { rejectDone = reject; cipher.once('end', () => resolve()); });
  for (const s of [source, gzip, cipher, out] as NodeJS.EventEmitter[]) s.on('error', (e: Error) => { failure ??= e; rejectDone(e); });
  source.pipe(gzip).pipe(cipher).pipe(out, { end: false });
  const write = async (line: ArchiveLine) => {
    if (failure) throw failure;
    if (!source.write(`${JSON.stringify(line)}\n`)) await new Promise((r) => source.once('drain', r));
  };
  cipherDone.catch(() => undefined); // observed below; avoids an unhandled rejection if produce() fails first
  try {
    try {
      await produce(write);
    } finally {
      source.end();
    }
    await cipherDone;
    if (failure) throw failure;
    await new Promise<void>((resolve, reject) => out.end(cipher.getAuthTag(), (e?: Error | null) => (e ? reject(e) : resolve())));
  } catch (err) {
    // A half-written backup must never be mistaken for a good one.
    out.destroy();
    await rm(file, { force: true }).catch(() => undefined);
    throw err;
  }
}

async function openForRead(file: string, passphrase: string) {
  assertPassphrase(passphrase);
  const { size } = await stat(file);
  if (size < HEADER_LEN + TAG_LEN) throw new BackupError('Not an EduNex backup (file too small)');
  const fh = await open(file, 'r');
  try {
    const head = Buffer.alloc(HEADER_LEN);
    await fh.read(head, 0, HEADER_LEN, 0);
    if (!head.subarray(0, MAGIC.length).equals(MAGIC)) throw new BackupError('Not an EduNex backup (bad magic)');
    const tag = Buffer.alloc(TAG_LEN);
    await fh.read(tag, 0, TAG_LEN, size - TAG_LEN);
    const salt = head.subarray(MAGIC.length, MAGIC.length + SALT_LEN);
    const iv = head.subarray(MAGIC.length + SALT_LEN);
    const key = await deriveKey(passphrase, salt);
    const decipher = createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(tag);
    return { size, decipher };
  } finally {
    await fh.close();
  }
}

/**
 * Streams the archive's lines to `onLine`. Authentication is only confirmed at the END of the stream, so callers that
 * write data must first run a full `verifyArchive` pass (restore does exactly that).
 */
export async function readArchive(file: string, passphrase: string, onLine: (line: ArchiveLine) => Promise<void> | void): Promise<void> {
  const { size, decipher } = await openForRead(file, passphrase);
  const raw = createReadStream(file, { start: HEADER_LEN, end: size - TAG_LEN - 1 });
  let pending = '';
  const handle = async (text: string) => {
    if (!text) return;
    let line: ArchiveLine;
    try {
      line = JSON.parse(text) as ArchiveLine;
    } catch {
      throw new BackupError('Backup content is corrupt (unparseable line)');
    }
    await onLine(line);
  };
  // pipeline() rejects (and tears everything down) on ANY stage error — including the GCM tag check at the end.
  const lines = new Writable({
    decodeStrings: false,
    write(chunk: Buffer | string, _enc, cb) {
      pending += typeof chunk === 'string' ? chunk : chunk.toString('utf8');
      const parts = pending.split('\n');
      pending = parts.pop() ?? '';
      (async () => { for (const p of parts) await handle(p); })().then(() => cb(), cb);
    },
    final(cb) {
      handle(pending).then(() => cb(), cb);
    },
  });
  try {
    await pipeline(raw, decipher, createGunzip(), lines);
  } catch (e) {
    if (e instanceof BackupError) throw e;
    const msg = String((e as Error)?.message ?? e);
    if (/authenticate|auth tag|unsupported state/i.test(msg)) throw new BackupError('Backup failed authentication: wrong passphrase or the file was modified/corrupted');
    throw new BackupError(`Backup could not be read (wrong passphrase or corrupted file): ${msg}`);
  }
}

export interface VerifiedArchive {
  header: Record<string, unknown>;
  footer: { counts: Record<string, number>; sha256: Record<string, string> };
  collections: Array<{ name: string; indexes: Array<Record<string, unknown>> }>;
}

/** Full decrypt + structural check WITHOUT writing anything: header first, footer last, doc counts match the footer. */
export async function verifyArchive(file: string, passphrase: string): Promise<VerifiedArchive> {
  let header: Record<string, unknown> | null = null;
  let footer: VerifiedArchive['footer'] | null = null;
  const collections: VerifiedArchive['collections'] = [];
  const counted: Record<string, number> = {};
  let first = true;
  await readArchive(file, passphrase, (line) => {
    if (first) {
      if (line.type !== 'header') throw new BackupError('Backup content is corrupt (missing header)');
      first = false;
    }
    if (footer) throw new BackupError('Backup content is corrupt (data after footer)');
    if (line.type === 'header') header = line;
    else if (line.type === 'collection') collections.push({ name: line.name, indexes: line.indexes });
    else if (line.type === 'doc') counted[line.c] = (counted[line.c] ?? 0) + 1;
    else if (line.type === 'footer') footer = { counts: line.counts, sha256: line.sha256 };
  });
  if (!header || !footer) throw new BackupError('Backup is incomplete (missing header or footer) — it was probably interrupted');
  const f = footer as VerifiedArchive['footer'];
  for (const c of collections) {
    if ((counted[c.name] ?? 0) !== (f.counts[c.name] ?? 0)) throw new BackupError(`Backup is inconsistent: ${c.name} has ${counted[c.name] ?? 0} documents, footer says ${f.counts[c.name]}`);
  }
  return { header, footer: f, collections };
}
