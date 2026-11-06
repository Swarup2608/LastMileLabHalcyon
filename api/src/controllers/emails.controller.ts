import { randomBytes } from "node:crypto";
import type { Request, Response } from "express";
import { clientOf, toApiOrderPayload, toEmailDto, type EmailRepository } from "../repositories/email.repository.js";
import type {
  AnswerRequestBody,
  CreateOrderBody,
  EmailListQuery,
  EmailParams,
  IgnoreBody,
  SaveRequestBody,
  StockDraftBody,
  StockResponseBody,
} from "../schemas/emails.schema.js";
import type { AuditService } from "../services/audit.service.js";
import type { SettingsRepository } from "../repositories/settings.repository.js";
import type { EmailAgentService } from "../services/email-agent.service.js";
import { orderEmail } from "../services/order-mail.service.js";
import type { StockMessageService } from "../services/stock-message.service.js";
import { decisionKey, type StockoutService } from "../services/stockout.service.js";
import { badRequest, HttpError } from "../utils/http-error.js";
import { API_DUPLICATE_WINDOW_MINUTES, apiOrderFingerprint } from "../utils/order-screen.js";
import type { Mailer } from "../utils/mailer.js";
import { missingAddress } from "../utils/request-address.js";

// How many of the newest emails a client's own requests are looked for in.
const CLIENT_WINDOW = 500;

export class EmailsController {
  constructor(
    private readonly emails: EmailRepository,
    private readonly audit: AuditService,
    private readonly settings: SettingsRepository,
    private readonly stockMessages: StockMessageService,
    private readonly stockouts: StockoutService,
    // Undefined when FOUNDRY_* are not set.
    private readonly agent?: EmailAgentService,
    // Undefined when SMTP_HOST / ORDER_INBOX are not set.
    private readonly mailer?: Mailer,
  ) {}

  // Sends every email with read_by_ai = false to the agent now, rather than waiting for the next poll.
  analyze = async (req: Request, res: Response) => {
    if (!this.agent) throw new HttpError(503, "Email agent is not configured");
    await this.audit.record(req, { action: "email.analyze" });
    res.json(await this.agent.analyzePending());
  };

  get = async (req: Request<EmailParams>, res: Response) => {
    const [row, logins, rule] = await Promise.all([
      this.emails.get(req.params.messageId),
      this.emails.clientLogins(),
      this.settings.deliveryRule(),
    ]);
    if (!row) throw new HttpError(404, "Email not found");
    await this.audit.record(req, { action: "email.view", targetType: "email", targetId: req.params.messageId });
    res.json({ email: toEmailDto(row, logins, rule) });
  };

  list = async (req: Request, res: Response) => {
    const query = req.query as unknown as EmailListQuery;
    await this.audit.record(req, { action: "email.list", details: { ...query } });
    const [{ rows, total, analyzed, ignored }, logins, rule] = await Promise.all([
      this.emails.list(query),
      this.emails.clientLogins(),
      this.settings.deliveryRule(),
    ]);
    res.json({ emails: rows.map((row) => toEmailDto(row, logins, rule)), total, analyzed, ignored, limit: query.limit, offset: query.offset });
  };

  // Staff taking an email out of the queue, or putting back one that Halcyon or a colleague ignored.
  setIgnored = async (req: Request<EmailParams, unknown, IgnoreBody>, res: Response) => {
    if (!(await this.emails.setIgnored(req.params.messageId, req.body.ignore, req.auth!.sub))) throw new HttpError(404, "Email not found");
    await this.audit.record(req, {
      action: req.body.ignore ? "email.ignore" : "email.restore",
      targetType: "email",
      targetId: req.params.messageId,
    });
    res.status(204).end();
  };

  // Staff's work on the request behind an email, from the Resolve screen.
  saveRequest = async (req: Request<EmailParams, unknown, SaveRequestBody>, res: Response) => {
    const { edits, clientId, intakeAt, override } = req.body;
    // The client link and intake time have columns of their own.
    const { clientId: _client, intakeAt: _intake, ...rest } = edits;
    const before = await this.emails.get(req.params.messageId);
    // FR-04: a new routing decision waits for a full address, whatever the browser did, unless staff override it.
    const routing = before && rest.routed && JSON.stringify(rest.routed) !== JSON.stringify(before.edits?.routed);
    const output = before?.order_payload ?? (before?.ai_result as { output?: unknown } | null)?.output;
    const missing = routing ? missingAddress(output, rest as { address?: Record<string, string> }) : [];
    if (missing.length && !override) throw badRequest(`Can't route this order: its address has no ${missing.join(", ")}. Complete it first, or save with override: true.`);
    const saved = await this.emails.saveRequest(req.params.messageId, rest, clientId, req.auth!.sub, intakeAt);
    if (!saved) throw new HttpError(404, "Email not found");
    // Routed somewhere, unrouted, or flagged out of stock: log any stock-out at the nearest warehouse. A failure here
    // doesn't fail the save; the next decision, or the log's backfill, catches it up.
    if (decisionKey(before?.edits) !== decisionKey(rest)) {
      await this.stockouts.recordFor(req.params.messageId).catch((err) => console.error("stock-out log failed", err));
    }
    await this.audit.record(req, {
      action: "email.request.update",
      targetType: "email",
      targetId: req.params.messageId,
      details: { clientId: clientId ?? null, routed: !!rest.routed, asked: !!rest.asked, ...(missing.length ? { addressOverride: missing } : {}) },
    });
    res.status(204).end();
  };

  // Staff flagging a request as out of stock at its warehouse: a draft of the message to the customer, proposing a new
  // delivery date. Nothing is saved here; staff edit the draft and send it by saving it as the request's stockFlag.
  stockDraft = async (req: Request<EmailParams, unknown, StockDraftBody>, res: Response) => {
    if (!(await this.emails.get(req.params.messageId))) throw new HttpError(404, "Email not found");
    const draft = await this.stockMessages.draft(req.body);
    await this.audit.record(req, {
      action: "email.request.stock_draft",
      targetType: "email",
      targetId: req.params.messageId,
      details: { source: draft.source, newDate: req.body.newDate },
    });
    res.json(draft);
  };

  // The signed-in client's own emailed requests.
  mine = async (req: Request, res: Response) => {
    const clientId = req.auth!.clientId;
    if (!clientId) throw new HttpError(403, "Not a client account");
    const [{ rows, logins }, rule] = await Promise.all([this.emails.listForClient(clientId, CLIENT_WINDOW), this.settings.deliveryRule()]);
    res.json({ emails: rows.map((row) => toEmailDto(row, logins, rule)) });
  };

  // The signed-in client placing an order through the API (the portal's New API order page, or their own system with
  // the same session). Every product must be from their own catalogue. It's stored as an order request on the "api"
  // channel, already linked to their client, and staff route it like an emailed one.
  create = async (req: Request<Record<string, string>, unknown, CreateOrderBody>, res: Response) => {
    const clientId = req.auth!.clientId;
    if (!clientId) throw new HttpError(403, "Not a client account");
    const { reference, address } = req.body;
    const lines = await this.catalogueLines(clientId, req.body.lines);

    const user = await this.emails.clientUser(req.auth!.sub);
    const payload = toApiOrderPayload(
      req.body,
      lines.map((l) => ({ sku: l.sku, quantity: l.quantity })),
      user ? `${user.full_name} <${user.email}>` : "API",
      user?.full_name ?? null,
    );
    // The same order placed again within minutes (a double click, or the client's system retrying) isn't stored twice.
    // A new reference makes it a new order.
    const fingerprint = apiOrderFingerprint(clientId, { reference, lines: payload.products, address });
    const repeat = await this.emails.recentApiOrder(clientId, fingerprint, API_DUPLICATE_WINDOW_MINUTES);
    if (repeat) {
      throw new HttpError(409, `This order was already placed as REQ-${repeat.request_id.slice(-6).toUpperCase()}. To order the same again, give it a new reference.`, {
        id: repeat.request_id,
      });
    }
    const id = `api_${randomBytes(9).toString("hex")}`;
    await this.emails.createApiOrder(id, clientId, payload, req.auth!.sub, fingerprint);
    await this.audit.record(req, {
      action: "order.api.create",
      targetType: "order_request",
      targetId: id,
      details: { lines: payload.products.length, reference: payload.reference },
    });

    const [row, logins, rule] = await Promise.all([this.emails.get(id), this.emails.clientLogins(), this.settings.deliveryRule()]);
    const order = toEmailDto(row!, logins, rule);
    // Stock isn't reserved or refused here: the order is placed, and the client is told now rather than on delivery.
    const available = await this.emails.availableStock(lines.map((l) => l.productId));
    const short = lines.filter((l) => l.quantity > (available.get(l.productId) ?? 0));
    const warning = short.length
      ? `Not enough stock: ${short.map((l) => `${l.sku} (${l.quantity.toLocaleString("en-US")} ordered, ${(available.get(l.productId) ?? 0).toLocaleString("en-US")} available)`).join(", ")}. We’ll let you know if it needs a new date.`
      : undefined;
    res.status(201).json({ id, ref: `REQ-${id.slice(-6).toUpperCase()}`, expectedDelivery: order.expectedDelivery, order, ...(warning ? { warning } : {}) });
  };

  // Whether the portal can send an order by email, and where it goes.
  emailInfo = async (_req: Request, res: Response) => {
    res.json(this.mailer ? { enabled: true, to: this.mailer.orderInbox } : { enabled: false });
  };

  // The signed-in client sending an order by email instead (nodemailer, to ORDER_INBOX): the same body and catalogue
  // check as create, written out as an ordinary order email. Nothing is stored here; it arrives through the Gmail
  // poller like any emailed order and shows in their orders once intake has read it.
  sendEmail = async (req: Request<Record<string, string>, unknown, CreateOrderBody>, res: Response) => {
    const clientId = req.auth!.clientId;
    if (!clientId) throw new HttpError(403, "Not a client account");
    if (!this.mailer) throw new HttpError(503, "Sending orders by email is not configured");
    const { reference, customer, address, notes } = req.body;
    const [lines, user] = await Promise.all([this.catalogueLines(clientId, req.body.lines), this.emails.clientUser(req.auth!.sub)]);
    if (!user) throw new HttpError(403, "Not a client account");

    const mail = orderEmail(
      {
        sender: { name: user.full_name, email: user.email },
        reference: reference ?? null,
        customer: customer ?? null,
        lines,
        address: { ...address, suite: address.suite ?? null, country: address.country ?? null },
        notes: notes ?? null,
      },
      this.mailer.orderInbox,
    );
    let sent: { messageId: string };
    try {
      sent = await this.mailer.send(mail);
    } catch (err) {
      console.error("order email failed", err);
      throw new HttpError(502, "The order email couldn't be sent");
    }
    await this.audit.record(req, {
      action: "order.email.send",
      targetType: "order_request",
      targetId: sent.messageId,
      details: { lines: lines.length, reference: reference ?? null, to: this.mailer.orderInbox },
    });
    res.status(202).json({ to: this.mailer.orderInbox, subject: mail.subject, messageId: sent.messageId });
  };

  // The order's lines with each product looked up in the client's own catalogue (by id or SKU); 400 for any that isn't.
  private async catalogueLines(clientId: string, lines: CreateOrderBody["lines"]) {
    const keys = lines.map((l) => (l.productId ?? l.sku)!);
    const found = await this.emails.clientProducts(clientId, keys);
    const productOf = (key: string) => found.find((p) => p.product_id === key || p.sku === key);
    const unknown = keys.filter((k) => !productOf(k));
    if (unknown.length) throw new HttpError(400, `Not in your catalogue: ${unknown.join(", ")}`);
    return lines.map((l, i) => {
      const p = productOf(keys[i])!;
      return { productId: p.product_id, sku: p.sku, name: p.product_name, quantity: l.quantity };
    });
  }

  // The signed-in client accepting or declining the new delivery date staff proposed after a stock problem. Only a
  // pending proposal can be answered; accepting moves the expected delivery date to it.
  stockResponse = async (req: Request<EmailParams, unknown, StockResponseBody>, res: Response) => {
    const clientId = req.auth!.clientId;
    if (!clientId) throw new HttpError(403, "Not a client account");
    const [row, logins] = await Promise.all([this.emails.get(req.params.messageId), this.emails.clientLogins()]);
    if (!row || clientOf(row, logins) !== clientId) throw new HttpError(404, "Order request not found");

    const edits = { ...(row.edits ?? {}) } as Record<string, unknown> & { stockFlag?: Record<string, unknown> };
    if (edits.stockFlag?.status !== "pending") throw new HttpError(409, "There's no new date waiting for your answer");
    const { decision, note } = req.body;
    edits.stockFlag = {
      ...edits.stockFlag,
      status: decision === "accept" ? "accepted" : "declined",
      respondedAt: new Date().toISOString(),
      ...(note ? { response: note } : {}),
    };

    await this.emails.saveRequest(row.message_id, edits, row.client_set ? row.client_id : undefined, req.auth!.sub);
    await this.audit.record(req, {
      action: "email.request.stock_response",
      targetType: "email",
      targetId: row.message_id,
      details: { decision, newDate: edits.stockFlag.newDate },
    });
    res.status(204).end();
  };

  // The signed-in client answering what staff asked, on the portal's order page. The answers merge into staff's edits
  // as if typed on Resolve (address, quantities, products from the client's own catalogue), the questions answered are
  // switched off, and a note of what the client said is kept for staff.
  answer = async (req: Request<EmailParams, unknown, AnswerRequestBody>, res: Response) => {
    const clientId = req.auth!.clientId;
    if (!clientId) throw new HttpError(403, "Not a client account");
    const [row, logins] = await Promise.all([this.emails.get(req.params.messageId), this.emails.clientLogins()]);
    // Someone else's request reads as missing, like one that doesn't exist.
    if (!row || clientOf(row, logins) !== clientId) throw new HttpError(404, "Order request not found");

    const { address = {}, lines = {}, note } = req.body;
    for (const line of Object.values(lines)) {
      if (line.productId && !(await this.emails.productOfClient(line.productId, clientId))) {
        throw new HttpError(400, "That product isn't in your catalogue");
      }
    }

    type LineEdit = { productId?: string | null; declined?: boolean; quantity?: number | null };
    const edits = { ...(row.edits ?? {}) } as Record<string, unknown> & {
      address?: Record<string, string>;
      lines?: Record<string, LineEdit>;
      ask?: Record<string, boolean>;
    };
    const given = Object.fromEntries(Object.entries(address).filter(([, v]) => v));
    if (Object.keys(given).length) edits.address = { ...edits.address, ...given };
    const nextLines = { ...edits.lines };
    for (const [key, line] of Object.entries(lines)) {
      nextLines[key] = {
        ...nextLines[key],
        ...(line.quantity !== undefined ? { quantity: line.quantity } : {}),
        ...(line.productId ? { productId: line.productId, declined: false } : {}),
      };
    }
    edits.lines = nextLines;
    const answered = {
      address: Object.keys(given).length > 0,
      qty: Object.values(lines).some((l) => l.quantity !== undefined),
      product: Object.values(lines).some((l) => l.productId || l.note),
    };
    edits.ask = Object.fromEntries(Object.entries(edits.ask ?? {}).map(([k, on]) => [k, on && !answered[k as keyof typeof answered]]));
    const notes = Object.fromEntries(Object.entries(lines).flatMap(([k, l]) => (l.note ? [[k, l.note]] : [])));
    edits.answered = { at: new Date().toISOString(), ...(note ? { note } : {}), ...(Object.keys(notes).length ? { lines: notes } : {}) };

    await this.emails.saveRequest(row.message_id, edits, row.client_set ? row.client_id : undefined, req.auth!.sub);
    await this.audit.record(req, {
      action: "email.request.answer",
      targetType: "email",
      targetId: row.message_id,
      details: answered,
    });
    res.status(204).end();
  };
}

