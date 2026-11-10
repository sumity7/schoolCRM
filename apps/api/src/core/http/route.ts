import type { Request, RequestHandler, Response, Router } from 'express';
import { z, type ZodTypeAny } from 'zod';
import type { PageMeta, PermissionKey, Scope } from '@edunex/shared';
import { AppError, forbidden, unauthenticated, validationFailed } from '../errors';
import { AuditService, type AuditEntry } from '../audit/audit.service';
import type { TenantContext } from '../tenancy/context';
import type { AuthContext } from './types';
import { csrfGuard } from './csrf';

export type Tenancy = 'school' | 'platform' | 'none';
export type RateClass = 'auth' | 'sensitive' | 'write' | 'read' | 'export';
export type HttpMethod = 'get' | 'post' | 'put' | 'patch' | 'delete';

export interface HandlerResult {
  status?: number;
  data?: unknown;
  meta?: PageMeta;
  /** Provide audit details; if the route is `audit: true` a row is ALWAYS written (generic if omitted). */
  audit?: AuditEntry;
}

export type RouteArgs<TN extends Tenancy, P, Q, B> = {
  params: P;
  query: Q;
  body: B;
  req: Request;
  res: Response;
  scope: Scope | undefined;
  auth: TN extends 'none' ? AuthContext | undefined : AuthContext;
  tenant: TN extends 'school' ? TenantContext : undefined;
};

export interface RouteSpec<TN extends Tenancy, P extends ZodTypeAny, Q extends ZodTypeAny, B extends ZodTypeAny> {
  method: HttpMethod;
  path: string;
  summary: string;
  tenancy: TN;
  /** `public` = no session needed. School/platform routes always need a session. */
  auth: 'public' | 'session';
  /** Required for tenancy 'school' unless `anyMember` is set. */
  permission?: PermissionKey;
  /** School route open to any active member of the school (e.g. own-school profile). */
  anyMember?: boolean;
  /** Extra permissions that must ALSO be held (any scope), e.g. finance routes additionally need `financial:view`. */
  alsoRequire?: PermissionKey[];
  /** Routes that serve OWN-scope grants (parents, a teacher's own staff profile). Everything else refuses `own` scope (deny-by-default). */
  allowOwnScope?: boolean;
  /** Routes usable while the two-factor code is still outstanding (me, logout, MFA verify). */
  allowMfaPending?: boolean;
  /** Platform routes: allowed platform roles (default super_admin). */
  platformRoles?: Array<'super_admin' | 'support'>;
  entitlement?: string;
  rateClass?: RateClass;
  params?: P;
  query?: Q;
  body?: B;
  /** Mutating routes MUST state audit: true, or an explicit exemption with a reason. */
  audit?: true | { exempt: string };
  /** CSRF exemption (signature-verified webhooks only) with reason. */
  csrfExempt?: string;
  /** Maps path params that are record ids → resource kind (drives the isolation harness). */
  idParams?: Record<string, string>;
  handler: (args: RouteArgs<TN, z.infer<P>, z.infer<Q>, z.infer<B>>) => Promise<HandlerResult | void>;
}

export interface ManifestEntry {
  method: HttpMethod;
  path: string;
  summary: string;
  tenancy: Tenancy;
  auth: 'public' | 'session';
  permission?: PermissionKey;
  anyMember?: boolean;
  alsoRequire?: PermissionKey[];
  allowOwnScope?: boolean;
  platformRoles?: string[];
  entitlement?: string;
  rateClass: RateClass;
  mutating: boolean;
  audit?: true | { exempt: string };
  csrfExempt?: string;
  idParams?: Record<string, string>;
  hasBody: boolean;
}

const EMPTY = z.object({}).strict();
type EmptySchema = typeof EMPTY;

export interface Registrar {
  readonly manifest: ManifestEntry[];
  define<TN extends Tenancy, P extends ZodTypeAny = EmptySchema, Q extends ZodTypeAny = EmptySchema, B extends ZodTypeAny = EmptySchema>(
    spec: RouteSpec<TN, P, Q, B>,
  ): void;
}

export interface RegistrarDeps {
  router: Router;
  basePath: string; // e.g. /api/v1 — recorded in the manifest
  allowedOrigins: string[];
  limiters: Record<RateClass, RequestHandler>;
  /** Hook for subscription/feature gates (entitlement-lite). */
  entitlementGate?: (feature: string, tenant: TenantContext) => Promise<void>;
}

const MUTATING = new Set<HttpMethod>(['post', 'put', 'patch', 'delete']);

function parse<T extends ZodTypeAny>(schema: T, value: unknown, where: string): z.infer<T> {
  const r = schema.safeParse(value);
  if (!r.success) {
    throw validationFailed(
      `Invalid ${where}`,
      r.error.issues.map((i) => ({ path: i.path.join('.') || where, message: i.message })),
    );
  }
  return r.data;
}

export function createRegistrar(deps: RegistrarDeps): Registrar {
  const manifest: ManifestEntry[] = [];
  const csrf = csrfGuard(deps.allowedOrigins);

  return {
    manifest,
    define(spec) {
      const mutating = MUTATING.has(spec.method);
      if (spec.tenancy === 'school' && !spec.permission && !spec.anyMember) {
        throw new Error(`Route ${spec.method.toUpperCase()} ${spec.path}: school routes must declare a permission or anyMember`);
      }
      if (spec.tenancy !== 'school' && (spec.permission || spec.anyMember || spec.alsoRequire)) {
        throw new Error(`Route ${spec.method.toUpperCase()} ${spec.path}: permission only applies to school routes`);
      }
      if (spec.tenancy !== 'none' && spec.auth === 'public') {
        throw new Error(`Route ${spec.method.toUpperCase()} ${spec.path}: school/platform routes cannot be public`);
      }
      if (mutating && !spec.audit) {
        throw new Error(`Route ${spec.method.toUpperCase()} ${spec.path}: mutating routes must declare audit: true or { exempt: reason }`);
      }
      if (mutating && !spec.body && spec.method !== 'delete') {
        throw new Error(`Route ${spec.method.toUpperCase()} ${spec.path}: mutating routes must declare a body schema`);
      }
      const rateClass: RateClass = spec.rateClass ?? (mutating ? 'write' : 'read');
      const prefix = deps.basePath;
      manifest.push({
        method: spec.method,
        path: `${prefix}${spec.path}`,
        summary: spec.summary,
        tenancy: spec.tenancy,
        auth: spec.auth,
        permission: spec.permission,
        anyMember: spec.anyMember,
        alsoRequire: spec.alsoRequire,
        allowOwnScope: spec.allowOwnScope,
        platformRoles: spec.tenancy === 'platform' ? (spec.platformRoles ?? ['super_admin']) : undefined,
        entitlement: spec.entitlement,
        rateClass,
        mutating,
        audit: spec.audit,
        csrfExempt: spec.csrfExempt,
        idParams: spec.idParams,
        hasBody: Boolean(spec.body),
      });

      const handler: RequestHandler = async (req, res, next) => {
        try {
          // 1. CSRF on every state-changing request (cookie auth is ambient).
          if (mutating && !spec.csrfExempt) csrf(req);

          // 2. Authentication
          const auth = req.auth;
          if (spec.auth === 'session' || spec.tenancy !== 'none') {
            if (!auth) throw unauthenticated();
            if (auth.session.mfaPending && !spec.allowMfaPending) throw unauthenticated('Enter the code from your authenticator app to finish signing in');
          }

          // 3. Tenancy + authorization
          let scope: Scope | undefined;
          if (spec.tenancy === 'platform') {
            const allowed = spec.platformRoles ?? ['super_admin'];
            if (!auth!.user.platformRole || !allowed.includes(auth!.user.platformRole)) throw forbidden();
            if (!auth!.user.mfaEnabled) throw forbidden('Set up two-factor authentication (Security page) before using the platform console');
          } else if (spec.tenancy === 'school') {
            const tenant = auth!.tenant;
            if (!tenant) throw forbidden('No active school selected');
            if (spec.permission) {
              scope = tenant.grants.get(spec.permission);
              if (!scope) throw forbidden();
              if (scope === 'own' && !spec.allowOwnScope) throw forbidden();
            }
            for (const extra of spec.alsoRequire ?? []) if (!tenant.grants.get(extra)) throw forbidden();
            if (spec.entitlement && deps.entitlementGate) await deps.entitlementGate(spec.entitlement, tenant);
          }

          // 4. Validation (strict: unknown keys rejected)
          const params = parse(spec.params ?? EMPTY, req.params, 'path parameters');
          const query = parse(spec.query ?? EMPTY, req.query, 'query parameters');
          const body = spec.body ? parse(spec.body, req.body ?? {}, 'request body') : undefined;

          // 5. Handler
          const result = (await spec.handler({
            params,
            query,
            body,
            req,
            res,
            scope,
            auth: auth as never,
            tenant: (spec.tenancy === 'school' ? auth!.tenant : undefined) as never,
          } as never)) as HandlerResult | void;

          // 6. Audit — guaranteed for `audit: true` routes
          if (spec.audit === true) {
            await AuditService.record(result?.audit ?? { action: `${spec.method.toUpperCase()} ${spec.path}`, entityType: 'route' });
          }

          if (res.headersSent) return;
          const status = result?.status ?? 200;
          if (status === 204) {
            res.status(204).end();
            return;
          }
          res.status(status).json({ data: result?.data ?? null, ...(result?.meta ? { meta: result.meta } : {}) });
        } catch (err) {
          next(err);
        }
      };

      const mw: RequestHandler[] = [deps.limiters[rateClass], handler];
      deps.router[spec.method](spec.path, ...mw);
    },
  };
}

export { AppError };
