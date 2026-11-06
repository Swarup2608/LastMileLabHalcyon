import type { Queryable } from "../db/transaction.js";
import type { ListMarketplaceQuery } from "../schemas/marketplace.schema.js";

// One product joined with one of its warehouse_products rows; warehouse_id is null for a product stocked nowhere.
export interface ProductStockRow {
  product_id: string;
  sku: string;
  product_name: string;
  category: string;
  client_id: string;
  client_name: string | null;
  client_region: string | null;
  primary_order_channel: string | null;
  unit_price_usd: string;
  unit_weight_kg: string;
  warehouse_id: string | null;
  quantity_on_hand: number | null;
  quantity_reserved: number | null;
  reorder_point: number | null;
  bin_location: string | null;
}

// A product as the public sees it: nothing about the client that owns it or where it's kept.
export type PublicProductRow = Pick<ProductStockRow, "product_id" | "sku" | "product_name" | "category" | "unit_price_usd">;

export interface WarehouseStock {
  warehouseId: string;
  onHand: number;
  reserved: number;
  available: number;
  reorderPoint: number;
  binLocation: string | null;
}

export interface ProductDto {
  productId: string;
  sku: string;
  productName: string;
  category: string;
  clientId: string;
  clientName: string | null;
  // The client's home region, where its customers mostly are.
  clientRegion: string | null;
  primaryOrderChannel: string | null;
  unitPriceUsd: number;
  unitWeightKg: number;
  // Only the warehouses that carry the product.
  stock: WarehouseStock[];
}

// Folds the flat product x warehouse rows (ordered by product) into one DTO per product.
export function toProductDtos(rows: ProductStockRow[]): ProductDto[] {
  const products = new Map<string, ProductDto>();
  for (const row of rows) {
    let product = products.get(row.product_id);
    if (!product) {
      product = {
        productId: row.product_id,
        sku: row.sku,
        productName: row.product_name,
        category: row.category,
        clientId: row.client_id,
        clientName: row.client_name,
        clientRegion: row.client_region,
        primaryOrderChannel: row.primary_order_channel,
        unitPriceUsd: Number(row.unit_price_usd),
        unitWeightKg: Number(row.unit_weight_kg),
        stock: [],
      };
      products.set(row.product_id, product);
    }
    if (row.warehouse_id) {
      const onHand = row.quantity_on_hand ?? 0;
      const reserved = row.quantity_reserved ?? 0;
      product.stock.push({
        warehouseId: row.warehouse_id,
        onHand,
        reserved,
        available: onHand - reserved,
        reorderPoint: row.reorder_point ?? 0,
        binLocation: row.bin_location,
      });
    }
  }
  return [...products.values()];
}

// Read-only: products and their stock levels are seeded by db/init/03_products.sql and 04_warehouse_products.sql.
// Every client holds at least this many products, so each one always has something to order.
const CATALOGUE_SIZE = 6;
const CATEGORIES = ["Hardware", "Medical", "Outdoor", "Kitchen", "Office", "Automotive", "Garden", "Pet", "Lab", "Home"];
const ADJECTIVES = ["Heavy duty", "Compact", "Premium", "Standard", "Bulk", "Industrial", "Lightweight", "Deluxe"];
const NOUNS = ["storage bin", "tool kit", "cable set", "filter pack", "glove box", "cleaning kit", "mount bracket", "carry case",
  "shelf unit", "tape roll", "spray bottle", "lamp", "fastener pack", "cover set", "tray set"];
const between = (low: number, high: number) => low + Math.floor(Math.random() * (high - low + 1));
const pick = <T>(list: T[], offset: number) => list[offset % list.length]!;

export class ProductRepository {
  constructor(private readonly db: Queryable) {}

  // Every product, or only one client's when clientId is given.
  async listWithStock(clientId: string | null) {
    const { rows } = await this.db.query<ProductStockRow>(
      `SELECT p.product_id, p.sku, p.product_name, p.category, p.client_id, c.client_name, c.region AS client_region, c.primary_order_channel,
              p.unit_price_usd, p.unit_weight_kg,
              wp.warehouse_id, wp.quantity_on_hand, wp.quantity_reserved, wp.reorder_point, wp.bin_location
       FROM products p
       JOIN clients c ON c.client_id = p.client_id
       LEFT JOIN warehouse_products wp ON wp.product_id = p.product_id
       WHERE ($1::text IS NULL OR p.client_id = $1)
       ORDER BY p.product_id, wp.warehouse_id`,
      [clientId],
    );
    return rows;
  }

  // Tops a client up to a full catalogue, each product stocked in 1-3 warehouses: the same synthetic products and
  // ranges as db/init/07_client_products.sql, which does this for the dataset's clients.
  async fillCatalogue(clientId: string) {
    const { rows: held } = await this.db.query(`SELECT product_id FROM products WHERE client_id = $1`, [clientId]);
    const { rows: ids } = await this.db.query<{ product_id: string }>(`SELECT product_id FROM products`);
    const { rows: warehouses } = await this.db.query<{ warehouse_id: string }>(`SELECT warehouse_id FROM warehouses`);
    const highest = Math.max(0, ...ids.map((p) => Number(p.product_id.slice(1)) || 0));
    const seed = between(0, 1000);

    for (let i = 0; i < CATALOGUE_SIZE - held.length; i++) {
      const n = highest + i + 1;
      const productId = `P${String(n).padStart(4, "0")}`;
      const category = pick(CATEGORIES, seed + i);
      await this.db.query(
        `INSERT INTO products (product_id, sku, product_name, category, client_id, unit_price_usd, unit_weight_kg)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [
          productId,
          `${category.slice(0, 2).toUpperCase()}-${String(n).padStart(5, "0")}`,
          `${pick(ADJECTIVES, seed * 3 + i)} ${pick(NOUNS, seed * 7 + i)}`,
          category,
          clientId,
          between(500, 50000) / 100,
          between(10, 2500) / 100,
        ],
      );
      const stocked = [...warehouses].sort(() => Math.random() - 0.5).slice(0, between(1, 3));
      for (const { warehouse_id } of stocked) {
        const onHand = between(50, 500);
        await this.db.query(
          `INSERT INTO warehouse_products (warehouse_id, product_id, quantity_on_hand, quantity_reserved, reorder_point, bin_location)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [warehouse_id, productId, onHand, Math.floor(Math.random() * onHand * 0.3), between(20, 99),
            `${String.fromCharCode(65 + between(0, 5))}-${String(between(1, 40)).padStart(2, "0")}-${between(1, 5)}`],
        );
      }
    }
  }

  // One page of the public marketplace, with the total the filters match.
  async listPublic({ q, category, limit, offset }: ListMarketplaceQuery) {
    const where = `($1::text IS NULL OR lower(product_name) LIKE '%' || lower($1) || '%' OR lower(sku) LIKE '%' || lower($1) || '%')
       AND ($2::text IS NULL OR category = $2)`;
    const filters = [q ?? null, category ?? null];
    const [page, count] = await Promise.all([
      this.db.query<PublicProductRow>(
        `SELECT product_id, sku, product_name, category, unit_price_usd FROM products WHERE ${where}
         ORDER BY product_name, product_id LIMIT $3 OFFSET $4`,
        [...filters, limit, offset],
      ),
      this.db.query<{ total: string }>(`SELECT count(*) AS total FROM products WHERE ${where}`, filters),
    ]);
    return { rows: page.rows, total: Number(count.rows[0]?.total ?? 0) };
  }

  async categories() {
    const { rows } = await this.db.query<{ category: string }>(`SELECT DISTINCT category FROM products ORDER BY category`);
    return rows.map((r) => r.category);
  }

  // Marketplace products with these ids or SKUs, from any client.
  async findPublic(keys: string[]) {
    const list = keys.map((_, i) => `$${i + 1}`).join(", ");
    const { rows } = await this.db.query<PublicProductRow>(
      `SELECT product_id, sku, product_name, category, unit_price_usd FROM products WHERE product_id IN (${list}) OR sku IN (${list})`,
      keys,
    );
    return rows;
  }
}
