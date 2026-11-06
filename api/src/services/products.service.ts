import { toProductDtos, type ProductRepository } from "../repositories/product.repository.js";
import type { AccessClaims } from "../types/auth.js";

export class ProductsService {
  constructor(private readonly products: ProductRepository) {}

  // Staff see every client's products; a client user sees only their own client's.
  async list(auth: AccessClaims) {
    const clientId = auth.typ === "client" ? (auth.clientId ?? "") : null;
    return toProductDtos(await this.products.listWithStock(clientId));
  }
}
