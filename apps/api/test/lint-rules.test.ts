import { describe, it, expect } from 'vitest';
import { resolve } from 'node:path';
import { ESLint } from 'eslint';

/**
 * Canary: the architecture-enforcing lint rules (doc 06 lock 4) must actually fire.
 * If someone weakens eslint.config.mjs these tests fail — a silent rule is worse than no rule.
 */
const root = resolve(__dirname, '../../..');
const eslint = new ESLint({ cwd: root });

async function lint(code: string, filePath: string) {
  const [res] = await eslint.lintText(code, { filePath: resolve(root, filePath) });
  return res!.messages.filter((m) => m.severity === 2).map((m) => `${m.ruleId}: ${m.message}`);
}

describe('REQ-TEN lint locks', () => {
  it('forbids importing a Mongoose model (value import) from a module service', async () => {
    const msgs = await lint("import { StudentModel } from './students.model';\nexport const x = StudentModel;\n", 'apps/api/src/modules/students/bad.service.ts');
    expect(msgs.join('\n')).toMatch(/no-restricted-imports/);
  });
  it('allows type-only model imports and repository files', async () => {
    expect(await lint("import type { IStudent } from './students.model';\nexport type X = IStudent;\n", 'apps/api/src/modules/students/ok.service.ts')).toEqual([]);
    expect(await lint("import { StudentModel } from './students.model';\nexport const x = StudentModel;\n", 'apps/api/src/modules/students/ok.repository.ts')).toEqual([]);
  });
  it('forbids school-scoped modules from using cross-tenant access', async () => {
    const a = await lint("import { PlatformRepository } from '../../core/tenancy/platform-repository';\nexport const x = PlatformRepository;\n", 'apps/api/src/modules/attendance/bad.service.ts');
    const b = await lint("import { users } from '../auth/auth.repository';\nexport const x = users;\n", 'apps/api/src/modules/students/bad2.service.ts');
    expect(a.join('\n')).toMatch(/PlatformRepository is cross-tenant/);
    expect(b.join('\n')).toMatch(/cross-tenant data access/);
  });
  it('forbids reading schoolId from the request', async () => {
    for (const expr of ['req.body.schoolId', 'req.params.schoolId', 'req.query.schoolId', "req.body['schoolId']"]) {
      const msgs = await lint(`export const f = (req: any) => ${expr};\n`, 'apps/api/src/modules/students/bad3.routes.ts');
      expect(msgs.join('\n'), expr).toMatch(/Never read schoolId from the request/);
    }
  });
});
