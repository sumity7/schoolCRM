import { TenantRepository } from '../../core/tenancy/repository';
import { AttendanceCorrectionModel, AttendanceRecordModel, type IAttendanceCorrection, type IAttendanceRecord } from './attendance.model';

export class AttendanceRecordRepository extends TenantRepository<IAttendanceRecord> {
  constructor() { super(AttendanceRecordModel); }
}
export class AttendanceCorrectionRepository extends TenantRepository<IAttendanceCorrection> {
  constructor() { super(AttendanceCorrectionModel); }
}
export const attendanceRepo = new AttendanceRecordRepository();
export const correctionRepo = new AttendanceCorrectionRepository();
