import mongoose, { Types } from 'mongoose';
import { modelRegistry } from '../tenancy/registry';
import { AuditService } from '../audit/audit.service';
import { BackupError, verifyArchive } from './archive';
import { dumpCollections, restoreArchive, type CollectionSpec, type RestoreStats, type WriteStats } from './backup';

type Db = mongoose.mongo.Db;

/**
 * Per-school (tenant) data portability (doc 12 §7 "School data export", §9 item 7 "reversible hosting"):
 *  - export: every tenant collection filtered by schoolId + the school document, its audit trail and its members'
 *    user records WITHOUT credentials (no password hashes, MFA secrets or lockout state);
 *  - purge: irreversible removal of one school, allowed only for a DEACTIVATED school, with the school code typed
 *    again and a verified export of that same school in hand;
 *  - restore: loads an export into a database where that school does not exist (move between deployments, or undo a
 *    purge). Restored users must reset their password (credentials are never exported).
 * These are operator tools (CLI), not HTTP routes.
 */

/** Transient/security collections that are never exported: idempotency replays, sessions, one-time tokens. */
const NOT_EXPORTED = new Set(['IdempotencyKey']);
const USER_SECRET_FIELDS = { passwordHash: 0, mfa: 0, failedLogins: 0, lockedUntil: 0 } as const;

function collectionOf(model: string): string {
  const info = modelRegistry.get(model);
  if (!info) throw new BackupError(`Model ${model} is not loaded — build the app (createApp) before using tenant tools`);
  return info.collection;
}

function tenantCollections(): string[] {
  collectionOf('Student'); // asserts the module models are registered
  return [...modelRegistry.entries()].filter(([name, i]) => i.kind === 'tenant' && !NOT_EXPORTED.has(name) && !name.startsWith('Test')).map(([, i]) => i.collection).sort();
}

async function memberUserIds(db: Db, schoolId: Types.ObjectId): Promise<Types.ObjectId[]> {
  const rows = await db.collection(collectionOf('Membership')).find({ schoolId }, { projection: { userId: 1 } }).toArray();
  return [...new Map(rows.map((r) => [String(r.userId), r.userId as Types.ObjectId])).values()];
}

export async function findSchool(db: Db, code: string) {
  const s = await db.collection(collectionOf('School')).findOne({ code: code.toLowerCase() });
  if (!s) throw new BackupError(`No school with code "${code}"`);
  return s as mongoose.mongo.WithId<{ code: string; name: string; status: string }>;
}

function exportSpecs(schoolId: Types.ObjectId, userIds: Types.ObjectId[]): CollectionSpec[] {
  return [
    { name: collectionOf('School'), filter: { _id: schoolId } },
    ...tenantCollections().map((name) => ({ name, filter: { schoolId } })),
    { name: collectionOf('AuditLog'), filter: { schoolId } },
    { name: collectionOf('User'), filter: { _id: { $in: userIds } }, projection: USER_SECRET_FIELDS },
  ];
}

export async function exportSchool(db: Db, code: string, file: string, passphrase: string): Promise<WriteStats & { schoolId: string }> {
  const school = await findSchool(db, code);
  const userIds = await memberUserIds(db, school._id as Types.ObjectId);
  const stats = await dumpCollections(db, exportSpecs(school._id as Types.ObjectId, userIds), file, passphrase, {
    kind: 'tenant', schoolId: String(school._id), schoolCode: school.code, schoolName: school.name,
  });
  await AuditService.record({ action: 'platform.school_exported', entityType: 'school', entityId: school._id, schoolId: null, actorUserId: null, meta: { code: school.code, documents: stats.documents } });
  return { ...stats, schoolId: String(school._id) };
}

export interface PurgeResult { schoolId: string; deleted: Record<string, number> }

export async function purgeSchool(db: Db, opts: { code: string; confirmCode: string; exportFile: string; passphrase: string }): Promise<PurgeResult> {
  const school = await findSchool(db, opts.code);
  if (opts.confirmCode !== school.code) throw new BackupError('Confirmation code does not match the school code — nothing was deleted');
  if (school.status !== 'deactivated') throw new BackupError(`Only a deactivated school can be purged (status is "${school.status}") — nothing was deleted`);
  const archive = await verifyArchive(opts.exportFile, opts.passphrase); // the export must be readable with this passphrase
  if (archive.header.kind !== 'tenant' || archive.header.schoolId !== String(school._id)) {
    throw new BackupError('The export file is not an export of this school — nothing was deleted');
  }
  const schoolId = school._id as Types.ObjectId;
  const deleted: Record<string, number> = {};
  const del = async (name: string, filter: mongoose.mongo.Filter<mongoose.mongo.Document>) => {
    const r = await db.collection(name).deleteMany(filter);
    deleted[name] = (deleted[name] ?? 0) + r.deletedCount;
  };

  const memberships = await db.collection(collectionOf('Membership')).find({ schoolId }, { projection: { _id: 1, userId: 1 } }).toArray();
  const membershipIds = memberships.map((m) => m._id);
  const userIds = [...new Map(memberships.map((m) => [String(m.userId), m.userId as Types.ObjectId])).values()];

  // Access first: sessions pointing into the school and pending invites die before any data goes.
  await del(collectionOf('Session'), { activeMembershipId: { $in: membershipIds } });
  await del(collectionOf('AuthToken'), { membershipId: { $in: membershipIds } });
  for (const [name, info] of modelRegistry) if (info.kind === 'tenant' && !name.startsWith('Test')) await del(info.collection, { schoolId });
  await del(collectionOf('AuditLog'), { schoolId });

  // People who belonged ONLY to this school (and are not platform staff) are removed with it.
  const stillMember = new Set((await db.collection(collectionOf('Membership')).find({ userId: { $in: userIds } }, { projection: { userId: 1 } }).toArray()).map((m) => String(m.userId)));
  const orphans = userIds.filter((u) => !stillMember.has(String(u)));
  if (orphans.length) {
    await del(collectionOf('Session'), { userId: { $in: orphans } });
    await del(collectionOf('AuthToken'), { userId: { $in: orphans } });
    await del(collectionOf('User'), { _id: { $in: orphans }, platformRole: { $exists: false } });
  }
  await del(collectionOf('School'), { _id: schoolId });
  await AuditService.record({ action: 'platform.school_purged', entityType: 'school', entityId: schoolId, schoolId: null, actorUserId: null, meta: { code: school.code, deleted } });
  return { schoolId: String(schoolId), deleted };
}

export async function restoreSchool(db: Db, file: string, passphrase: string): Promise<RestoreStats & { schoolId: string; usersCreated: number; usersExisting: number }> {
  const archive = await verifyArchive(file, passphrase);
  if (archive.header.kind !== 'tenant') throw new BackupError('Not a school export');
  const schoolId = new Types.ObjectId(String(archive.header.schoolId));
  const schools = db.collection(collectionOf('School'));
  if (await schools.findOne({ $or: [{ _id: schoolId }, { code: archive.header.schoolCode }] })) {
    throw new BackupError(`School "${String(archive.header.schoolCode)}" (or its code) already exists here — purge it first or restore into another database`);
  }
  for (const name of tenantCollections()) {
    if (await db.collection(name).findOne({ schoolId })) throw new BackupError(`Leftover ${name} data for this school exists — refusing to merge`);
  }

  const usersColl = collectionOf('User');
  let usersCreated = 0;
  let usersExisting = 0;
  const stats = await restoreArchive(db, file, passphrase, {
    requireEmpty: false,
    expectKind: 'tenant',
    async skipDoc(collection, doc) {
      if (collection !== usersColl) return false;
      // A user may still exist (multi-school person, or restore into the same deployment): keep the live record.
      if (await db.collection(usersColl).findOne({ _id: doc._id })) { usersExisting++; return true; }
      const clash = await db.collection(usersColl).findOne({ $or: [doc.email ? { email: doc.email } : null, doc.phone ? { phone: doc.phone } : null].filter(Boolean) as never[] });
      if (clash) throw new BackupError(`User ${String(doc.email ?? doc.phone)} exists here under another id — resolve manually before restoring`);
      usersCreated++;
      doc.failedLogins = 0; // credentials were never exported: the person sets a new password via "Forgot password"
      return false;
    },
    verify(collection) {
      if (collection === usersColl) return null; // user records are merged, not copied 1:1
      if (collection === collectionOf('School')) return { name: collection, filter: { _id: schoolId } };
      return { name: collection, filter: { schoolId } };
    },
  });
  await AuditService.record({ action: 'platform.school_restored', entityType: 'school', entityId: schoolId, schoolId: null, actorUserId: null, meta: { code: archive.header.schoolCode, documents: stats.documents, usersCreated, usersExisting } });
  return { ...stats, schoolId: String(schoolId), usersCreated, usersExisting };
}
