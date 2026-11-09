import { TenantRepository } from '../../core/tenancy/repository';
import { ImportBatchModel, type IImportBatch } from './imports.model';

export class ImportBatchRepository extends TenantRepository<IImportBatch> {
  constructor() { super(ImportBatchModel); }
}

export const importBatchRepo = new ImportBatchRepository();
