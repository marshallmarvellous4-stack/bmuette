import { Global, Inject, Injectable, Logger, Module } from '@nestjs/common';
import { ENV, Env } from '../config/env';
import { Db } from '../db/db.service';

// Sends email. "log" mode (development) only records the message in the email_outbox table, where the
// admin dashboard shows it, so you can read verification codes without an email provider.
// "resend" mode sends through Resend (https://resend.com). Sending never throws: a mail outage must not break sign-up.
@Injectable()
export class Mailer {
  private log = new Logger('Mailer');
  constructor(private db: Db, @Inject(ENV) private env: Env) {}

  async send(to: string, subject: string, body: string): Promise<boolean> {
    let status = 'sent';
    try {
      if (this.env.EMAIL_DRIVER === 'resend') {
        const res = await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: { Authorization: `Bearer ${this.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ from: this.env.EMAIL_FROM, to: [to], subject, text: body }),
        });
        if (!res.ok) { status = `failed ${res.status}`; this.log.error(`resend ${res.status}: ${(await res.text()).slice(0, 200)}`); }
      } else {
        this.log.log(`[email to ${to}] ${subject}`);
      }
    } catch (e) {
      status = 'failed';
      this.log.error(`send failed: ${(e as Error).message}`);
    }
    await this.db.query(`insert into email_outbox (to_email, subject, body, driver, status) values ($1,$2,$3,$4,$5)`, [to, subject, body, this.env.EMAIL_DRIVER, status]).catch(() => undefined);
    return status === 'sent';
  }
}

@Global()
@Module({ providers: [Mailer], exports: [Mailer] })
export class MailModule {}
