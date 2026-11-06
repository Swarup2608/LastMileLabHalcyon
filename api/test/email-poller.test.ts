// Gmail poller against an in-memory Postgres (pg-mem) and a fake mailbox; never touches Gmail or DATABASE_URL.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { beforeEach, describe, test } from "node:test";
import { newDb } from "pg-mem";
import type { Pool } from "pg";
import { EmailRepository, type InboundEmail } from "../src/repositories/email.repository.js";
import { EmailPollerService, FIRST_POLL_LOOKBACK_MS, POLL_OVERLAP_MS } from "../src/services/email-poller.service.js";
import { EmailAgentService } from "../src/services/email-agent.service.js";
import type { EmailAgent } from "../src/utils/foundry.js";
import { extractBody, type MailSource } from "../src/utils/gmail.js";

const NOW = Date.parse("2026-10-29T12:00:00Z");
const MINUTE = 60 * 1000;

type Message = Omit<InboundEmail, "mailbox">;
const message = (id: string, minutesAgo: number): Message => ({
  messageId: id,
  threadId: `t-${id}`,
  from: `Sender ${id} <${id}@example.com>`,
  subject: `Subject ${id}`,
  snippet: `Snippet ${id}`,
  body: `Full body of ${id}.\nSecond line.`,
  dateHeader: "Thu, 29 Oct 2026 12:00:00 +0000",
  receivedAt: new Date(NOW - minutesAgo * MINUTE),
});

// Lists like Gmail (newest first, filtered by `since`) and records what was asked of it.
class FakeMailbox implements MailSource {
  messages: Message[] = [];
  sinceCalls: Date[] = [];
  fetched: string[] = [];
  failOn: string | undefined;

  async address() {
    return "inbox@example.com";
  }
  async listSince(since: Date) {
    this.sinceCalls.push(since);
    return this.messages
      .filter((m) => m.receivedAt >= since)
      .sort((a, b) => b.receivedAt.getTime() - a.receivedAt.getTime())
      .map((m) => m.messageId);
  }
  async fetch(id: string) {
    if (id === this.failOn) throw new Error(`fetch ${id} failed`);
    this.fetched.push(id);
    return this.messages.find((m) => m.messageId === id) ?? null;
  }
}

let mailbox: FakeMailbox;
let emails: EmailRepository;
let poller: EmailPollerService;

beforeEach(() => {
  const mem = newDb();
  mem.public.none(readFileSync(new URL("../../db/init/05_inbound_emails.sql", import.meta.url), "utf8"));
  // order_requests references clients; the poller never touches either.
  mem.public.none(`CREATE TABLE clients (client_id TEXT PRIMARY KEY)`);
  mem.public.none(readFileSync(new URL("../../db/init/06_order_requests.sql", import.meta.url), "utf8"));
  mem.public.none(readFileSync(new URL("../../db/init/13_ignored_orders.sql", import.meta.url), "utf8"));
  const { Pool: MemPool } = mem.adapters.createPg();
  mailbox = new FakeMailbox();
  emails = new EmailRepository(new MemPool() as Pool);
  poller = new EmailPollerService(mailbox, emails);
});

describe("email poller", () => {
  test("first poll looks back a day and stores each email with the mailbox address", async () => {
    mailbox.messages = [message("a", 5), message("b", 60)];
    assert.equal(await poller.poll(NOW), 2);
    assert.equal(mailbox.sinceCalls[0].getTime(), NOW - FIRST_POLL_LOOKBACK_MS);

    const { rows, total } = await emails.list({ limit: 10, offset: 0 });
    assert.equal(total, 2);
    assert.deepEqual(rows.map((r) => r.message_id), ["a", "b"]);
    assert.equal(rows[0].mailbox, "inbox@example.com");
    assert.equal(rows[0].from_address, "Sender a <a@example.com>");
  });

  test("later polls resume just before the newest stored email and never refetch or duplicate", async () => {
    mailbox.messages = [message("a", 30)];
    await poller.poll(NOW);
    mailbox.messages.push(message("b", 1));
    mailbox.fetched = [];

    assert.equal(await poller.poll(NOW), 1);
    assert.equal(mailbox.sinceCalls[1].getTime(), NOW - 30 * MINUTE - POLL_OVERLAP_MS);
    assert.deepEqual(mailbox.fetched, ["b"]);
    assert.equal(await poller.poll(NOW), 0);
    assert.equal((await emails.list({ limit: 10, offset: 0 })).total, 2);
  });

  test("a failed fetch stores nothing, so the next poll still finds every email", async () => {
    mailbox.messages = [message("old", 20), message("new", 1)];
    mailbox.failOn = "old";
    await assert.rejects(poller.poll(NOW), /fetch old failed/);
    assert.equal((await emails.list({ limit: 10, offset: 0 })).total, 0);

    mailbox.failOn = undefined;
    assert.equal(await poller.poll(NOW), 2);
  });

  test("a message deleted after it was listed is skipped", async () => {
    mailbox.messages = [message("a", 5)];
    mailbox.listSince = async () => ["a", "gone"];
    assert.equal(await poller.poll(NOW), 1);
  });

  test("new emails are stored unread by the agent", async () => {
    mailbox.messages = [message("a", 5)];
    await poller.poll(NOW);
    const [row] = (await emails.list({ limit: 10, offset: 0 })).rows;
    assert.equal(row.read_by_ai, false);
    assert.equal(row.ai_result, null);
    assert.equal(row.body, "Full body of a.\nSecond line.");
  });

  test("overlapping polls share one run", async () => {
    mailbox.messages = [message("a", 5)];
    const [first, second] = await Promise.all([poller.poll(NOW), poller.poll(NOW)]);
    assert.equal(first, 1);
    assert.equal(second, 1);
    assert.equal(mailbox.sinceCalls.length, 1);
  });
});

const b64 = (text: string) => Buffer.from(text).toString("base64url");

describe("extractBody", () => {
  test("prefers text/plain parts and skips attachments", () => {
    const body = extractBody({
      mimeType: "multipart/mixed",
      parts: [
        {
          mimeType: "multipart/alternative",
          parts: [
            { mimeType: "text/plain", body: { data: b64("Hello Zoë,\nyour order shipped.") } },
            { mimeType: "text/html", body: { data: b64("<p>Hello</p>") } },
          ],
        },
        { mimeType: "text/plain", filename: "notes.txt", body: { data: b64("attachment text") } },
      ],
    });
    assert.equal(body, "Hello Zoë,\nyour order shipped.");
  });

  test("falls back to HTML with tags, styles and entities handled", () => {
    const html = "<html><head><style>p{}</style></head><body><p>Order &amp; invoice</p><div>Total:&nbsp;&#36;5<br>Thanks</div></body></html>";
    assert.equal(extractBody({ mimeType: "text/html", body: { data: b64(html) } }), "Order & invoice\nTotal: $5\nThanks");
  });

  test("a message with no text parts has an empty body", () => {
    assert.equal(extractBody({ mimeType: "multipart/mixed", parts: [] }), "");
  });
});

// Replies with JSON naming the message, or fails for ids in failOn.
class FakeAgent implements EmailAgent {
  asked: string[] = [];
  messages: string[] = [];
  failOn = new Set<string>();

  async ask(text: string) {
    const id = /Message ID: (\S+)/.exec(text)![1];
    this.asked.push(id);
    this.messages.push(text);
    if (this.failOn.has(id)) throw new Error(`agent failed on ${id}`);
    return { agent: "fake-agent", conversationId: `conv-${id}`, output: { verdict: "ok", id } };
  }
}

describe("email agent", () => {
  let agent: FakeAgent;
  let service: EmailAgentService;
  const row = async (id: string) => (await emails.list({ limit: 10, offset: 0 })).rows.find((r) => r.message_id === id)!;

  beforeEach(() => {
    agent = new FakeAgent();
    service = new EmailAgentService(agent, emails);
  });

  test("sends every unread email, oldest first, and stores the reply as JSON", async () => {
    mailbox.messages = [message("new", 1), message("old", 30)];
    await poller.poll(NOW);

    assert.deepEqual(await service.analyzePending(), { analyzed: 2, failed: 0 });
    assert.deepEqual(agent.asked, ["old", "new"]);
    assert.match(agent.messages[0], /Body:\nFull body of old\.\nSecond line\./);
    const stored = await row("old");
    assert.equal(stored.read_by_ai, true);
    assert.deepEqual(stored.ai_result, { agent: "fake-agent", conversationId: "conv-old", output: { verdict: "ok", id: "old" } });
    assert.ok(stored.ai_read_at);

    // Nothing left to read.
    assert.deepEqual(await service.analyzePending(), { analyzed: 0, failed: 0 });
    assert.equal(agent.asked.length, 2);
  });

  test("a failed call leaves that email unread for the next run and doesn't stop the others", async () => {
    mailbox.messages = [message("a", 10), message("b", 5)];
    await poller.poll(NOW);
    agent.failOn.add("a");

    assert.deepEqual(await service.analyzePending(), { analyzed: 1, failed: 1 });
    assert.equal((await row("a")).read_by_ai, false);
    assert.equal((await row("b")).read_by_ai, true);
    const listed = await emails.list({ limit: 10, offset: 0 });
    assert.deepEqual([listed.total, listed.analyzed], [2, 1]);

    agent.failOn.clear();
    assert.deepEqual(await service.analyzePending(), { analyzed: 1, failed: 0 });
    assert.equal((await row("a")).read_by_ai, true);
  });
});
