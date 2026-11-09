import { z } from 'zod';
import { IMPORT_DATE_FORMATS, IMPORT_MAX_CHARS, STUDENT_IMPORT_FIELDS, STUDENT_IMPORT_FIELD_KEYS, objectIdSchema, paginationQuerySchema, type ImportMapping } from '@edunex/shared';
import type { Registrar } from '../../core/http/route';
import { sendCsv } from '../../core/csv/csv';
import { AuditService } from '../../core/audit/audit.service';
import { runIdempotent } from '../../core/idempotency/idempotency.service';
import { ImportsService, toBatchDetail, toBatchSummary } from './imports.service';

const idParam = z.object({ id: objectIdSchema }).strict();
const mappingSchema = z
  .object(Object.fromEntries(STUDENT_IMPORT_FIELD_KEYS.map((k) => [k, z.number().int().min(0).max(59).nullable().optional()])) as Record<string, z.ZodTypeAny>)
  .strict();

export function registerImportRoutes(r: Registrar) {
  r.define({
    method: 'get', path: '/imports', summary: 'Import history', tenancy: 'school', auth: 'session', permission: 'imports:create',
    query: paginationQuerySchema.strict(),
    async handler({ query }) {
      const res = await ImportsService.list(query.page, query.limit);
      return { data: res.data.map(toBatchSummary), meta: res.meta };
    },
  });

  r.define({
    method: 'get', path: '/imports/template.csv', summary: 'Blank student import template (CSV)', tenancy: 'school', auth: 'session', permission: 'imports:create',
    async handler({ res }) {
      sendCsv(res, 'student-import-template.csv', STUDENT_IMPORT_FIELDS.filter((f) => f.key !== 'fullName').map((f) => f.label), []);
    },
  });

  r.define({
    method: 'post', path: '/imports', summary: 'Upload a CSV (students) → batch with detected headers and suggested mapping', tenancy: 'school', auth: 'session', permission: 'imports:create',
    rateClass: 'sensitive',
    body: z.object({
      entity: z.literal('students'),
      filename: z.string().trim().min(1).max(200),
      csv: z.string().min(1).max(IMPORT_MAX_CHARS, 'File is too large (max ~3 MB). Split it into smaller files.'),
    }).strict(),
    audit: { exempt: 'ImportsService records imports.uploaded' },
    async handler({ body }) {
      const b = await ImportsService.upload(body);
      return { status: 201, data: toBatchDetail(b) };
    },
  });

  r.define({
    method: 'get', path: '/imports/:id', summary: 'Import batch: mapping, preview, problems, counts', tenancy: 'school', auth: 'session', permission: 'imports:create',
    params: idParam, idParams: { id: 'import' },
    async handler({ params }) {
      return { data: toBatchDetail(await ImportsService.get(params.id)) };
    },
  });

  r.define({
    method: 'put', path: '/imports/:id/mapping', summary: 'Set the column mapping and date order', tenancy: 'school', auth: 'session', permission: 'imports:create',
    params: idParam, idParams: { id: 'import' },
    body: z.object({ mapping: mappingSchema, dateFormat: z.enum(IMPORT_DATE_FORMATS).optional() }).strict(),
    audit: true,
    async handler({ params, body }) {
      const b = await ImportsService.setMapping(params.id, { mapping: body.mapping as ImportMapping, dateFormat: body.dateFormat });
      return { data: toBatchDetail(b), audit: { action: 'imports.mapping_set', entityType: 'import_batch', entityId: params.id, after: { mapping: body.mapping, dateFormat: body.dateFormat } } };
    },
  });

  r.define({
    method: 'post', path: '/imports/:id/validate', summary: 'Validate every row → preview + error report (nothing is saved)', tenancy: 'school', auth: 'session', permission: 'imports:create',
    params: idParam, idParams: { id: 'import' },
    body: z.object({}).strict(),
    audit: { exempt: 'Validation writes no school records; the batch keeps its own validatedAt' },
    async handler({ params }) {
      return { data: toBatchDetail(await ImportsService.validate(params.id)) };
    },
  });

  r.define({
    method: 'post', path: '/imports/:id/commit', summary: 'Import the valid rows (Idempotency-Key required)', tenancy: 'school', auth: 'session', permission: 'imports:approve',
    rateClass: 'sensitive', params: idParam, idParams: { id: 'import' },
    body: z.object({}).strict(),
    audit: { exempt: 'ImportsService records imports.committed / imports.failed' },
    async handler({ params, req }) {
      await ImportsService.get(params.id); // 404 (incl. other schools' ids) before anything else
      const out = await runIdempotent(req.get('Idempotency-Key'), 'imports.commit', { id: params.id }, async () => ({
        status: 200, body: toBatchDetail(await ImportsService.commit(params.id)),
      }));
      return { status: out.status, data: out.body };
    },
  });

  r.define({
    method: 'post', path: '/imports/:id/rollback', summary: 'Remove the records this import created (untouched ones only)', tenancy: 'school', auth: 'session', permission: 'imports:approve',
    rateClass: 'sensitive', params: idParam, idParams: { id: 'import' },
    body: z.object({ reason: z.string().trim().max(300).optional() }).strict(),
    audit: { exempt: 'ImportsService records imports.rolled_back' },
    async handler({ params }) {
      return { data: toBatchDetail(await ImportsService.rollback(params.id)) };
    },
  });

  r.define({
    method: 'get', path: '/imports/:id/errors.csv', summary: 'Download rejected rows with reasons (CSV)', tenancy: 'school', auth: 'session', permission: 'imports:create',
    rateClass: 'export', params: idParam, idParams: { id: 'import' },
    async handler({ params, res }) {
      const b = await ImportsService.get(params.id);
      const report = ImportsService.errorReport(b);
      await AuditService.record({ action: 'imports.error_report_downloaded', entityType: 'import_batch', entityId: b._id, meta: { rows: report.rows.length } });
      sendCsv(res, `import-${String(b._id).slice(-6)}-problems.csv`, report.headers, report.rows);
    },
  });
}
