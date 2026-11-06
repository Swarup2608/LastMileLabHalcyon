// Products: /api/products, each with its stock in the warehouses that carry it. Staff get every client's products,
// a client user only their own client's.
import { request } from "./api";

export interface WarehouseStock {
  warehouseId: string;
  onHand: number;
  reserved: number;
  // onHand minus reserved: what can still be picked.
  available: number;
  reorderPoint: number;
  binLocation: string | null;
}

export interface Product {
  productId: string;
  sku: string;
  productName: string;
  category: string;
  clientId: string;
  clientName: string | null;
  primaryOrderChannel: string | null;
  unitPriceUsd: number;
  unitWeightKg: number;
  stock: WarehouseStock[];
}

export const productsApi = {
  list: () => request<{ products: Product[] }>("/products"),
};
