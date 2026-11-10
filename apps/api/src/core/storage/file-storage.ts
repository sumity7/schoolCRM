import { randomBytes } from 'node:crypto';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve, sep } from 'node:path';
import type { Env } from '../../config/env';

/**
 * Storage provider abstraction. Callers deal in opaque keys and Buffers; where the bytes live is the provider's business,
 * so an object-store provider (S3-compatible, etc.) can be added later without touching any module. The only provider
 * shipped is local disk — nothing paid is configured, and nothing here is reachable by URL: files are only ever served
 * through an authorised API route.
 */
export interface FileStorage {
  put(key: string, data: Buffer): Promise<void>;
  get(key: string): Promise<Buffer>;
  remove(key: string): Promise<void>;
}

/** `<schoolId>/<32 hex>` — generated here, never derived from anything a user typed. */
const KEY = /^[a-f0-9]{24}\/[a-f0-9]{32}$/;
export const newStorageKey = (schoolId: string): string => `${schoolId}/${randomBytes(16).toString('hex')}`;

export class LocalDiskStorage implements FileStorage {
  private readonly root: string;
  constructor(root: string) { this.root = resolve(root); }
  private pathFor(key: string): string {
    if (!KEY.test(key)) throw new Error('Invalid storage key');
    const p = resolve(this.root, key);
    if (!p.startsWith(this.root + sep)) throw new Error('Invalid storage key'); // defence in depth against traversal
    return p;
  }
  async put(key: string, data: Buffer): Promise<void> {
    const p = this.pathFor(key);
    await mkdir(dirname(p), { recursive: true });
    await writeFile(p, data, { flag: 'wx', mode: 0o600 }); // 'wx': never overwrite an existing object
  }
  async get(key: string): Promise<Buffer> { return readFile(this.pathFor(key)); }
  async remove(key: string): Promise<void> { await rm(this.pathFor(key), { force: true }); }
}

/** In-memory provider for unit tests of code that takes a FileStorage. */
export class MemoryStorage implements FileStorage {
  readonly objects = new Map<string, Buffer>();
  async put(key: string, data: Buffer) { if (!KEY.test(key)) throw new Error('Invalid storage key'); this.objects.set(key, Buffer.from(data)); }
  async get(key: string) { const b = this.objects.get(key); if (!b) throw new Error('Not found'); return b; }
  async remove(key: string) { this.objects.delete(key); }
}

export function createStorage(env: Pick<Env, 'UPLOAD_DIR' | 'NODE_ENV'>): FileStorage {
  const dir = env.UPLOAD_DIR ?? (env.NODE_ENV === 'test' ? join(tmpdir(), 'edunex-test-uploads') : join(process.cwd(), '.data', 'uploads'));
  return new LocalDiskStorage(dir);
}
