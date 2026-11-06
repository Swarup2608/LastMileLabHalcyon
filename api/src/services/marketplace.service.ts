import { randomBytes } from "node:crypto";
import type { Pool } from "pg";
import { EmailRepository, toApiOrderPayload } from "../repositories/email.repository.js";
import type { ProductRepository } from "../repositories/product.repository.js";
import type { SettingsRepository } from "../repositories/settings.repository.js";
import type { ListMarketplaceQuery, MarketplaceOrderBody } from "../schemas/marketplace.schema.js";
import { expectedDelivery } from "../utils/delivery.js";
import { badRequest } from "../utils/http-error.js";
import { apiOrderFingerprint } from "../utils/order-screen.js";
import { regionOf } from "../utils/regions.js";
import type { ClientsService } from "./clients.service.js";

// The public shop: every product, whichever client holds it, and a visitor's first order.
export class MarketplaceService {
  private readonly emails: EmailRepository;

  constructor(
    db: Pool,
    private readonly products: ProductRepository,
    private readonly clients: ClientsService,
    private readonly settings: SettingsRepository,
  ) {
    this.emails = new EmailRepository(db);
  }

  // Only what a shopper needs. No owning client, warehouse or exact stock figure leaves this method.
  async list(query: ListMarketplaceQuery) {
    const [{ rows, total }, categories] = await Promise.all([this.products.listPublic(query), this.products.categories()]);
    const available = await this.emails.availableStock(rows.map((p) => p.product_id));
    return {
      products: rows.map((p) => ({
        productId: p.product_id,
        sku: p.sku,
        productName: p.product_name,
        category: p.category,
        unitPriceUsd: Number(p.unit_price_usd),
        inStock: (available.get(p.product_id) ?? 0) > 0,
      })),
      total,
      categories,
    };
  }

  // Creates the client, its login and the order in one transaction, so a failed order leaves no empty account behind.
  // The order is on the API channel and staff route it like any other. The client is placed in the region it ships to.
  async placeOrder({ companyName, contact, order }: MarketplaceOrderBody) {
    const keys = order.lines.map((l) => (l.productId ?? l.sku)!);
    const found = await this.products.findPublic(keys);
    const productOf = (key: string) => found.find((p) => p.product_id === key || p.sku === key);
    const unknown = keys.filter((k) => !productOf(k));
    if (unknown.length) throw badRequest(`Not in the marketplace: ${unknown.join(", ")}`);
    const region = regionOf(order.address.region, order.address.postal);
    if (!region) throw badRequest("We can't ship to that address");

    const lines = order.lines.map((l, i) => ({ sku: productOf(keys[i])!.sku, quantity: l.quantity }));
    const payload = toApiOrderPayload(order, lines, `${contact.name} <${contact.email}>`, contact.name);
    const id = `api_${randomBytes(9).toString("hex")}`;
    const { client, user } = await this.clients.signup(
      { clientName: companyName, region, primaryOrderChannel: "API", accountTier: "Tier 3", slaPenaltyClause: false, annualRevenueUsd: null, contact },
      (tx, clientId, userId) =>
        new EmailRepository(tx).createApiOrder(id, clientId, payload, userId, apiOrderFingerprint(clientId, { reference: order.reference, lines, address: order.address })),
    );

    const available = await this.emails.availableStock(found.map((p) => p.product_id));
    const short = order.lines.filter((l, i) => l.quantity > (available.get(productOf(keys[i])!.product_id) ?? 0));
    return {
      id,
      ref: `REQ-${id.slice(-6).toUpperCase()}`,
      client,
      user,
      expectedDelivery: expectedDelivery(new Date(), await this.settings.deliveryRule()),
      ...(short.length ? { warning: "Some items may need a new date. Halcyon will let you know." } : {}),
    };
  }
}
