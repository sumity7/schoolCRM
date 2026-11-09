import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import argon2 from 'argon2';

/** Argon2id with OWASP-recommended parameters; cheaper only under NODE_ENV=test for speed. */
const PROD_PARAMS = { type: argon2.argon2id, memoryCost: 19456, timeCost: 2, parallelism: 1 } as const;
const TEST_PARAMS = { type: argon2.argon2id, memoryCost: 1024, timeCost: 2, parallelism: 1 } as const;

function params() {
  return process.env.NODE_ENV === 'test' ? TEST_PARAMS : PROD_PARAMS;
}

export async function hashPassword(plain: string): Promise<string> {
  return argon2.hash(plain, params());
}

let dummyHash: Promise<string> | undefined;
/** Verifies against a dummy hash when the user doesn't exist, to equalise timing (no user enumeration). */
export async function verifyPassword(hash: string | undefined | null, plain: string): Promise<boolean> {
  if (!hash) {
    dummyHash ??= hashPassword('dummy-password-for-timing-equalisation');
    await argon2.verify(await dummyHash, plain).catch(() => false);
    return false;
  }
  try {
    return await argon2.verify(hash, plain);
  } catch {
    return false;
  }
}

/** 256-bit random opaque token (URL/cookie safe). */
export function newToken(): string {
  return randomBytes(32).toString('base64url');
}

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}
