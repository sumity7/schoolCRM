import js from '@eslint/js';
import tseslint from 'typescript-eslint';

/**
 * Architecture-enforcing lint rules (doc 06 lock 4, doc 09 §2).
 * These are SECURITY controls, not style: they keep tenant-unsafe code from compiling into the project.
 */
const MODEL_IMPORT = {
  group: ['**/*.model', '**/*.model.ts'],
  allowTypeImports: true,
  message: 'Mongoose models may only be imported by *.repository.ts / *.model.ts files (use the repository). Type imports are fine.',
};
const PLATFORM_ACCESS = [
  { group: ['**/platform-repository', '**/platform-repository.ts'], message: 'PlatformRepository is cross-tenant. Only modules/auth, users, schools, platform, roles(seed), audit/core services and scripts may use it.' },
  { group: ['**/auth/auth.repository', '**/auth.repository'], message: 'auth.repository exposes cross-tenant data access. Only modules/auth, users, schools, platform and scripts may import it.' },
];

export default tseslint.config(
  { ignores: ['**/node_modules/**', '**/dist/**', '**/.next/**', '**/coverage/**', '**/.data/**', 'apps/web/next-env.d.ts', '**/playwright-report/**', '**/test-results/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' }],
      '@typescript-eslint/no-explicit-any': 'error',
      'no-restricted-syntax': [
        'error',
        {
          selector: "MemberExpression[property.name='schoolId'][object.property.name=/^(body|params|query|headers)$/]",
          message: 'Never read schoolId from the request. Tenant comes ONLY from the authenticated session (TenantContext).',
        },
        {
          selector: "MemberExpression[property.value='schoolId'][object.property.name=/^(body|params|query|headers)$/]",
          message: 'Never read schoolId from the request. Tenant comes ONLY from the authenticated session (TenantContext).',
        },
      ],
    },
  },
  // Modules: no direct model imports, no cross-tenant access by default.
  {
    files: ['apps/api/src/modules/**/*.ts'],
    ignores: ['**/*.repository.ts', '**/*.model.ts', '**/*.test.ts'],
    rules: { '@typescript-eslint/no-restricted-imports': ['error', { patterns: [MODEL_IMPORT, ...PLATFORM_ACCESS] }] },
  },
  // Modules that legitimately perform identity / provisioning / platform work may use PlatformRepository (still no raw models).
  {
    files: ['apps/api/src/modules/auth/**/*.ts', 'apps/api/src/modules/users/**/*.ts', 'apps/api/src/modules/schools/**/*.ts', 'apps/api/src/modules/platform/**/*.ts', 'apps/api/src/modules/roles/role-seed.ts'],
    ignores: ['**/*.repository.ts', '**/*.model.ts', '**/*.test.ts'],
    rules: { '@typescript-eslint/no-restricted-imports': ['error', { patterns: [MODEL_IMPORT] }] },
  },
  // Repositories, models and tests may touch models.
  {
    files: ['**/*.repository.ts', '**/*.model.ts', '**/*.test.ts', 'apps/api/test/**/*.ts', 'apps/api/scripts/**/*.ts', 'apps/api/src/core/**/*.ts'],
    rules: { '@typescript-eslint/no-restricted-imports': 'off', 'no-restricted-syntax': 'off' },
  },
  {
    files: ['apps/api/src/core/tenancy/plugin.ts'],
    rules: { '@typescript-eslint/no-explicit-any': 'off' },
  },
);
