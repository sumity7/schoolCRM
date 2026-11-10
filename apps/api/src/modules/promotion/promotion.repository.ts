import { TenantRepository } from '../../core/tenancy/repository';
import { PromotionRecordModel, type IPromotionRecord } from './promotion.model';

export const promotionRepo = new (class extends TenantRepository<IPromotionRecord> { constructor() { super(PromotionRecordModel); } })();
