import type { EmailRepository, InboundEmail } from "../repositories/email.repository.js";
import type { MailSource } from "../utils/gmail.js";

const MINUTE_MS = 60 * 1000;
// With an empty table, the first poll picks up the last day of mail.
export const FIRST_POLL_LOOKBACK_MS = 24 * 60 * MINUTE_MS;
// Each poll looks back this far before the newest stored email: Gmail's after: is whole seconds and its search index
// can lag delivery. Messages already stored are skipped before they are fetched.
export const POLL_OVERLAP_MS = 10 * MINUTE_MS;

// Copies new inbox messages from the mailbox into inbound_emails. Resumes from the database, so a restart neither
// loses nor repeats mail, and several instances can poll at once (the insert is a no-op for a stored message).
export class EmailPollerService {
  private mailbox: string | undefined;
  private running: Promise<number> | undefined;

  constructor(
    private readonly source: MailSource,
    private readonly emails: EmailRepository,
  ) {}

  // Returns how many emails were stored. A poll still in flight is shared rather than started twice.
  poll(now = Date.now()) {
    this.running ??= this.pollOnce(now).finally(() => (this.running = undefined));
    return this.running;
  }

  private async pollOnce(now: number) {
    this.mailbox ??= await this.source.address();
    const latest = await this.emails.latestReceivedAt();
    const since = latest ? new Date(latest.getTime() - POLL_OVERLAP_MS) : new Date(now - FIRST_POLL_LOOKBACK_MS);

    const fresh: string[] = [];
    for (const id of await this.source.listSince(since)) if (!(await this.emails.has(id))) fresh.push(id);

    // Everything is fetched before anything is stored, then stored oldest first: if a poll fails part way, the newest
    // stored email (the next poll's starting point) is never later than an email that was missed.
    const fetched: Omit<InboundEmail, "mailbox">[] = [];
    for (const id of fresh) {
      const email = await this.source.fetch(id);
      if (email) fetched.push(email);
    }
    fetched.sort((a, b) => a.receivedAt.getTime() - b.receivedAt.getTime());

    let stored = 0;
    for (const email of fetched) if (await this.emails.insert({ ...email, mailbox: this.mailbox })) stored++;
    return stored;
  }

  // Polls now and then every intervalMs, running afterPoll (the email agent) once each poll settles; returns a stop
  // function. Failures are logged and retried next time.
  schedule(intervalMs: number, afterPoll?: () => Promise<unknown>) {
    const tick = () =>
      this.poll()
        .then(
          (stored) => {
            if (stored) console.log(`email poller: stored ${stored} new email${stored === 1 ? "" : "s"}`);
          },
          (err) => console.error("email poll failed", err),
        )
        .then(afterPoll)
        .catch((err) => console.error("email after-poll step failed", err));
    void tick();
    const timer = setInterval(tick, intervalMs);
    // Never keeps the process alive on its own.
    timer.unref();
    return () => clearInterval(timer);
  }
}
