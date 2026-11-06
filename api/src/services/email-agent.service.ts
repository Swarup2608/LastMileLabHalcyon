import type { EmailRepository } from "../repositories/email.repository.js";
import type { EmailAgent } from "../utils/foundry.js";

export interface MailToRead {
  mailbox: string;
  messageId: string;
  from: string | null;
  subject: string | null;
  date: string | null;
  // null: only Gmail's snippet was stored.
  body: string | null;
  snippet?: string | null;
}

const promptFor = (m: MailToRead) =>
  [
    "A new email was received.",
    `Mailbox: ${m.mailbox}`,
    `Message ID: ${m.messageId}`,
    `From: ${m.from || "Unknown"}`,
    `Subject: ${m.subject || "(no subject)"}`,
    `Date: ${m.date ?? "(unknown)"}`,
    // Emails stored before the body column existed only have Gmail's snippet.
    m.body === null ? `Body (Gmail snippet only): ${m.snippet || "(empty)"}` : `Body:\n${m.body || "(empty)"}`,
    "Analyze this email according to your configured agent instructions.",
  ].join("\n");

// Sends every email with read_by_ai = false to the Foundry agent and stores its reply in ai_result. An email whose call
// fails stays unread and is retried on the next run; the others still go through.
export class EmailAgentService {
  private running: Promise<{ analyzed: number; failed: number }> | undefined;

  constructor(
    private readonly agent: EmailAgent,
    private readonly emails: EmailRepository,
  ) {}

  // A run still in flight is shared rather than started twice.
  analyzePending() {
    this.running ??= this.analyzeOnce().finally(() => (this.running = undefined));
    return this.running;
  }

  // What the agent makes of an email it is handed, without storing it: the web simulation's live view.
  async preview(mail: MailToRead) {
    return this.agent.ask(promptFor(mail));
  }

  private async analyzeOnce() {
    let analyzed = 0;
    let failed = 0;
    for (const row of await this.emails.listUnreadByAi()) {
      try {
        const reply = await this.agent.ask(
          promptFor({ ...row, from: row.from_address, date: row.date_header, messageId: row.message_id }),
        );
        if (await this.emails.markReadByAi(row.message_id, reply)) analyzed++;
      } catch (err) {
        failed++;
        console.error(`email agent: ${row.message_id} failed`, err);
      }
    }
    return { analyzed, failed };
  }
}
