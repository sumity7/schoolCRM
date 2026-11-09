import { pino, type Logger } from 'pino';

/** Redaction list: never log credentials, tokens, cookies or payment fields (doc 04 §9). */
export const REDACT_PATHS = [
  'password',
  'newPassword',
  'currentPassword',
  'token',
  'passwordHash',
  'tokenHash',
  'authorization',
  'cookie',
  'set-cookie',
  'req.headers.authorization',
  'req.headers.cookie',
  'res.headers["set-cookie"]',
  '*.password',
  '*.newPassword',
  '*.currentPassword',
  '*.token',
  '*.passwordHash',
  '*.tokenHash',
  '*.authorization',
  '*.cookie',
  'cardNumber',
  'cvv',
];

export function createLogger(level: string = 'info', destination?: NodeJS.WritableStream): Logger {
  return pino(
    {
      level,
      redact: { paths: REDACT_PATHS, censor: '[REDACTED]' },
      base: { service: 'edunex-api' },
      timestamp: pino.stdTimeFunctions.isoTime,
    },
    destination as never,
  );
}

export type { Logger };
