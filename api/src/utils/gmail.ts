import { auth, gmail } from "@googleapis/gmail";
import type { InboundEmail } from "../repositories/email.repository.js";

export interface GoogleOAuthConfig {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
}

// What the poller needs from a mailbox; Gmail in production, a fake in tests.
export interface MailSource {
  // The mailbox's own address.
  address(): Promise<string>;
  // Ids of inbox messages received at or after `since`, in any order.
  listSince(since: Date): Promise<string[]>;
  // null when the message was deleted after it was listed.
  fetch(messageId: string): Promise<Omit<InboundEmail, "mailbox"> | null>;
}

// Reads the mailbox the refresh token was issued for (scope gmail.readonly is enough).
export function createGmailSource({ clientId, clientSecret, refreshToken }: GoogleOAuthConfig): MailSource {
  const oauth = new auth.OAuth2(clientId, clientSecret);
  oauth.setCredentials({ refresh_token: refreshToken });
  const client = gmail({ version: "v1", auth: oauth });

  return {
    async address() {
      const { data } = await client.users.getProfile({ userId: "me" });
      if (!data.emailAddress) throw new Error("Gmail profile has no email address");
      return data.emailAddress;
    },

    async listSince(since) {
      const ids: string[] = [];
      let pageToken: string | undefined;
      do {
        const { data } = await client.users.messages.list({
          userId: "me",
          q: `in:inbox after:${Math.floor(since.getTime() / 1000)}`,
          maxResults: 100,
          pageToken,
        });
        for (const message of data.messages ?? []) if (message.id) ids.push(message.id);
        pageToken = data.nextPageToken ?? undefined;
      } while (pageToken);
      return ids;
    },

    async fetch(messageId) {
      const response = await client.users.messages
        .get({ userId: "me", id: messageId, format: "full" })
        .catch((err: { status?: number }) => {
          if (err.status === 404) return null;
          throw err;
        });
      if (!response) return null;
      const { data } = response;
      const headers = data.payload?.headers ?? [];
      const header = (name: string) => headers.find((h) => h.name?.toLowerCase() === name.toLowerCase())?.value ?? null;
      return {
        messageId,
        threadId: data.threadId ?? null,
        from: header("From") ?? "",
        subject: header("Subject") ?? "",
        snippet: data.snippet ?? "",
        body: data.payload ? extractBody(data.payload) : "",
        dateHeader: header("Date"),
        receivedAt: data.internalDate ? new Date(Number(data.internalDate)) : new Date(),
      };
    },
  };
}

// The subset of Gmail's MessagePart that body extraction reads.
export interface MessagePart {
  mimeType?: string | null;
  filename?: string | null;
  body?: { data?: string | null } | null;
  parts?: MessagePart[] | null;
}

// The message's text: its text/plain parts, else its text/html parts with the markup stripped. Attachments are skipped.
export function extractBody(payload: MessagePart) {
  const plain: string[] = [];
  const html: string[] = [];
  const walk = (part: MessagePart) => {
    if (part.filename) return;
    const data = part.body?.data;
    if (data && part.mimeType === "text/plain") plain.push(decode(data));
    else if (data && part.mimeType === "text/html") html.push(decode(data));
    for (const child of part.parts ?? []) walk(child);
  };
  walk(payload);
  return (plain.length ? plain.join("\n\n") : html.map(htmlToText).join("\n\n")).trim();
}

const decode = (data: string) => Buffer.from(data, "base64url").toString("utf8");

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };

function htmlToText(html: string) {
  return html
    .replace(/<(style|script|head)[^>]*>[\s\S]*?<\/\1>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li|tr|h[1-6])>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&(#\d+|#x[\da-f]+|\w+);/gi, (match, code: string) => {
      if (code[0] !== "#") return ENTITIES[code.toLowerCase()] ?? match;
      const point = code[1].toLowerCase() === "x" ? parseInt(code.slice(2), 16) : Number(code.slice(1));
      return point <= 0x10ffff ? String.fromCodePoint(point) : match;
    })
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n");
}
