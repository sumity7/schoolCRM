import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import fc from 'fast-check';
import { Types } from 'mongoose';
import { addDays, allocateOldestFirst, amountInWords, financialYear, formatINR, parseRupees, percentOf } from '@edunex/shared';
import { setupTestDb, teardownTestDb, clearAll } from './helpers/db';
import { loggedIn, makeTestApp, seedMember, type Client } from './helpers/app';
import { buildFeeData, buildSchoolData, todayIst, type SchoolData } from './helpers/fixtures';
import { runAsPlatform } from '../src/core/tenancy/context';
import { InvoiceModel, LedgerEntryModel, PaymentModel } from '../src/modules/fees/fees.model';
import { _auditRowsForTest } from '../src/core/audit/audit.service';

// ------------------------------------------------------------------------------------------------ pure money rules
describe('REQ-FEE-001 money arithmetic (paise only)', () => {
  it('formats Indian grouping, parses rupee input, rounds percentages half-up', () => {
    expect(formatINR(123456750)).toBe('₹12,34,567.50');
    expect(formatINR(5)).toBe('₹0.05');
    expect(formatINR(-100000)).toBe('-₹1,000.00');
    expect(parseRupees('12,500.5')).toBe(1_250_050);
    expect(parseRupees('₹ 300')).toBe(30_000);
    expect(parseRupees('1.234')).toBeNull();
    expect(parseRupees('-5')).toBeNull();
    expect(percentOf(10_001, 5_000)).toBe(5_001); // 50% of ₹100.01 = 50.005 → 50.01 (half-up)
    expect(percentOf(333, 1_000)).toBe(33);
    expect(() => percentOf(100, 10_001)).toThrow();
  });
  it('amount in words uses lakh/crore and paise', () => {
    expect(amountInWords(1_250_000)).toBe('Rupees Twelve Thousand Five Hundred Only');
    expect(amountInWords(10_000_000)).toBe('Rupees One Lakh Only');
    expect(amountInWords(1_234_567_850)).toBe('Rupees One Crore Twenty Three Lakh Forty Five Thousand Six Hundred Seventy Eight and Fifty Paise Only');
    expect(amountInWords(0)).toBe('Rupees Zero Only');
  });
  it('financial year runs April–March', () => {
    expect(financialYear('2026-04-01')).toBe('2026-27');
    expect(financialYear('2027-03-31')).toBe('2026-27');
    expect(financialYear('2027-01-15')).toBe('2026-27');
    expect(financialYear('2099-12-31')).toBe('2099-00');
  });
  it('PROPERTY: oldest-first allocation never over-allocates and always sums to the payment', () => {
    fc.assert(fc.property(
      fc.array(fc.record({ id: fc.uuid(), dueDate: fc.integer({ min: 0, max: 365 }).map((d) => addDays('2026-04-01', d)), balancePaise: fc.integer({ min: 0, max: 5_000_000 }) }), { maxLength: 12 }),
      fc.integer({ min: 1, max: 20_000_000 }),
      (dues, amount) => {
        const r = allocateOldestFirst(dues, amount);
        const sum = r.allocations.reduce((a, x) => a + x.amountPaise, 0);
        expect(sum + r.remainderPaise).toBe(amount);
        expect(r.remainderPaise).toBeGreaterThanOrEqual(0);
        for (const a of r.allocations) {
          const d = dues.find((x) => x.id === a.id)!;
          expect(a.amountPaise).toBeGreaterThan(0);
          expect(a.amountPaise).toBeLessThanOrEqual(d.balancePaise);
        }
        // nothing is left as remainder while some due still has a balance
        const totalDue = dues.reduce((a, d) => a + d.balancePaise, 0);
        expect(r.remainderPaise).toBe(Math.max(0, amount - totalDue));
        // oldest first: an allocated due is never newer than an unpaid-in-full due
        const fullyPaid = new Set(r.allocations.filter((a) => a.amountPaise === dues.find((d) => d.id === a.id)!.balancePaise).map((a) => a.id));
        const partial = dues.filter((d) => d.balancePaise > 0 && !fullyPaid.has(d.id));
        for (const a of r.allocations) for (const p of partial) if (p.id !== a.id) expect(dues.find((d) => d.id === a.id)!.dueDate <= p.dueDate || fullyPaid.has(a.id) === false).toBe(true);
      },
    ), { numRuns: 300 });
  });
});

// ------------------------------------------------------------------------------------------------ API
const t = makeTestApp();
const { app } = t;
let A: SchoolData;
let acc: Client;
let owner2: Client;
const today = todayIst();
let k = 0;
const key = () => `fee-test-${Date.now()}-${k++}`;

beforeAll(setupTestDb);
afterAll(teardownTestDb);
beforeEach(async () => {
  await clearAll();
  A = await buildSchoolData(app, 'alpha', { students: 3 });
  await seedMember(A.school.schoolId, 'acc@alpha.test', ['accountant']);
  await seedMember(A.school.schoolId, 'owner2@alpha.test', ['owner'], { personType: 'owner' });
  acc = await loggedIn(app, 'acc@alpha.test');
  owner2 = await loggedIn(app, 'owner2@alpha.test');
});

async function setupStructure(c: Client = A.owner) {
  const cat = await c.post('/fees/categories', { key: 'tuition', name: 'Tuition Fee', kind: 'tuition' });
  const bus = await c.post('/fees/categories', { key: 'transport', name: 'Transport', kind: 'transport' });
  const st = await A.owner.post('/fees/structures', {
    sessionId: A.sessionId, classId: A.classId, name: 'Standard',
    items: [
      { categoryId: cat.body.data.id, installments: [{ label: 'Q1', dueDate: addDays(today, -30), amountPaise: 500_000 }, { label: 'Q2', dueDate: addDays(today, 60), amountPaise: 500_000 }] },
      { categoryId: bus.body.data.id, installments: [{ label: 'Q1', dueDate: addDays(today, -30), amountPaise: 100_000 }, { label: 'Q2', dueDate: addDays(today, 60), amountPaise: 100_000 }] },
    ],
  });
  expect(st.status, JSON.stringify(st.body)).toBe(201);
  expect((await A.owner.post(`/fees/structures/${st.body.data.id}/publish`)).status).toBe(200);
  return { tuition: cat.body.data.id as string, transport: bus.body.data.id as string, structureId: st.body.data.id as string };
}
const generate = (structureId: string, label: string, extra: object = {}, c: Client = acc, kk = key()) => c.post('/fees/invoices/generate', { structureId, installmentLabel: label, sectionId: A.sectionA, ...extra }, { 'Idempotency-Key': kk });
const pay = (studentId: string, amountPaise: number, extra: object = {}, c: Client = acc, kk = key()) => c.post('/fees/payments', { studentId, amountPaise, mode: 'cash', paidOn: today, ...extra }, { 'Idempotency-Key': kk });
const invoicesOf = async (studentId: string) => (await acc.get(`/fees/invoices?studentId=${studentId}`)).body.data as Array<{ id: string; invoiceNo: string; installmentLabel: string; totalPaise: number; paidPaise: number; balancePaise: number; status: string; concessionLines: Array<{ amountPaise: number }> }>;

/** THE financial invariant: every invoice's cached balance equals the sum of its ledger rows. */
async function assertLedgerInvariant() {
  await runAsPlatform('test: ledger invariant', async () => {
    const invs = await InvoiceModel.find({ schoolId: A.school.schoolId }).lean();
    for (const inv of invs) {
      const rows = await LedgerEntryModel.find({ schoolId: A.school.schoolId, invoiceId: inv._id }).lean();
      const sum = rows.reduce((a, r) => a + r.amountPaise, 0);
      expect(inv.balancePaise, `invoice ${inv.invoiceNo}`).toBe(sum);
      expect(inv.totalPaise - inv.paidPaise).toBe(inv.balancePaise);
      expect(inv.balancePaise).toBeGreaterThanOrEqual(0);
    }
    // payments: unallocated credit == −Σ ledger rows without invoice for that payment
    const pays = await PaymentModel.find({ schoolId: A.school.schoolId }).lean();
    for (const p of pays) {
      const rows = await LedgerEntryModel.find({ schoolId: A.school.schoolId, paymentId: p._id, invoiceId: null }).lean();
      expect(p.unallocatedPaise + rows.reduce((a, r) => a + r.amountPaise, 0), `payment ${p.receiptNo}`).toBe(0);
    }
  });
}

describe('REQ-FEE-010 fee setup', () => {
  it('structures validate instalments, publish once (owner only), are immutable, and revise into a new version', async () => {
    const cat = await A.owner.post('/fees/categories', { key: 'tuition', name: 'Tuition', kind: 'tuition' });
    expect((await A.owner.post('/fees/categories', { key: 'TUITION', name: 'Dup', kind: 'tuition' })).status).toBe(409);
    const bad = await A.owner.post('/fees/structures', { sessionId: A.sessionId, classId: A.classId, name: 'S', items: [{ categoryId: cat.body.data.id, installments: [{ label: 'Q1', dueDate: '2200-01-01', amountPaise: 100 }] }] });
    expect(bad.status).toBe(400); // outside the session
    expect((await A.owner.post('/fees/structures', { sessionId: A.sessionId, classId: A.classId, name: 'S', items: [{ categoryId: cat.body.data.id, installments: [{ label: 'Q1', dueDate: today, amountPaise: 1.5 }] }] })).status).toBe(400); // paise only
    const s = await acc.post('/fees/structures', { sessionId: A.sessionId, classId: A.classId, name: 'S', items: [{ categoryId: cat.body.data.id, installments: [{ label: 'Q1', dueDate: today, amountPaise: 100_000 }] }] });
    expect(s.status).toBe(201);
    expect(s.body.data).toMatchObject({ version: 1, status: 'draft', totalPaise: 100_000 });
    expect((await acc.post(`/fees/structures/${s.body.data.id}/publish`)).status).toBe(403); // accountant cannot publish
    expect((await A.owner.post(`/fees/structures/${s.body.data.id}/publish`)).status).toBe(200);
    expect((await acc.patch(`/fees/structures/${s.body.data.id}`, { name: 'changed' })).status).toBe(409); // immutable
    const v2 = await acc.post(`/fees/structures/${s.body.data.id}/revise`);
    expect(v2.body.data).toMatchObject({ version: 2, status: 'draft' });
    expect((await acc.post(`/fees/structures/${s.body.data.id}/revise`)).status).toBe(409); // one draft at a time
    expect((await A.owner.post(`/fees/structures/${v2.body.data.id}/publish`)).status).toBe(200);
    const all = (await acc.get('/fees/structures')).body.data as Array<{ version: number; status: string }>;
    expect(all.map((x) => `${x.version}:${x.status}`).sort()).toEqual(['1:superseded', '2:published']);
  });

  it('teachers and admins (no financial:view) cannot reach any fee route', async () => {
    await seedMember(A.school.schoolId, 'ada@alpha.test', ['admin']);
    const ada = await loggedIn(app, 'ada@alpha.test');
    for (const c of [A.teacher, ada]) {
      expect((await c.get('/fees/categories')).status).toBe(403);
      expect((await c.get('/fees/invoices')).status).toBe(403);
      expect((await c.post('/fees/payments', { studentId: A.studentsA[0], amountPaise: 100, mode: 'cash', paidOn: today }, { 'Idempotency-Key': key() })).status).toBe(403);
    }
  });
});

describe('REQ-FEE-020 invoices & concessions', () => {
  it('generation bills each active student once; re-runs (same or new key) never double-bill', async () => {
    const { structureId } = await setupStructure();
    const kk = key();
    const r1 = await generate(structureId, 'Q1', {}, acc, kk);
    expect(r1.body.data).toMatchObject({ created: 3, skipped: 0, totalBilledPaise: 3 * 600_000 });
    expect((await generate(structureId, 'Q1', {}, acc, kk)).body.data.created).toBe(3); // replayed response, nothing new
    expect((await generate(structureId, 'Q1')).body.data).toMatchObject({ created: 0, skipped: 3 });
    const all = (await acc.get('/fees/invoices?limit=100')).body.data as Array<{ invoiceNo: string }>;
    expect(all).toHaveLength(3);
    expect(new Set(all.map((i) => i.invoiceNo)).size).toBe(3);
    expect(all[0]!.invoiceNo).toMatch(new RegExp(`^INV/${financialYear(today)}/\\d{6}$`));
    expect((await generate(structureId, 'Q9')).status).toBe(400);
    expect((await acc.post('/fees/invoices/generate', { structureId, installmentLabel: 'Q1' })).status).toBe(400); // Idempotency-Key required
    await assertLedgerInvariant();
  });

  it('D-07: concessions within the limit apply at once; above it they wait for an owner, who cannot be the requester', async () => {
    const { structureId, tuition } = await setupStructure();
    const small = await acc.post('/fees/concessions', { studentId: A.studentsA[0], kind: 'sibling', valueType: 'percent', value: 500, categoryId: tuition, reason: 'second child' });
    expect(small.body.data.status).toBe('approved');
    const big = await acc.post('/fees/concessions', { studentId: A.studentsA[1], kind: 'scholarship', valueType: 'percent', value: 5_000, reason: 'merit scholarship' });
    expect(big.body.data.status).toBe('pending_approval');
    expect((await acc.post(`/fees/concessions/${big.body.data.id}/approve`)).status).toBe(403); // no discounts:approve
    expect((await A.owner.post(`/fees/concessions/${big.body.data.id}/approve`, { note: 'ok' })).status).toBe(200);
    expect((await A.owner.post(`/fees/concessions/${big.body.data.id}/approve`)).status).toBe(409);
    await generate(structureId, 'Q1');
    const [i0] = await invoicesOf(A.studentsA[0]!);
    const [i1] = await invoicesOf(A.studentsA[1]!);
    expect(i0!.concessionLines[0]!.amountPaise).toBe(25_000); // 5% of tuition ₹5,000 only
    expect(i0!.totalPaise).toBe(575_000);
    expect(i1!.totalPaise).toBe(300_000); // 50% of ₹6,000
    await assertLedgerInvariant();
  });

  it('void needs no payments; a voided instalment can be billed again; late fee and adjustments keep the invariant', async () => {
    const { structureId } = await setupStructure();
    await generate(structureId, 'Q1');
    const [inv] = await invoicesOf(A.studentsA[0]!);
    expect((await acc.post(`/fees/invoices/${inv!.id}/void`, { reason: 'wrong class' })).status).toBe(403); // owner only
    expect((await A.owner.post(`/fees/invoices/${inv!.id}/void`, { reason: 'wrong class' })).status).toBe(200);
    expect((await generate(structureId, 'Q1', { studentIds: [A.studentsA[0]] })).body.data.created).toBe(1);
    const live = (await invoicesOf(A.studentsA[0]!)).find((i) => i.status !== 'void')!;
    expect((await acc.post(`/fees/invoices/${live.id}/late-fee`, { amountPaise: 5_000, reason: 'paid late' })).body.data.totalPaise).toBe(605_000);
    expect((await A.owner.post(`/fees/invoices/${live.id}/adjust`, { amountPaise: -700_000, reason: 'too much' })).status).toBe(400); // balance < 0
    expect((await A.owner.post(`/fees/invoices/${live.id}/adjust`, { amountPaise: -5_000, reason: 'waived late fee' })).body.data.totalPaise).toBe(600_000);
    await pay(A.studentsA[0]!, 1_000);
    expect((await A.owner.post(`/fees/invoices/${live.id}/void`, { reason: 'x' + 'yz' })).status).toBe(409); // has a payment
    await assertLedgerInvariant();
  });
});

describe('REQ-FEE-030 payments, receipts, advance', () => {
  it('allocates oldest dues first, numbers receipts per financial year, refuses overpayment unless kept as advance; advance pays the next invoice', async () => {
    const { structureId } = await setupStructure();
    await generate(structureId, 'Q1');
    const s = A.studentsA[0]!;
    const p1 = await pay(s, 250_000, { mode: 'upi' });
    expect(p1.status, JSON.stringify(p1.body)).toBe(201);
    expect(p1.body.data.payment.receiptNo).toBe(`ALPHA/${financialYear(today)}/000001`);
    expect((await pay(s, 600_000)).status).toBe(422); // more than the ₹3,500 due
    expect((await pay(s, 100, { mode: 'cheque' })).status).toBe(400); // cheque needs a number
    expect((await pay(s, 100, { paidOn: addDays(today, 1) })).status).toBe(400); // future
    const p2 = await pay(s, 600_000, { keepAdvance: true });
    expect(p2.body.data.payment).toMatchObject({ receiptNo: `ALPHA/${financialYear(today)}/000002`, unallocatedPaise: 250_000 });
    expect(p2.body.data.payment.receiptLines.map((l: { amountPaise: number }) => l.amountPaise)).toEqual([350_000, 250_000]);
    const sum = await acc.get(`/fees/students/${s}/summary`);
    expect(sum.body.data.totals).toMatchObject({ billedPaise: 600_000, paidPaise: 600_000, balancePaise: 0, advanceCreditPaise: 250_000 });
    await generate(structureId, 'Q2', { studentIds: [s] });
    const q2 = (await invoicesOf(s)).find((i) => i.installmentLabel === 'Q2')!;
    expect(q2).toMatchObject({ paidPaise: 250_000, balancePaise: 350_000, status: 'partially_paid' }); // advance used automatically
    expect((await acc.get(`/fees/students/${s}/summary`)).body.data.totals.advanceCreditPaise).toBe(0);
    await assertLedgerInvariant();
  });

  it('same Idempotency-Key ×10 concurrently → one payment; 30 parallel payments → 30 unique, gap-free receipt numbers', async () => {
    const { structureId } = await setupStructure();
    await generate(structureId, 'Q1');
    const kk = key();
    const same = await Promise.all(Array.from({ length: 10 }, () => pay(A.studentsA[0]!, 1_000, {}, acc, kk)));
    expect(same.filter((r) => r.status === 201)).toHaveLength(same.filter((r) => r.status === 201).length);
    const ids = new Set(same.filter((r) => r.status === 201).map((r) => r.body.data.payment.id));
    expect(ids.size).toBe(1);
    expect(same.every((r) => r.status === 201 || r.status === 409)).toBe(true);
    const many = await Promise.all(Array.from({ length: 30 }, (_x, i) => pay(A.studentsA[i % 3]!, 1_000 + i)));
    expect(many.every((r) => r.status === 201), JSON.stringify(many.find((r) => r.status !== 201)?.body)).toBe(true);
    const nos = (await runAsPlatform('test read', async () => PaymentModel.find({ schoolId: A.school.schoolId }).lean())).map((p) => Number(p.receiptNo.split('/').pop()));
    expect(nos.sort((a, b) => a - b)).toEqual(Array.from({ length: 31 }, (_x, i) => i + 1));
    await assertLedgerInvariant();
  });

  it('receipt PDF prints for permitted roles only', async () => {
    const { structureId } = await setupStructure();
    await generate(structureId, 'Q1');
    const p = await pay(A.studentsA[0]!, 100_000);
    const pdf = await acc.get(`/fees/payments/${p.body.data.payment.id}/receipt.pdf`).buffer(true).parse((res, cb) => { const chunks: Buffer[] = []; res.on('data', (c: Buffer) => chunks.push(c)); res.on('end', () => cb(null, Buffer.concat(chunks))); });
    expect(pdf.status).toBe(200);
    expect(pdf.headers['content-type']).toBe('application/pdf');
    expect((pdf.body as Buffer).subarray(0, 5).toString()).toBe('%PDF-');
    expect((pdf.body as Buffer).length).toBeGreaterThan(5_000);
    expect((await A.teacher.get(`/fees/payments/${p.body.data.payment.id}/receipt.pdf`)).status).toBe(403);
  });
});

describe('REQ-FEE-040 reversals, refunds, day close (separation of duties)', () => {
  it('a reversal is requested by one person and approved by another; original rows stay untouched; balances return', async () => {
    const { structureId } = await setupStructure();
    await generate(structureId, 'Q1');
    const s = A.studentsA[0]!;
    const p = await pay(s, 200_000);
    const pid = p.body.data.payment.id as string;
    const before = await runAsPlatform('test read', async () => JSON.stringify(await LedgerEntryModel.find({ schoolId: A.school.schoolId, paymentId: new Types.ObjectId(pid) }).sort({ _id: 1 }).lean()));
    const req = await acc.post(`/fees/payments/${pid}/reversal-requests`, { reason: 'cheque bounced' });
    expect(req.status).toBe(201);
    expect((await acc.post(`/fees/payments/${pid}/reversal-requests`, { reason: 'again' })).status).toBe(409);
    expect((await acc.post(`/fees/requests/${req.body.data.id}/approve`)).status).toBe(403); // accountant lacks refunds:approve
    const ownReq = await A.owner.post(`/fees/payments/${(await pay(s, 1_000)).body.data.payment.id}/reversal-requests`, { reason: 'typo' });
    expect((await A.owner.post(`/fees/requests/${ownReq.body.data.id}/approve`)).status).toBe(403); // not your own
    expect((await owner2.post(`/fees/requests/${ownReq.body.data.id}/approve`)).status).toBe(200);
    expect((await A.owner.post(`/fees/requests/${req.body.data.id}/approve`, { note: 'bank confirmed' })).status).toBe(200);
    expect((await A.owner.post(`/fees/requests/${req.body.data.id}/approve`)).status).toBe(409);
    const after = await runAsPlatform('test read', async () => (await LedgerEntryModel.find({ schoolId: A.school.schoolId, paymentId: new Types.ObjectId(pid) }).sort({ _id: 1 }).lean()));
    expect(JSON.stringify(after.slice(0, JSON.parse(before).length))).toBe(before); // original rows byte-identical
    expect(after.slice(JSON.parse(before).length).every((r) => r.type === 'reversal')).toBe(true);
    const inv = (await invoicesOf(s))[0]!;
    expect(inv).toMatchObject({ paidPaise: 0, balancePaise: 600_000, status: 'open' });
    expect((await acc.get(`/fees/payments/${pid}`)).body.data.status).toBe('reversed');
    await assertLedgerInvariant();
  });

  it('refunds come only from advance credit, need a second person, and reduce the credit when paid', async () => {
    const { structureId } = await setupStructure();
    await generate(structureId, 'Q1');
    const s = A.studentsA[2]!;
    await pay(s, 700_000, { keepAdvance: true });
    expect((await acc.post('/fees/refunds', { studentId: s, amountPaise: 200_000, reason: 'too much' })).status).toBe(400); // only ₹1,000 credit
    const r = await acc.post('/fees/refunds', { studentId: s, amountPaise: 60_000, reason: 'parent asked' });
    expect(r.status).toBe(201);
    expect((await acc.post('/fees/refunds', { studentId: s, amountPaise: 50_000, reason: 'double' })).status).toBe(400); // 40,000 left after the pending one
    expect((await acc.post(`/fees/requests/${r.body.data.id}/mark-paid`, { paidOn: today, mode: 'cash' })).status).toBe(409); // not approved yet
    expect((await A.owner.post(`/fees/requests/${r.body.data.id}/approve`)).status).toBe(200);
    expect((await acc.post(`/fees/requests/${r.body.data.id}/mark-paid`, { paidOn: today, mode: 'cash' })).status).toBe(200);
    expect((await acc.get(`/fees/students/${s}/summary`)).body.data.totals.advanceCreditPaise).toBe(40_000);
    await assertLedgerInvariant();
  });

  it('a closed day accepts no payments until an owner re-opens it (audited)', async () => {
    const { structureId } = await setupStructure();
    await generate(structureId, 'Q1');
    await pay(A.studentsA[0]!, 10_000);
    const close = await acc.post('/fees/day-closings', { date: today, countedCashPaise: 10_000 });
    expect(close.body.data).toMatchObject({ cashTotalPaise: 10_000, nonCashTotalPaise: 0 });
    expect((await acc.post('/fees/day-closings', { date: today })).status).toBe(409);
    expect((await pay(A.studentsA[0]!, 1_000)).status).toBe(409);
    expect((await acc.post('/fees/day-closings/reopen', { date: today, reason: 'late cash' })).status).toBe(403);
    expect((await A.owner.post('/fees/day-closings/reopen', { date: today, reason: 'late cash' })).status).toBe(200);
    expect((await pay(A.studentsA[0]!, 1_000)).status).toBe(201);
    const actions = (await _auditRowsForTest({ schoolId: A.school.schoolId })).map((r) => r.action);
    expect(actions).toEqual(expect.arrayContaining(['fees.day_closed', 'fees.day_reopened', 'fees.payment_recorded', 'fees.invoices_generated']));
  });
});

describe('REQ-FEE-050 ledger invariant under random operation sequences (property)', () => {
  it('after any sequence of payments, advances, reversals, late fees and adjustments every invoice balance equals its ledger', async () => {
    const { structureId } = await setupStructure();
    await generate(structureId, 'Q1');
    await generate(structureId, 'Q2');
    const opArb = fc.oneof(
      fc.record({ op: fc.constant('pay' as const), s: fc.integer({ min: 0, max: 2 }), amt: fc.integer({ min: 1, max: 900_000 }), adv: fc.boolean() }),
      fc.record({ op: fc.constant('reverse' as const), n: fc.nat() }),
      fc.record({ op: fc.constant('late' as const), s: fc.integer({ min: 0, max: 2 }), amt: fc.integer({ min: 1, max: 50_000 }) }),
      fc.record({ op: fc.constant('adjust' as const), s: fc.integer({ min: 0, max: 2 }), amt: fc.integer({ min: -100_000, max: 100_000 }).filter((x) => x !== 0) }),
    );
    await fc.assert(fc.asyncProperty(fc.array(opArb, { minLength: 4, maxLength: 8 }), async (ops) => {
      for (const o of ops) {
        if (o.op === 'pay') await pay(A.studentsA[o.s]!, o.amt, { keepAdvance: o.adv });
        else if (o.op === 'reverse') {
          const ps = (await acc.get('/fees/payments?status=recorded&limit=100')).body.data as Array<{ id: string }>;
          if (!ps.length) continue;
          const req = await acc.post(`/fees/payments/${ps[o.n % ps.length]!.id}/reversal-requests`, { reason: 'property test' });
          if (req.status === 201) await A.owner.post(`/fees/requests/${req.body.data.id}/approve`);
        } else {
          const inv = (await invoicesOf(A.studentsA[o.s]!)).find((i) => i.status !== 'void');
          if (!inv) continue;
          if (o.op === 'late') await acc.post(`/fees/invoices/${inv.id}/late-fee`, { amountPaise: o.amt, reason: 'property test' });
          else await A.owner.post(`/fees/invoices/${inv.id}/adjust`, { amountPaise: o.amt, reason: 'property test' }); // 400 if it would go negative — also fine
        }
      }
      await assertLedgerInvariant();
    }), { numRuns: 6 });
  }, 180_000);
});

describe('REQ-FEE-060 reports', () => {
  it('collection totals equal the payments; outstanding equals the open balances; CSV exports are audited', async () => {
    const { structureId } = await setupStructure();
    await generate(structureId, 'Q1');
    await pay(A.studentsA[0]!, 100_000, { mode: 'upi' });
    await pay(A.studentsA[1]!, 50_000);
    const col = await acc.get(`/fees/reports/collection?from=${today}&to=${today}`);
    expect(col.body.data).toMatchObject({ totalPaise: 150_000, count: 2 });
    expect(col.body.data.byMode).toEqual([{ key: 'cash', amountPaise: 50_000 }, { key: 'upi', amountPaise: 100_000 }]);
    const out = await acc.get('/fees/reports/outstanding');
    expect(out.body.data.totalPaise).toBe(3 * 600_000 - 150_000);
    expect(out.body.data.overduePaise).toBe(3 * 600_000 - 150_000); // Q1 was due 30 days ago
    const csv = await acc.get(`/fees/reports/collection.csv?from=${today}&to=${today}`);
    expect(csv.status).toBe(200);
    expect(csv.text).toContain('Receipt No');
    expect((await _auditRowsForTest({ schoolId: A.school.schoolId })).some((r) => r.action === 'fees.report_exported')).toBe(true);
  });

  it('the fixture builder (used by the isolation harness) works end to end', async () => {
    const f = await buildFeeData(A, 'fixture');
    expect(Object.values(f).every((v) => /^[a-f0-9]{24}$/.test(v))).toBe(true);
  });
});
