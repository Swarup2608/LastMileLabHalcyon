import nodemailer from "nodemailer";

export interface MailerConfig {
  host: string;
  port: number;
  // true: TLS from the start (465); false: STARTTLS.
  secure: boolean;
  auth?: { user: string; pass: string };
  from: string;
  // Where clients' emailed orders go: the mailbox the Gmail poller reads.
  orderInbox: string;
}

export interface OutgoingMail {
  to: string;
  replyTo?: string;
  subject: string;
  text: string;
}

// Sends mail; an interface so tests can record what would have gone out.
export interface Mailer {
  readonly orderInbox: string;
  send(mail: OutgoingMail): Promise<{ messageId: string }>;
}

// An SMTP mailer through nodemailer, from config.from.
export function createMailer(config: MailerConfig): Mailer {
  const transport = nodemailer.createTransport({ host: config.host, port: config.port, secure: config.secure, auth: config.auth });
  return {
    orderInbox: config.orderInbox,
    async send(mail) {
      const info = await transport.sendMail({ from: config.from, ...mail });
      return { messageId: info.messageId };
    },
  };
}
