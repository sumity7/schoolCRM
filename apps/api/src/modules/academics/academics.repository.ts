import { TenantRepository } from '../../core/tenancy/repository';
import {
  AcademicSessionModel, CalendarEventModel, SchoolClassModel, SectionModel, SubjectModel, TeacherAssignmentModel,
  type IAcademicSession, type ICalendarEvent, type ISchoolClass, type ISection, type ISubject, type ITeacherAssignment,
} from './academics.model';

export class SessionRepository extends TenantRepository<IAcademicSession> {
  constructor() { super(AcademicSessionModel); }
  findActive() { return this.findOne({ status: 'active' }); }
}
export class ClassRepository extends TenantRepository<ISchoolClass> {
  constructor() { super(SchoolClassModel); }
}
export class SectionRepository extends TenantRepository<ISection> {
  constructor() { super(SectionModel); }
}
export class SubjectRepository extends TenantRepository<ISubject> {
  constructor() { super(SubjectModel); }
}
export class TeacherAssignmentRepository extends TenantRepository<ITeacherAssignment> {
  constructor() { super(TeacherAssignmentModel); }
}
export class CalendarRepository extends TenantRepository<ICalendarEvent> {
  constructor() { super(CalendarEventModel); }
}

export const sessionRepo = new SessionRepository();
export const classRepo = new ClassRepository();
export const sectionRepo = new SectionRepository();
export const subjectRepo = new SubjectRepository();
export const assignmentRepo = new TeacherAssignmentRepository();
export const calendarRepo = new CalendarRepository();
