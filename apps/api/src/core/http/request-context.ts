import { AsyncLocalStorage } from 'node:async_hooks';

export interface RequestMeta {
  requestId: string;
  ip?: string;
  userAgent?: string;
}

const als = new AsyncLocalStorage<RequestMeta>();

export function runWithRequestMeta<T>(meta: RequestMeta, fn: () => T): T {
  return als.run(meta, fn);
}
export function currentRequestMeta(): RequestMeta | undefined {
  return als.getStore();
}
