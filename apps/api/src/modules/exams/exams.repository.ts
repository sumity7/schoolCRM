import { TenantRepository } from '../../core/tenancy/repository';
import {
  ExamModel, ExamSubjectModel, GradingScaleModel, MarkModel, ResultModel,
  type IExam, type IExamSubject, type IGradingScale, type IMark, type IResult,
} from './exams.model';

export const gradingScaleRepo = new (class extends TenantRepository<IGradingScale> { constructor() { super(GradingScaleModel); } })();
export const examRepo = new (class extends TenantRepository<IExam> { constructor() { super(ExamModel); } })();
export const examSubjectRepo = new (class extends TenantRepository<IExamSubject> { constructor() { super(ExamSubjectModel); } })();
export const markRepo = new (class extends TenantRepository<IMark> { constructor() { super(MarkModel); } })();
export const resultRepo = new (class extends TenantRepository<IResult> { constructor() { super(ResultModel); } })();
