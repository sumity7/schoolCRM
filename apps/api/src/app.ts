import express, { Router, type Express } from 'express';
import helmet from 'helmet';
import type { Env } from './config/env';
import type { Logger } from './core/logging/logger';
import type { EmailAdapter } from './core/notifications/email';
import { createRegistrar, type Registrar } from './core/http/route';
import { errorHandler, makeLimiters, noStore, notFoundHandler, rejectOperatorKeys, requestContextMiddleware, type LimiterConfig } from './core/http/middleware';
import { dbReady } from './core/db/connection';
import { AuthService } from './modules/auth/auth.service';
import { SessionService, policyFromEnv } from './modules/auth/session.service';
import { attachAuth } from './modules/auth/auth.middleware';
import { registerAuthRoutes } from './modules/auth/auth.routes';
import { registerSchoolRoutes } from './modules/schools/schools.routes';
import { registerUserRoutes } from './modules/users/users.routes';
import { registerAuditRoutes } from './modules/audit/audit.routes';
import { registerAcademicsRoutes } from './modules/academics/academics.routes';
import { registerStaffRoutes } from './modules/staff/staff.routes';
import { registerStudentRoutes } from './modules/students/students.routes';
import { registerAttendanceRoutes } from './modules/attendance/attendance.routes';
import { registerImportRoutes } from './modules/imports/imports.routes';
import { registerFeeRoutes } from './modules/fees/fees.routes';
import { registerNoticeRoutes } from './modules/notices/notices.routes';
import { registerNoticeJobs } from './modules/notices/notices.service';
import { registerParentRoutes } from './modules/parent/parent.routes';
import { registerExamRoutes } from './modules/exams/exams.routes';
import { registerPromotionRoutes } from './modules/promotion/promotion.routes';
import { registerPlatformRoutes } from './modules/platform/platform.routes';
import { registerStudentPortalRoutes } from './modules/student-portal/student.routes';
import { registerTimetableRoutes } from './modules/timetable/timetable.routes';
import { registerSchoolCalendarRoutes } from './modules/student-portal/school-calendar';
import { registerHomeworkRoutes } from './modules/homework/homework.routes';
import { HomeworkService } from './modules/homework/homework.service';
import { createStorage, type FileStorage } from './core/storage/file-storage';

export interface AppDeps {
  env: Env;
  logger: Logger;
  email: EmailAdapter;
  limiters?: LimiterConfig['overrides'];
  /** File storage provider (default: local disk under UPLOAD_DIR). Tests may inject an in-memory one. */
  storage?: FileStorage;
}

export interface BuiltApp {
  app: Express;
  registrar: Registrar;
  sessions: SessionService;
  auth: AuthService;
}

export const API_BASE = '/api/v1';

export function createApp(deps: AppDeps): BuiltApp {
  const { env, logger } = deps;
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', env.TRUST_PROXY_HOPS);
  app.set('query parser', 'simple');

  app.use(requestContextMiddleware);
  app.use(
    helmet({
      // Pure JSON API: lock everything down.
      contentSecurityPolicy: { directives: { defaultSrc: ["'none'"], frameAncestors: ["'none'"] } },
      crossOriginResourcePolicy: { policy: 'same-origin' },
      referrerPolicy: { policy: 'no-referrer' },
    }),
  );
  app.use(noStore);

  // Liveness/readiness — no data, no auth.
  app.get('/health/live', (_req, res) => res.json({ status: 'ok' }));
  app.get('/health/ready', (_req, res) => (dbReady() ? res.json({ status: 'ready' }) : res.status(503).json({ status: 'not_ready' })));

  // CSV uploads (≤ 2,000 rows) are the only large bodies; every other route keeps the 100 kb cap.
  app.use(`${API_BASE}/imports`, express.json({ limit: '4mb', strict: true, type: 'application/json' }));
  // Homework uploads travel as base64 JSON (keeps the JSON-only CSRF rule): the two upload routes get a larger cap, sized from UPLOAD_MAX_BYTES.
  const uploadJson = express.json({ limit: `${Math.ceil((env.UPLOAD_MAX_BYTES * 4) / 3 / 1024) + 16}kb`, strict: true, type: 'application/json' });
  app.post([`${API_BASE}/homework/files`, `${API_BASE}/student/me/homework/files`], uploadJson);
  app.use(express.json({ limit: '100kb', strict: true, type: 'application/json' }));
  app.use(rejectOperatorKeys);

  const sessionService = new SessionService(policyFromEnv(env));
  const authService = new AuthService({ env, sessions: sessionService, email: deps.email });
  app.use(attachAuth(env, sessionService));

  const router = Router();
  const registrar = createRegistrar({
    router,
    basePath: API_BASE,
    allowedOrigins: env.ALLOWED_ORIGINS,
    limiters: makeLimiters({ enabled: env.RATE_LIMIT_ENABLED, overrides: deps.limiters }),
  });

  registerAuthRoutes(registrar, { env, auth: authService, sessions: sessionService });
  registerSchoolRoutes(registrar);
  registerUserRoutes(registrar, { env, email: deps.email, sessions: sessionService });
  registerAuditRoutes(registrar);
  registerAcademicsRoutes(registrar);
  registerStaffRoutes(registrar);
  registerStudentRoutes(registrar);
  registerAttendanceRoutes(registrar);
  registerImportRoutes(registrar);
  registerFeeRoutes(registrar);
  registerNoticeRoutes(registrar);
  registerParentRoutes(registrar);
  registerExamRoutes(registrar);
  registerPromotionRoutes(registrar);
  registerPlatformRoutes(registrar, { env, email: deps.email });
  registerStudentPortalRoutes(registrar);
  registerTimetableRoutes(registrar);
  registerSchoolCalendarRoutes(registrar);
  registerHomeworkRoutes(registrar, new HomeworkService({ env, storage: deps.storage ?? createStorage(env) }));
  registerNoticeJobs(deps.email);

  app.use(API_BASE, router);
  app.use(notFoundHandler());
  app.use(errorHandler(logger));
  return { app, registrar, sessions: sessionService, auth: authService };
}
