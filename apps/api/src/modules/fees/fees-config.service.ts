import type { Types } from 'mongoose';
import { defaultFeePolicy, isValidDay, type FeePolicy, type Scope } from '@edunex/shared';
import { conflict, forbidden, notFound, validationFailed } from '../../core/errors';
import { AuditService } from '../../core/audit/audit.service';
import { withTransaction } from '../../core/db/connection';
import { requireTenant } from '../../core/tenancy/context';
import { toObjectId } from '../../core/tenancy/repository';
import { classRepo, sessionRepo } from '../academics/academics.repository';
import { studentRepo } from '../students/students.repository';
import { getSchoolById } from '../schools/schools.service';
import { concessionRepo, feeCategoryRepo, feeStructureRepo, invoiceRepo } from './fees.repository';
import type { IStructureItem } from './fees.model';

export async function getFeePolicy(): Promise<FeePolicy> {
  const t = requireTenant('fees.policy');
  const school = await getSchoolById(t.schoolId);
  const stored = (school.settings as unknown as { feePolicy?: Partial<FeePolicy> }).feePolicy ?? {};
  const d = defaultFeePolicy(school.code);
  return { ...d, ...stored, concessionAutoApprove: { ...d.concessionAutoApprove, ...(stored.concessionAutoApprove ?? {}) } };
}

export interface StructureInput {
  sessionId: string;
  classId: string;
  name: string;
  items: Array<{ categoryId: string; installments: Array<{ label: string; dueDate: string; amountPaise: number }> }>;
}

async function validateItems(sessionId: Types.ObjectId, items: StructureInput['items']): Promise<IStructureItem[]> {
  if (items.length === 0) throw validationFailed('Add at least one fee head');
  const session = await sessionRepo.getById(sessionId, 'Session');
  const cats = await feeCategoryRepo.findByIds(items.map((i) => i.categoryId));
  const byId = new Map(cats.map((c) => [String(c._id), c]));
  const seen = new Set<string>();
  return items.map((it, idx) => {
    const cat = byId.get(it.categoryId);
    if (!cat) throw notFound('Fee category');
    if (!cat.active) throw validationFailed(`Fee category "${cat.name}" is inactive`);
    if (seen.has(it.categoryId)) throw validationFailed(`Fee category "${cat.name}" appears twice`);
    seen.add(it.categoryId);
    if (it.installments.length === 0) throw validationFailed(`"${cat.name}" needs at least one instalment`);
    const labels = new Set<string>();
    for (const ins of it.installments) {
      if (labels.has(ins.label)) throw validationFailed(`"${cat.name}": instalment "${ins.label}" appears twice`);
      labels.add(ins.label);
      if (!isValidDay(ins.dueDate)) throw validationFailed(`"${cat.name}" / ${ins.label}: invalid due date`);
      if (ins.dueDate < session.startDate || ins.dueDate > session.endDate) throw validationFailed(`"${cat.name}" / ${ins.label}: due date is outside the session`);
      if (!Number.isSafeInteger(ins.amountPaise) || ins.amountPaise < 0) throw validationFailed(`"${cat.name}" / ${ins.label}: invalid amount`, [{ path: `items.${idx}`, message: 'amount' }]);
    }
    const amountPaise = it.installments.reduce((a, b) => a + b.amountPaise, 0);
    if (amountPaise <= 0) throw validationFailed(`"${cat.name}" has a zero total`);
    return { categoryId: cat._id, amountPaise, installments: it.installments };
  });
}

export const FeeConfigService = {
  // ---------------------------------------------------------------- categories
  async createCategory(input: { key: string; name: string; kind: string; isRefundable?: boolean }) {
    if (await feeCategoryRepo.exists({ key: input.key.toLowerCase() })) throw conflict('A fee category with this key already exists');
    const c = await feeCategoryRepo.create({ ...input, key: input.key.toLowerCase(), isRefundable: Boolean(input.isRefundable), active: true });
    await AuditService.record({ action: 'fees.category_created', entityType: 'fee_category', entityId: c._id, after: input });
    return c;
  },

  async updateCategory(id: string, patch: { name?: string; isRefundable?: boolean; active?: boolean }) {
    const before = await feeCategoryRepo.getById(id, 'Fee category');
    const c = await feeCategoryRepo.updateById(id, patch, { what: 'Fee category' });
    await AuditService.record({ action: 'fees.category_updated', entityType: 'fee_category', entityId: id, before: { name: before.name, active: before.active, isRefundable: before.isRefundable }, after: patch });
    return c;
  },

  // ---------------------------------------------------------------- structures (versioned)
  async createStructure(input: StructureInput) {
    const session = await sessionRepo.getById(input.sessionId, 'Session');
    if (session.status === 'closed') throw conflict('The session is closed');
    const cls = await classRepo.getById(input.classId, 'Class');
    if (!cls.sessionId.equals(session._id)) throw validationFailed('Class does not belong to that session');
    const familyKey = `${session._id}:${cls._id}:${input.name.trim().toLowerCase()}`;
    if (await feeStructureRepo.exists({ familyKey })) throw conflict('A fee structure with this name already exists for the class — revise it instead');
    const items = await validateItems(session._id, input.items);
    const s = await feeStructureRepo.create({ sessionId: session._id, classId: cls._id, name: input.name.trim(), familyKey, version: 1, status: 'draft', items });
    await AuditService.record({ action: 'fees.structure_created', entityType: 'fee_structure', entityId: s._id, after: { name: s.name, classId: String(cls._id) } });
    return s;
  },

  async updateDraft(id: string, input: { name?: string; items?: StructureInput['items'] }) {
    const s = await feeStructureRepo.getById(id, 'Fee structure');
    if (s.status !== 'draft') throw conflict('Published fee structures cannot be changed — create a revision');
    const set: Record<string, unknown> = {};
    if (input.items) set.items = await validateItems(s.sessionId, input.items);
    if (input.name && input.name.trim() !== s.name) {
      if (s.version > 1) throw validationFailed('A revision keeps the name of the structure it revises');
      const familyKey = `${s.sessionId}:${s.classId}:${input.name.trim().toLowerCase()}`;
      if (await feeStructureRepo.exists({ familyKey, _id: { $ne: s._id } })) throw conflict('A fee structure with this name already exists for the class');
      set.name = input.name.trim();
      set.familyKey = familyKey;
    }
    const u = await feeStructureRepo.updateById(id, set, { what: 'Fee structure' });
    await AuditService.record({ action: 'fees.structure_updated', entityType: 'fee_structure', entityId: id, after: { name: u.name, items: u.items.length } });
    return u;
  },

  /** Publishing makes a version immutable and supersedes the previously published version of the same structure. */
  async publish(id: string) {
    const tenant = requireTenant('fees.publish');
    const s = await feeStructureRepo.getById(id, 'Fee structure');
    if (s.status !== 'draft') throw conflict('Only a draft can be published');
    const out = await withTransaction(async () => {
      const prev = await feeStructureRepo.findOne({ familyKey: s.familyKey, status: 'published' });
      if (prev) await feeStructureRepo.updateById(prev._id, { status: 'superseded' });
      return feeStructureRepo.updateById(id, { status: 'published', publishedAt: new Date(), publishedBy: tenant.membershipId });
    });
    await AuditService.record({ action: 'fees.structure_published', entityType: 'fee_structure', entityId: id, after: { familyKey: s.familyKey, version: s.version } });
    return out;
  },

  /** New draft version copied from a published one. Already-issued invoices keep their old amounts. */
  async revise(id: string) {
    const s = await feeStructureRepo.getById(id, 'Fee structure');
    if (s.status === 'draft') throw conflict('This is already a draft');
    if (await feeStructureRepo.exists({ familyKey: s.familyKey, status: 'draft' })) throw conflict('A draft revision already exists');
    const latest = await feeStructureRepo.find({ familyKey: s.familyKey }, { sort: { version: -1 }, limit: 1 });
    const d = await feeStructureRepo.create({ sessionId: s.sessionId, classId: s.classId, name: s.name, familyKey: s.familyKey, version: (latest[0]?.version ?? s.version) + 1, status: 'draft', items: s.items });
    await AuditService.record({ action: 'fees.structure_revised', entityType: 'fee_structure', entityId: d._id, after: { from: String(s._id), version: d.version } });
    return d;
  },

  async deleteDraft(id: string) {
    const s = await feeStructureRepo.getById(id, 'Fee structure');
    if (s.status !== 'draft') throw conflict('Only drafts can be deleted');
    if (await invoiceRepo.exists({ structureId: s._id })) throw conflict('Invoices exist for this structure');
    await feeStructureRepo.hardDeleteById(id, 'Fee structure');
    await AuditService.record({ action: 'fees.structure_draft_deleted', entityType: 'fee_structure', entityId: id });
  },

  // ---------------------------------------------------------------- concessions (D-07)
  async requestConcession(scope: Scope | undefined, canApprove: boolean, input: { studentId: string; kind: string; valueType: 'percent' | 'flat'; value: number; categoryId?: string | null; reason: string }) {
    const tenant = requireTenant('fees.concession');
    const student = await studentRepo.getById(input.studentId, 'Student');
    if (!student.currentEnrollmentId) throw validationFailed('The student is not enrolled in a class');
    const session = await sessionRepo.findActive();
    if (!session) throw conflict('No active academic session');
    if (input.categoryId) await feeCategoryRepo.getById(input.categoryId, 'Fee category');
    if (input.valueType === 'percent' && (input.value < 1 || input.value > 10_000)) throw validationFailed('Percentage must be between 0.01% and 100%');
    if (input.valueType === 'flat' && !Number.isSafeInteger(input.value)) throw validationFailed('Amount must be whole paise');
    const policy = await getFeePolicy();
    const withinLimit = input.valueType === 'percent' ? input.value <= policy.concessionAutoApprove.maxPercentBps : input.value <= policy.concessionAutoApprove.maxFlatPaise;
    const auto = canApprove || withinLimit;
    void scope;
    const c = await concessionRepo.create({
      studentId: student._id, sessionId: session._id, kind: input.kind, valueType: input.valueType, value: input.value,
      categoryId: input.categoryId ? toObjectId(input.categoryId) : null, reason: input.reason, status: auto ? 'approved' : 'pending_approval',
      requestedBy: tenant.membershipId, decidedBy: auto ? tenant.membershipId : null, decidedAt: auto ? new Date() : null,
    });
    await AuditService.record({ action: auto ? 'fees.concession_granted' : 'fees.concession_requested', entityType: 'concession', entityId: c._id, after: { studentId: input.studentId, valueType: input.valueType, value: input.value, withinLimit } });
    return c;
  },

  async decideConcession(id: string, approve: boolean, note?: string) {
    const tenant = requireTenant('fees.concession.decide');
    const c = await concessionRepo.getById(id, 'Concession');
    if (c.status !== 'pending_approval') throw conflict('This concession was already decided');
    if (c.requestedBy.equals(tenant.membershipId)) throw forbidden('You cannot approve your own concession request');
    const u = await concessionRepo.updateById(id, { status: approve ? 'approved' : 'rejected', decidedBy: tenant.membershipId, decidedAt: new Date() });
    await AuditService.record({ action: approve ? 'fees.concession_approved' : 'fees.concession_rejected', entityType: 'concession', entityId: id, after: { note } });
    return u;
  },

  /** Revoking affects only invoices generated afterwards; issued invoices are corrected with an adjustment. */
  async revokeConcession(id: string, reason: string) {
    const c = await concessionRepo.getById(id, 'Concession');
    if (c.status !== 'approved') throw conflict('Only an approved concession can be revoked');
    const u = await concessionRepo.updateById(id, { status: 'revoked' });
    await AuditService.record({ action: 'fees.concession_revoked', entityType: 'concession', entityId: id, after: { reason } });
    return u;
  },
};
