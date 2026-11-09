import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Logger } from '../logging/logger';

export interface EmailMessage {
  to: string;
  subject: string;
  text: string;
}

export type EmailResult = { status: 'sent_dev' | 'disabled' | 'sent' };

/** Provider-independent email port (doc 04 §7). Real providers are added later behind this interface. */
export interface EmailAdapter {
  readonly name: string;
  send(msg: EmailMessage): Promise<EmailResult>;
}

/**
 * Development adapter: keeps messages in memory (for tests) and writes them to `.data/mail/` (git-ignored).
 * It NEVER pretends delivery happened: status is `sent_dev`, not `delivered`. Message bodies (which contain
 * one-time links) are not written to the application log.
 */
export class DevEmailAdapter implements EmailAdapter {
  readonly name = 'dev-outbox';
  readonly outbox: EmailMessage[] = [];
  constructor(private readonly log?: Logger, private readonly dir: string | null = join(process.cwd(), '.data', 'mail')) {}

  async send(msg: EmailMessage): Promise<EmailResult> {
    this.outbox.push(msg);
    this.log?.info({ to: msg.to, subject: msg.subject }, 'dev email captured (not delivered)');
    if (this.dir) {
      try {
        await mkdir(this.dir, { recursive: true });
        await writeFile(join(this.dir, `${Date.now()}-${Math.random().toString(36).slice(2, 8)}.txt`), `To: ${msg.to}\nSubject: ${msg.subject}\n\n${msg.text}\n`);
      } catch {
        /* dev convenience only */
      }
    }
    return { status: 'sent_dev' };
  }

  lastTo(to: string): EmailMessage | undefined {
    return [...this.outbox].reverse().find((m) => m.to === to);
  }
}

export class DisabledEmailAdapter implements EmailAdapter {
  readonly name = 'disabled';
  async send(): Promise<EmailResult> {
    return { status: 'disabled' };
  }
}
