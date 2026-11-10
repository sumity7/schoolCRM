import { TenantRepository } from '../../core/tenancy/repository';
import { TimetableSlotModel, TimetableVersionModel, type ITimetableSlot, type ITimetableVersion } from './timetable.model';

export const timetableVersionRepo = new (class extends TenantRepository<ITimetableVersion> { constructor() { super(TimetableVersionModel); } })();
export const timetableSlotRepo = new (class extends TenantRepository<ITimetableSlot> { constructor() { super(TimetableSlotModel); } })();
