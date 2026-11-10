import { TenantRepository } from '../../core/tenancy/repository';
import { AssignmentModel, StoredFileModel, SubmissionModel, type IAssignment, type IStoredFile, type ISubmission } from './homework.model';

export const assignmentRepo = new (class extends TenantRepository<IAssignment> { constructor() { super(AssignmentModel); } })();
export const submissionRepo = new (class extends TenantRepository<ISubmission> { constructor() { super(SubmissionModel); } })();
export const storedFileRepo = new (class extends TenantRepository<IStoredFile> { constructor() { super(StoredFileModel); } })();
