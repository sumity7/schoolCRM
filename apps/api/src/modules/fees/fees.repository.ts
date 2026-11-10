import { TenantRepository } from '../../core/tenancy/repository';
import {
  AllocationModel, ConcessionModel, DayClosingModel, FeeCategoryModel, FeeStructureModel, FinanceRequestModel, InvoiceModel, LedgerEntryModel, PaymentModel,
  type IAllocation, type IConcession, type IDayClosing, type IFeeCategory, type IFeeStructure, type IFinanceRequest, type IInvoice, type ILedgerEntry, type IPayment,
} from './fees.model';

export const feeCategoryRepo = new (class extends TenantRepository<IFeeCategory> { constructor() { super(FeeCategoryModel); } })();
export const feeStructureRepo = new (class extends TenantRepository<IFeeStructure> { constructor() { super(FeeStructureModel); } })();
export const concessionRepo = new (class extends TenantRepository<IConcession> { constructor() { super(ConcessionModel); } })();
export const invoiceRepo = new (class extends TenantRepository<IInvoice> { constructor() { super(InvoiceModel); } })();
export const paymentRepo = new (class extends TenantRepository<IPayment> { constructor() { super(PaymentModel); } })();
export const allocationRepo = new (class extends TenantRepository<IAllocation> { constructor() { super(AllocationModel); } })();
export const ledgerRepo = new (class extends TenantRepository<ILedgerEntry> { constructor() { super(LedgerEntryModel); } })();
export const financeRequestRepo = new (class extends TenantRepository<IFinanceRequest> { constructor() { super(FinanceRequestModel); } })();
export const dayClosingRepo = new (class extends TenantRepository<IDayClosing> { constructor() { super(DayClosingModel); } })();
