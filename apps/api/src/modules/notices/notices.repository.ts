import { TenantRepository } from '../../core/tenancy/repository';
import { NoticeDeliveryModel, NoticeModel, NoticeReadModel, type INotice, type INoticeDelivery, type INoticeRead } from './notices.model';

export const noticeRepo = new (class extends TenantRepository<INotice> { constructor() { super(NoticeModel); } })();
export const noticeReadRepo = new (class extends TenantRepository<INoticeRead> { constructor() { super(NoticeReadModel); } })();
export const noticeDeliveryRepo = new (class extends TenantRepository<INoticeDelivery> { constructor() { super(NoticeDeliveryModel); } })();
