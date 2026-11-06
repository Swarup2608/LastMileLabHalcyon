import type { Queryable } from "../db/transaction.js";
import type { CreateOrderBody } from "../schemas/emails.schema.js";
import { expectedDelivery, type DeliveryRule } from "../utils/delivery.js";
import { DUPLICATE_WINDOW_DAYS, emailFingerprint, isBlank, noOrderFound, type IgnoredReason } from "../utils/order-screen.js";
import { oversizedQuantities } from "../utils/agent-json.js";

export interface InboundEmail {
  messageId: string;
  threadId: string | null;
  mailbox: string;
  from: string;
  subject: string;
  snippet: string;
  body: string;
  dateHeader: string | null;
  receivedAt: Date;
}

interface EmailRow {
  message_id: string;
  thread_id: string | null;
  mailbox: string;
  from_address: string;
  subject: string;
  snippet: string;
  // NULL for emails stored before the column existed.
  body: string | null;
  date_header: string | null;
  received_at: Date;
  ingested_at: Date;
  read_by_ai: boolean;
  ai_result: unknown;
  ai_read_at: Date | null;
  // From order_requests; NULL when staff haven't touched the request.
  client_set: boolean | null;
  client_id: string | null;
  edits: Record<string, unknown> | null;
  intake_at: Date | null;
  // Set once when staff assign the order to a carrier (see assignmentOf).
  assigned_carrier: string | null;
  assigned_at: Date | null;
  delivered_at: Date | null;
  // "api" rows are order_requests placed through the API, with no email: their order is order_payload.
  channel: "email" | "api";
  order_payload: ApiOrderPayload | null;
  // Set aside out of the queue (see utils/order-screen.ts); NULL while it's in the queue. Always NULL for API orders.
  ignored_reason: IgnoredReason | null;
  duplicate_of: string | null;
  ignored_at: Date | null;
  kept_by_staff: boolean | null;
}

// An API order as stored: the email agent's reply shape, so the web app reads it like an emailed one.
export interface ApiOrderPayload {
  // "Name <email>" of the client user who placed it.
  placedBy: string;
  customer: string | null;
  reference: string | null;
  notes: string | null;
  products: { sku: string; quantity: number }[];
  address: string;
  suite: string | null;
  city: string;
  state: string;
  postal_code: string;
  country: string | null;
}

type AssignmentRow = Pick<EmailRow, "assigned_carrier" | "assigned_at" | "delivered_at">;

// The carrier an order was assigned to; delivered once delivered_at has passed. null while it has none.
export const assignmentOf = (row: AssignmentRow, now = new Date()) =>
  row.assigned_carrier && row.assigned_at && row.delivered_at
    ? { carrier: row.assigned_carrier, assignedAt: row.assigned_at, deliveredAt: row.delivered_at, delivered: new Date(row.delivered_at) <= now }
    : null;

// A client login, for telling which client an email is from.
export interface ClientLogin {
  email: string;
  clientId: string;
}

// The client whose login sent the email, else the first whose login is written in the body.
export function matchClient(row: Pick<EmailRow, "from_address" | "body">, logins: ClientLogin[]) {
  const sender = (/<([^>]+)>/.exec(row.from_address)?.[1] ?? row.from_address).trim().toLowerCase();
  const fromSender = logins.find((l) => l.email === sender);
  if (fromSender) return fromSender.clientId;
  const body = (row.body ?? "").toLowerCase();
  const inBody = logins
    .map((l) => ({ l, at: body.indexOf(l.email) }))
    .filter((m) => m.at !== -1)
    .sort((a, b) => a.at - b.at)[0];
  return inBody?.l.clientId ?? null;
}

// The request's client: staff's choice once they made one (null = unlinked), else the one matchClient finds.
export const clientOf = (row: EmailRow, logins: ClientLogin[]) => (row.client_set ? row.client_id : matchClient(row, logins));

// The new delivery date the client accepted after a stock problem (edits.stockFlag, set by staff on Resolve).
function acceptedDate(edits: Record<string, unknown> | null) {
  const flag = edits?.stockFlag as { status?: unknown; newDate?: unknown } | undefined;
  return flag?.status === "accepted" && typeof flag.newDate === "string" && /^\d{4}-\d{2}-\d{2}$/.test(flag.newDate) ? flag.newDate : null;
}

// An API order's "email": who placed it, its reference, and the order as JSON in place of a body.
// What's stored for an order placed through the API, by a signed-in client or from the marketplace.
export const toApiOrderPayload = (
  { reference, customer, notes, address }: Omit<CreateOrderBody, "lines">,
  products: ApiOrderPayload["products"],
  placedBy: string,
  fallbackCustomer: string | null,
): ApiOrderPayload => ({
  placedBy,
  customer: customer ?? fallbackCustomer,
  reference: reference ?? null,
  notes: notes ?? null,
  products,
  address: address.street,
  suite: address.suite ?? null,
  city: address.city,
  state: address.region,
  postal_code: address.postal,
  country: address.country ?? null,
});

const apiOrderText = (p: ApiOrderPayload) => ({
  from: p.placedBy,
  subject: p.reference ? `API order ${p.reference}` : "API order",
  snippet: p.products.map((l) => `${l.quantity} × ${l.sku}`).join(", "),
  body: JSON.stringify(p, null, 2),
});

export const toEmailDto = (row: EmailRow, logins: ClientLogin[], rule: DeliveryRule) => ({
  id: row.message_id,
  channel: row.channel,
  threadId: row.thread_id,
  mailbox: row.mailbox,
  from: row.from_address,
  subject: row.subject,
  snippet: row.snippet,
  body: row.body,
  ...(row.order_payload ? apiOrderText(row.order_payload) : {}),
  date: row.date_header,
  receivedAt: row.received_at,
  ingestedAt: row.ingested_at,
  readByAi: row.read_by_ai,
  // An API order needs no reading: its payload is already in the agent's shape.
  aiResult: row.order_payload ? { agent: "Halcyon API", conversationId: row.message_id, output: row.order_payload } : row.ai_result,
  aiReadAt: row.ai_read_at,
  // Quantities the agent read that no order line can hold; staff settle these on Resolve.
  quantityWarnings: row.order_payload ? [] : oversizedQuantities((row.ai_result as { output?: unknown } | null)?.output),
  // The client found from the sender or body, before any staff choice.
  matchedClientId: row.channel === "api" ? row.client_id : matchClient(row, logins),
  // Staff's work on the request (RequestEdits in the web app), with the client link as clientId when they set it and
  // the order intake time as intakeAt once it has one.
  edits: row.edits
    ? {
        ...row.edits,
        ...(row.client_set ? { clientId: row.client_id } : {}),
        ...(row.intake_at ? { intakeAt: new Date(row.intake_at).toISOString() } : {}),
      }
    : null,
  // Same day when received before the admin's cutoff, else the next day; the new date once the client accepted one.
  expectedDelivery: expectedDelivery(row.received_at, rule, acceptedDate(row.edits)),
  carrier: assignmentOf(row),
  // Why it's out of the queue, and for a repeat the email it repeats; null while it's in the queue.
  ignored: row.ignored_reason ? { reason: row.ignored_reason, duplicateOf: row.duplicate_of, at: row.ignored_at } : null,
});

// Every order request, emailed or placed through the API, as rows of one shape: an API order stands in for an email
// that the agent has already read (its text is filled in by toEmailDto).
const FROM = `(
  SELECT e.message_id, e.thread_id, e.mailbox, e.from_address, e.subject, e.snippet, e.body, e.date_header,
    e.received_at, e.ingested_at, e.read_by_ai, e.ai_result, e.ai_read_at, r.client_set, r.client_id, r.edits,
    r.intake_at, r.assigned_carrier, r.assigned_at, r.delivered_at, 'email' AS channel, NULL::jsonb AS order_payload, e.ignored_reason, e.duplicate_of, e.ignored_at,
    e.kept_by_staff
  FROM inbound_emails e LEFT JOIN order_requests r ON r.message_id = e.message_id
  UNION ALL
  SELECT r.request_id, NULL, 'api', '', '', '', NULL, NULL,
    r.created_at, r.created_at, true, NULL, r.created_at, r.client_set, r.client_id, r.edits,
    r.intake_at, r.assigned_carrier, r.assigned_at, r.delivered_at, r.channel, r.order_payload, NULL, NULL, NULL::timestamptz, NULL::boolean
  FROM order_requests r WHERE r.channel = 'api'
) AS e`;
// Requests still in the queue: what the carrier plan, the stock-out log, the agent and clients work from.
const QUEUED = "e.ignored_reason IS NULL";
const COLUMNS = "e.*";

// Written by the Gmail poller (EmailPollerService) and the email agent (EmailAgentService); read by staff.
export class EmailRepository {
  constructor(private readonly db: Queryable) {}

  async has(messageId: string) {
    const { rowCount } = await this.db.query(`SELECT 1 FROM inbound_emails WHERE message_id = $1`, [messageId]);
    return (rowCount ?? 0) > 0;
  }

  // Returns false when the message was already stored (another instance, or an overlapping poll, got there first). A
  // blank email, or a repeat of one received in the last DUPLICATE_WINDOW_DAYS, is stored already ignored.
  async insert(email: InboundEmail) {
    const fingerprint = emailFingerprint(email.from, email.subject, email.body, email.snippet);
    let reason: IgnoredReason | null = isBlank(email.body, email.snippet) ? "blank" : null;
    let original: string | null = null;
    if (!reason) {
      const { rows } = await this.db.query<{ message_id: string }>(
        `SELECT message_id FROM inbound_emails
         WHERE fingerprint = $1 AND message_id <> $2 AND received_at <= $3 AND received_at >= $4
         ORDER BY received_at ASC LIMIT 1`,
        [fingerprint, email.messageId, email.receivedAt, new Date(email.receivedAt.getTime() - DUPLICATE_WINDOW_DAYS * 86_400_000)],
      );
      original = rows[0]?.message_id ?? null;
      if (original) reason = "duplicate";
    }
    const { rowCount } = await this.db.query(
      `INSERT INTO inbound_emails (message_id, thread_id, mailbox, from_address, subject, snippet, body, date_header, received_at,
         fingerprint, ignored_reason, duplicate_of, ignored_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, CASE WHEN $11::text IS NULL THEN NULL ELSE now() END)
       ON CONFLICT (message_id) DO NOTHING`,
      [
        email.messageId,
        email.threadId,
        email.mailbox,
        email.from,
        email.subject,
        email.snippet,
        email.body,
        email.dateHeader,
        email.receivedAt,
        fingerprint,
        reason,
        original,
      ],
    );
    return (rowCount ?? 0) > 0;
  }

  // Staff taking a request out of the queue (ignore) or putting it back (restore). A restored email is kept: Halcyon
  // doesn't ignore it again. Returns false when there's no such email.
  async setIgnored(messageId: string, ignore: boolean, by: string) {
    const { rowCount } = await this.db.query(
      ignore
        ? `UPDATE inbound_emails SET ignored_reason = 'staff', duplicate_of = NULL, ignored_at = now(), ignored_by = $2::uuid, kept_by_staff = false
           WHERE message_id = $1`
        : `UPDATE inbound_emails SET ignored_reason = NULL, duplicate_of = NULL, ignored_at = NULL, ignored_by = $2::uuid, kept_by_staff = true
           WHERE message_id = $1`,
      [messageId, by],
    );
    return (rowCount ?? 0) > 0;
  }

  // An API order from this client with the same fingerprint, placed in the last `minutes`: the one a repeat repeats.
  async recentApiOrder(clientId: string, fingerprint: string, minutes: number) {
    const { rows } = await this.db.query<{ request_id: string; created_at: Date }>(
      `SELECT request_id, created_at FROM order_requests
       WHERE channel = 'api' AND client_id = $1 AND fingerprint = $2 AND created_at >= $3
       ORDER BY created_at DESC LIMIT 1`,
      [clientId, fingerprint, new Date(Date.now() - minutes * 60_000)],
    );
    return rows[0] ?? null;
  }

  async latestReceivedAt() {
    const { rows } = await this.db.query<{ latest: Date | null }>(`SELECT max(received_at) AS latest FROM inbound_emails`);
    return rows[0]?.latest ? new Date(rows[0].latest) : null;
  }

  async get(messageId: string) {
    const { rows } = await this.db.query<EmailRow>(`SELECT ${COLUMNS} FROM ${FROM} WHERE e.message_id = $1`, [messageId]);
    return rows[0] ?? null;
  }

  // Emails the agent hasn't answered for yet, oldest first. Ignored ones aren't sent: there's no order to read.
  async listUnreadByAi() {
    const { rows } = await this.db.query<EmailRow>(
      `SELECT ${COLUMNS} FROM ${FROM} WHERE e.read_by_ai = false AND ${QUEUED} ORDER BY e.received_at ASC`,
    );
    return rows;
  }

  // Returns false when the email was already marked (another instance got there first). When the agent found no order
  // in it, it leaves the queue as not_order, unless staff restored it.
  async markReadByAi(messageId: string, result: { output?: unknown }) {
    const { rowCount } = await this.db.query(
      `UPDATE inbound_emails SET read_by_ai = true, ai_result = $2, ai_read_at = now(),
         ignored_reason = CASE WHEN $3::boolean AND NOT kept_by_staff AND ignored_reason IS NULL THEN 'not_order' ELSE ignored_reason END,
         ignored_at = CASE WHEN $3::boolean AND NOT kept_by_staff AND ignored_reason IS NULL THEN now() ELSE ignored_at END
       WHERE message_id = $1 AND read_by_ai = false`,
      [messageId, JSON.stringify(result), noOrderFound(result?.output)],
    );
    return (rowCount ?? 0) > 0;
  }

  // Newest first, ignored ones included (staff see them under Ignored), with how many of all the emails the agent has
  // answered for and how many are ignored.
  async list({ limit, offset }: { limit: number; offset: number }) {
    const [page, count] = await Promise.all([
      this.db.query<EmailRow>(`SELECT ${COLUMNS} FROM ${FROM} ORDER BY e.received_at DESC LIMIT $1 OFFSET $2`, [
        limit,
        offset,
      ]),
      this.db.query<{ total: string; analyzed: string | null; ignored: string | null }>(
        `SELECT count(*) AS total, sum(CASE WHEN e.read_by_ai THEN 1 ELSE 0 END) AS analyzed,
           sum(CASE WHEN e.ignored_reason IS NULL THEN 0 ELSE 1 END) AS ignored FROM ${FROM}`,
      ),
    ]);
    const c = count.rows[0];
    return { rows: page.rows, total: Number(c.total), analyzed: Number(c.analyzed ?? 0), ignored: Number(c.ignored ?? 0) };
  }

  // Every request in the queue received since `since`, oldest first: the stock-out log judges these.
  async listSince(since: Date) {
    const { rows } = await this.db.query<EmailRow>(
      `SELECT ${COLUMNS} FROM ${FROM} WHERE e.received_at >= $1 AND ${QUEUED} ORDER BY e.received_at ASC`,
      [since],
    );
    return rows;
  }

  // Every request in the queue with no carrier yet, however old, oldest first: what the carrier plan works from.
  async listUnassigned() {
    const { rows } = await this.db.query<EmailRow>(
      `SELECT ${COLUMNS} FROM ${FROM} WHERE e.assigned_carrier IS NULL AND ${QUEUED} ORDER BY e.received_at ASC`,
    );
    return rows;
  }

  // Assigns an order to a carrier. False when it already has one: an assignment is never moved.
  async assignCarrier(requestId: string, carrier: string, by: string, at: Date, deliveredAt: Date) {
    const { rowCount } = await this.db.query(
      `UPDATE order_requests SET assigned_carrier = $2, assigned_by = $3::uuid, assigned_at = $4, delivered_at = $5
       WHERE request_id = $1 AND assigned_carrier IS NULL`,
      [requestId, carrier, by, at, deliveredAt],
    );
    return (rowCount ?? 0) > 0;
  }

  async assignments(requestIds: string[]) {
    if (!requestIds.length) return [];
    const { rows } = await this.db.query<AssignmentRow & { request_id: string }>(
      `SELECT request_id, assigned_carrier, assigned_at, delivered_at FROM order_requests
       WHERE request_id IN (${requestIds.map((_, i) => `$${i + 1}`).join(", ")}) AND assigned_carrier IS NOT NULL`,
      requestIds,
    );
    return rows;
  }

  async clientLogins(): Promise<ClientLogin[]> {
    const { rows } = await this.db.query<{ email: string; client_id: string }>(`SELECT email, client_id FROM client_users`);
    return rows.map((r) => ({ email: r.email, clientId: r.client_id }));
  }

  // Saves staff's work on a request. clientId undefined leaves the client to matchClient; null unlinks it. intakeAt is
  // the order intake time: kept the first time it's given and never moved afterwards.
  async saveRequest(
    messageId: string,
    edits: Record<string, unknown>,
    clientId: string | null | undefined,
    by: string,
    intakeAt?: string,
  ) {
    const { rowCount } = await this.db.query(
      `INSERT INTO order_requests (request_id, channel, message_id, client_set, client_id, edits, updated_by, updated_at, intake_at)
       SELECT message_id, 'email', message_id, $2::boolean, $3::text, $4::jsonb, $5::uuid, now(), $6::timestamptz
       FROM inbound_emails WHERE message_id = $1
       ON CONFLICT (request_id) DO UPDATE
         SET client_set = EXCLUDED.client_set, client_id = EXCLUDED.client_id, edits = EXCLUDED.edits,
             updated_by = EXCLUDED.updated_by, updated_at = now(),
             intake_at = COALESCE(order_requests.intake_at, EXCLUDED.intake_at)`,
      [messageId, clientId !== undefined, clientId ?? null, JSON.stringify(edits), by, intakeAt ?? null],
    );
    if (rowCount) return true;
    // No email: an API order, which always keeps the client that placed it.
    const api = await this.db.query(
      `UPDATE order_requests SET edits = $2::jsonb, updated_by = $3::uuid, updated_at = now()
       WHERE request_id = $1 AND channel = 'api'`,
      [messageId, JSON.stringify(edits), by],
    );
    return (api.rowCount ?? 0) > 0;
  }

  // Stores an order placed through the API, linked to the client that placed it.
  async createApiOrder(requestId: string, clientId: string, payload: ApiOrderPayload, by: string, fingerprint: string) {
    await this.db.query(
      `INSERT INTO order_requests (request_id, channel, client_set, client_id, edits, order_payload, created_by, updated_by, fingerprint)
       VALUES ($1, 'api', true, $2, '{}'::jsonb, $3::jsonb, $4::uuid, $4::uuid, $5)`,
      [requestId, clientId, JSON.stringify(payload), by, fingerprint],
    );
  }

  // The client's products with these ids or SKUs, keyed by what was asked for.
  async clientProducts(clientId: string, keys: string[]) {
    const { rows } = await this.db.query<{ product_id: string; sku: string; product_name: string }>(
      `SELECT product_id, sku, product_name FROM products WHERE client_id = $1 AND (product_id = ANY($2::text[]) OR sku = ANY($2::text[]))`,
      [clientId, keys],
    );
    return rows;
  }

  // Cartons free to ship across every warehouse, by product. A product stocked nowhere isn't in the map.
  async availableStock(productIds: string[]) {
    const { rows } = await this.db.query<{ product_id: string; quantity_on_hand: number; quantity_reserved: number }>(
      `SELECT product_id, quantity_on_hand, quantity_reserved FROM warehouse_products WHERE product_id = ANY($1::text[])`,
      [productIds],
    );
    const available = new Map<string, number>();
    for (const r of rows) available.set(r.product_id, (available.get(r.product_id) ?? 0) + Math.max(0, r.quantity_on_hand - r.quantity_reserved));
    return available;
  }

  // The client's own requests, newest first, up to `limit`. SQL keeps every row clientOf could give to this client
  // (linked to them, or unlinked with one of their logins as sender or in the body), so other clients' volume can't push
  // theirs out of the window; clientOf then decides exactly (a sender who is another client's login wins over the body).
  async listForClient(clientId: string, limit: number) {
    const logins = await this.clientLogins();
    // LIKE patterns: an "_" in a login matches any character, which only lets more rows through to clientOf.
    const own = logins.filter((l) => l.clientId === clientId).map((l) => `%${l.email.replace(/[\\%]/g, "\\$&")}%`);
    const { rows } = await this.db.query<EmailRow>(
      `SELECT ${COLUMNS} FROM ${FROM}
       WHERE ${QUEUED} AND ((e.client_set AND e.client_id = $1)
          OR (COALESCE(e.client_set, false) = false AND e.channel = 'email'
              AND (lower(e.from_address) LIKE ANY($2::text[]) OR lower(COALESCE(e.body, '')) LIKE ANY($2::text[]))))
       ORDER BY e.received_at DESC LIMIT $3`,
      [clientId, own, limit],
    );
    return { rows: rows.filter((row) => clientOf(row, logins) === clientId), logins };
  }

  // The client user placing an API order, for "placed by".
  async clientUser(clientUserId: string) {
    const { rows } = await this.db.query<{ full_name: string; email: string }>(
      `SELECT full_name, email FROM client_users WHERE client_user_id = $1`,
      [clientUserId],
    );
    return rows[0] ?? null;
  }

  // True when the product is in the client's own catalogue.
  async productOfClient(productId: string, clientId: string) {
    const { rowCount } = await this.db.query(`SELECT 1 FROM products WHERE product_id = $1 AND client_id = $2`, [
      productId,
      clientId,
    ]);
    return (rowCount ?? 0) > 0;
  }
}
