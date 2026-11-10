import { createHash } from 'node:crypto';
import mongoose from 'mongoose';
import { BackupError, verifyArchive, readArchive, writeArchive, type VerifiedArchive } from './archive';

type Db = mongoose.mongo.Db;
type Doc = mongoose.mongo.Document;
const { EJSON } = mongoose.mongo.BSON;

export const BACKUP_FORMAT = 1;
const BATCH = 500;

/** Canonical Extended JSON keeps every BSON type exact (ObjectId, Date, Int32 vs Double, Decimal128 …). */
export const canonical = (doc: Doc) => EJSON.stringify(doc, { relaxed: false });

export interface CollectionSpec {
  name: string;
  filter?: Doc;
  projection?: Doc;
}

export interface WriteStats { collections: number; documents: number; counts: Record<string, number>; sha256: Record<string, string>; ms: number }

/**
 * Writes the given collections (optionally filtered — used by the per-school export) into an encrypted archive.
 * Reads use a snapshot session when the server supports it so the backup is point-in-time consistent across
 * collections; the header records whether that was the case.
 */
export async function dumpCollections(db: Db, specs: CollectionSpec[], file: string, passphrase: string, header: Record<string, unknown>): Promise<WriteStats> {
  const started = Date.now();
  const counts: Record<string, number> = {};
  const sha256: Record<string, string> = {};
  let session: mongoose.mongo.ClientSession | undefined;
  try {
    session = db.client.startSession({ snapshot: true });
  } catch {
    session = undefined;
  }
  try {
    await writeArchive(file, passphrase, async (write) => {
      await write({ type: 'header', format: BACKUP_FORMAT, createdAt: new Date().toISOString(), dbName: db.databaseName, snapshot: Boolean(session), ...header });
      for (const spec of specs) {
        const coll = db.collection(spec.name);
        const indexes = (await coll.indexes()).map((i) => EJSON.serialize(i, { relaxed: false }) as Record<string, unknown>);
        await write({ type: 'collection', name: spec.name, indexes });
        const h = createHash('sha256');
        let n = 0;
        const cursor = coll.find(spec.filter ?? {}, { sort: { _id: 1 }, projection: spec.projection, session });
        for await (const doc of cursor) {
          const s = canonical(doc);
          h.update(s).update('\n');
          await write({ type: 'doc', c: spec.name, d: JSON.parse(s) });
          n++;
        }
        counts[spec.name] = n;
        sha256[spec.name] = h.digest('hex');
      }
      await write({ type: 'footer', counts, sha256 });
    });
  } finally {
    await session?.endSession().catch(() => undefined);
  }
  return { collections: specs.length, documents: Object.values(counts).reduce((a, b) => a + b, 0), counts, sha256, ms: Date.now() - started };
}

/** Whole-database logical backup (every non-system collection). */
export async function backupDatabase(db: Db, file: string, passphrase: string, meta: Record<string, unknown> = {}): Promise<WriteStats> {
  const names = (await db.listCollections({}, { nameOnly: true }).toArray()).map((c) => c.name).filter((n) => !n.startsWith('system.')).sort();
  return dumpCollections(db, names.map((name) => ({ name })), file, passphrase, { kind: 'database', ...meta });
}

/** SHA-256 of a collection (or a filtered/projected slice) computed exactly as the backup writer does. */
export async function digestCollection(db: Db, spec: CollectionSpec): Promise<{ count: number; sha256: string }> {
  const h = createHash('sha256');
  let count = 0;
  for await (const doc of db.collection(spec.name).find(spec.filter ?? {}, { sort: { _id: 1 }, projection: spec.projection })) {
    h.update(canonical(doc)).update('\n');
    count++;
  }
  return { count, sha256: h.digest('hex') };
}

export interface RestoreStats { collections: number; documents: number; ms: number; verified: boolean; archive: VerifiedArchive }

/**
 * Restores an archive into `target`. Safety rules:
 *  1. the WHOLE file is decrypted and checked first (wrong passphrase / tampering → nothing is written);
 *  2. by default the target must be empty (no accidental overwrite of live data);
 *  3. after loading, every collection's digest is recomputed from the database and compared with the archive footer.
 * `transformDoc` lets the tenant restore skip/adjust documents (e.g. users that already exist).
 */
export async function restoreArchive(
  target: Db,
  file: string,
  passphrase: string,
  opts: {
    requireEmpty?: boolean;
    expectKind?: string;
    skipDoc?: (collection: string, doc: Doc) => Promise<boolean> | boolean;
    verify?: (collection: string) => CollectionSpec | null;
  } = {},
): Promise<RestoreStats> {
  const started = Date.now();
  const archive = await verifyArchive(file, passphrase);
  if (opts.expectKind && archive.header.kind !== opts.expectKind) throw new BackupError(`Expected a ${opts.expectKind} archive, got "${String(archive.header.kind)}"`);
  if (archive.header.format !== BACKUP_FORMAT) throw new BackupError(`Unsupported backup format ${String(archive.header.format)}`);

  if (opts.requireEmpty ?? true) {
    for (const c of await target.listCollections({}, { nameOnly: true }).toArray()) {
      if (c.name.startsWith('system.')) continue;
      if ((await target.collection(c.name).estimatedDocumentCount()) > 0) {
        throw new BackupError(`Refusing to restore into "${target.databaseName}": collection ${c.name} is not empty. Restore into a new, empty database.`);
      }
    }
  }

  const existing = new Set((await target.listCollections({}, { nameOnly: true }).toArray()).map((c) => c.name));
  const buffers = new Map<string, Doc[]>();
  let documents = 0;
  const flush = async (name: string) => {
    const buf = buffers.get(name);
    if (!buf?.length) return;
    await target.collection(name).insertMany(buf, { ordered: true });
    documents += buf.length;
    buffers.set(name, []);
  };
  await readArchive(file, passphrase, async (line) => {
    if (line.type === 'collection') {
      if (!existing.has(line.name)) {
        await target.createCollection(line.name).catch(() => undefined);
        existing.add(line.name);
      }
      buffers.set(line.name, []);
    } else if (line.type === 'doc') {
      const doc = EJSON.deserialize(line.d as Doc, { relaxed: false }) as Doc;
      if (opts.skipDoc && (await opts.skipDoc(line.c, doc))) return;
      const buf = buffers.get(line.c)!;
      buf.push(doc);
      if (buf.length >= BATCH) await flush(line.c);
    }
  });
  for (const name of buffers.keys()) await flush(name);

  // Indexes after data (faster, and unique indexes double-check the data).
  for (const c of archive.collections) {
    const specs = c.indexes
      .map((raw) => EJSON.deserialize(raw, { relaxed: false }) as Doc)
      .filter((i) => i.name !== '_id_')
      .map(({ v: _v, ns: _ns, key, ...rest }) => ({ key, ...rest }));
    if (specs.length) await target.collection(c.name).createIndexes(specs as never);
  }

  for (const c of archive.collections) {
    const spec = opts.verify ? opts.verify(c.name) : { name: c.name };
    if (!spec) continue;
    const d = await digestCollection(target, spec);
    if (d.sha256 !== archive.footer.sha256[c.name] || d.count !== archive.footer.counts[c.name]) {
      throw new BackupError(`Verification failed for ${c.name}: restored ${d.count} documents, digest differs from the backup`);
    }
  }
  return { collections: archive.collections.length, documents, ms: Date.now() - started, verified: true, archive };
}

export interface DrillReport {
  ok: boolean;
  file: string;
  backupCreatedAt: string;
  drillAt: string;
  /** Age of the backup at drill time = worst-case data loss if it had to be used now (RPO actually achieved). */
  backupAgeHours: number;
  /** Time to decrypt, verify, load, index and re-verify (the data part of RTO). */
  restoreMs: number;
  collections: number;
  documents: number;
  checks: Array<{ name: string; ok: boolean; detail: string }>;
  scratchDb: string;
}

/**
 * Restore drill ("a backup counts only after a restore has been demonstrated", doc 12 §7): restores into a throw-away
 * database on the same server, verifies digests, runs application-level sanity checks, drops the scratch database.
 */
export async function restoreDrill(client: mongoose.mongo.MongoClient, file: string, passphrase: string): Promise<DrillReport> {
  const scratchDb = `restore_drill_${Date.now()}`;
  const db = client.db(scratchDb);
  const checks: DrillReport['checks'] = [];
  try {
    const r = await restoreArchive(db, file, passphrase, { requireEmpty: true, expectKind: 'database' });
    checks.push({ name: 'digests', ok: r.verified, detail: `${r.collections} collections, ${r.documents} documents match the backup footer` });
    const schools = await db.collection('schools').find({}, { projection: { code: 1 } }).toArray();
    checks.push({ name: 'schools readable', ok: true, detail: `${schools.length} schools` });
    if (existsIn(r.archive, 'attendancerecords')) {
      const dup = await db.collection('attendancerecords').aggregate([{ $group: { _id: { s: '$schoolId', st: '$studentId', d: '$date' }, n: { $sum: 1 } } }, { $match: { n: { $gt: 1 } } }, { $count: 'n' }]).toArray();
      checks.push({ name: 'attendance unique per student-day', ok: dup.length === 0, detail: dup.length ? `${(dup[0] as { n: number }).n} duplicates` : 'no duplicates' });
    }
    if (existsIn(r.archive, 'students')) {
      const orphan = await db.collection('students').countDocuments({ schoolId: { $nin: schools.map((s) => s._id) } });
      checks.push({ name: 'every student belongs to a school', ok: orphan === 0, detail: `${orphan} orphans` });
    }
    const created = new Date(String(r.archive.header.createdAt));
    return {
      ok: checks.every((c) => c.ok), file, backupCreatedAt: created.toISOString(), drillAt: new Date().toISOString(),
      backupAgeHours: Math.round(((Date.now() - created.getTime()) / 3_600_000) * 100) / 100,
      restoreMs: r.ms, collections: r.collections, documents: r.documents, checks, scratchDb,
    };
  } finally {
    await db.dropDatabase().catch(() => undefined);
  }
}

const existsIn = (a: VerifiedArchive, name: string) => a.collections.some((c) => c.name === name);

// ------------------------------------------------------------------------------------------------ retention
export const backupFileName = (d: Date = new Date()) => `edunex-${d.toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z')}.edxbak`;

export function parseBackupDate(name: string): Date | null {
  const m = /^edunex-(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z\.edxbak$/.exec(name);
  if (!m) return null;
  return new Date(Date.UTC(+m[1]!, +m[2]! - 1, +m[3]!, +m[4]!, +m[5]!, +m[6]!));
}

/**
 * Grandfather-father-son retention (doc 12 §7): newest backup of each of the last `daily` days, of each of the last
 * `weekly` ISO weeks and of each of the last `monthly` months is kept. Unknown files are never touched.
 */
export function planRetention(names: string[], now: Date, policy = { daily: 7, weekly: 4, monthly: 6 }): { keep: string[]; remove: string[] } {
  const dated = names.map((n) => ({ n, d: parseBackupDate(n) })).filter((x): x is { n: string; d: Date } => x.d !== null && x.d <= now).sort((a, b) => b.d.getTime() - a.d.getTime());
  const keep = new Set<string>();
  const pick = (bucketOf: (d: Date) => string, limit: number) => {
    const seen = new Set<string>();
    for (const x of dated) {
      const b = bucketOf(x.d);
      if (seen.has(b)) continue;
      if (seen.size >= limit) break;
      seen.add(b);
      keep.add(x.n);
    }
  };
  const day = (d: Date) => d.toISOString().slice(0, 10);
  const week = (d: Date) => {
    const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
    const wd = t.getUTCDay() || 7;
    t.setUTCDate(t.getUTCDate() + 4 - wd);
    const y0 = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
    return `${t.getUTCFullYear()}-W${Math.ceil(((t.getTime() - y0.getTime()) / 86_400_000 + 1) / 7)}`;
  };
  const month = (d: Date) => d.toISOString().slice(0, 7);
  pick(day, policy.daily);
  pick(week, policy.weekly);
  pick(month, policy.monthly);
  return { keep: dated.filter((x) => keep.has(x.n)).map((x) => x.n), remove: dated.filter((x) => !keep.has(x.n)).map((x) => x.n) };
}
