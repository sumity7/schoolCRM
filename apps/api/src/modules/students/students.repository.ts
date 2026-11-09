import { TenantRepository } from '../../core/tenancy/repository';
import {
  EnrollmentModel, GuardianModel, StudentGuardianModel, StudentModel,
  type IEnrollment, type IGuardian, type IStudent, type IStudentGuardian,
} from './students.model';

export class StudentRepository extends TenantRepository<IStudent> {
  constructor() { super(StudentModel); }
}
export class EnrollmentRepository extends TenantRepository<IEnrollment> {
  constructor() { super(EnrollmentModel); }
}
export class GuardianRepository extends TenantRepository<IGuardian> {
  constructor() { super(GuardianModel); }
}
export class StudentGuardianRepository extends TenantRepository<IStudentGuardian> {
  constructor() { super(StudentGuardianModel); }
}

export const studentRepo = new StudentRepository();
export const enrollmentRepo = new EnrollmentRepository();
export const guardianRepo = new GuardianRepository();
export const studentGuardianRepo = new StudentGuardianRepository();
