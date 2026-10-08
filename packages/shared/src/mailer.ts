export interface Email {
  to: string;
  subject: string;
  text: string;
}

/** Outbound email. Swap transports via `createMailer`; tests use MemoryMailer. */
export interface Mailer {
  send(email: Email): Promise<void>;
}

/** Dev default: prints the email (including the sign-in code) to the log. */
export class ConsoleMailer implements Mailer {
  constructor(private readonly log: (line: string) => void = console.log) {}
  async send(email: Email) {
    this.log(`[mail] to=${email.to} subject=${email.subject}\n${email.text}`);
  }
}

/** Tests: captures sent mail. */
export class MemoryMailer implements Mailer {
  readonly outbox: Email[] = [];
  async send(email: Email) {
    this.outbox.push(email);
  }
  /** Last 6-digit code sent to `to`. */
  lastCode(to: string): string | undefined {
    const mail = [...this.outbox].reverse().find((m) => m.to === to);
    return mail?.text.match(/\b(\d{6})\b/)?.[1];
  }
}

/** Resend (https://resend.com) transport; selected with EMAIL_PROVIDER=resend. Not exercised against the live API. */
export class ResendMailer implements Mailer {
  constructor(
    private readonly apiKey: string,
    private readonly from: string,
    private readonly doFetch: typeof fetch = fetch,
  ) {}
  async send(email: Email) {
    const res = await this.doFetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { authorization: `Bearer ${this.apiKey}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        from: this.from,
        to: email.to,
        subject: email.subject,
        text: email.text,
      }),
    });
    if (!res.ok) throw new Error(`resend failed: HTTP ${res.status}`);
  }
}

export function createMailer(
  env: { EMAIL_PROVIDER: 'console' | 'resend'; RESEND_API_KEY?: string; EMAIL_FROM: string },
  log?: (line: string) => void,
): Mailer {
  if (env.EMAIL_PROVIDER === 'resend') {
    if (!env.RESEND_API_KEY) throw new Error('RESEND_API_KEY required when EMAIL_PROVIDER=resend');
    return new ResendMailer(env.RESEND_API_KEY, env.EMAIL_FROM);
  }
  return new ConsoleMailer(log);
}
