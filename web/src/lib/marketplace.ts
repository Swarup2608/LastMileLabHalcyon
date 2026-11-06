import { useSyncExternalStore } from "react";
import { request } from "./api";

// The public shop. Anyone can read the catalogue; a visitor's first order also creates their client and login.

export interface MarketplaceProduct {
  productId: string;
  sku: string;
  productName: string;
  category: string;
  unitPriceUsd: number;
  inStock: boolean;
}

export interface MarketplacePage {
  products: MarketplaceProduct[];
  total: number;
  categories: string[];
}

export interface MarketplaceOrder {
  companyName: string;
  contact: { name: string; email: string; password: string };
  order: {
    reference?: string;
    lines: { productId: string; quantity: number }[];
    address: { street: string; suite?: string; city: string; region: string; postal: string };
  };
}

export const marketplaceApi = {
  products: (query: { q?: string; category?: string; limit: number; offset: number }) =>
    request<MarketplacePage>("/marketplace/products", { query }),
  placeOrder: (body: MarketplaceOrder) =>
    request<{ ref: string; warning?: string }>("/marketplace/orders", { method: "POST", body }),
};

export type CartLine = Pick<MarketplaceProduct, "productId" | "sku" | "productName" | "unitPriceUsd"> & { quantity: number };

// The cart lives in this tab's sessionStorage, so it survives the step to Create client without an account.
const CART_KEY = "halcyon-marketplace-cart";
const EMPTY: CartLine[] = [];
const listeners = new Set<() => void>();
let cached: { raw: string | null; lines: CartLine[] } = { raw: null, lines: EMPTY };

function readCart() {
  let raw: string | null = null;
  try {
    raw = sessionStorage.getItem(CART_KEY);
  } catch {
    return EMPTY;
  }
  if (raw !== cached.raw) {
    try {
      cached = { raw, lines: raw ? (JSON.parse(raw) as CartLine[]) : EMPTY };
    } catch {
      cached = { raw, lines: EMPTY };
    }
  }
  return cached.lines;
}

export function saveCart(lines: CartLine[]) {
  try {
    if (lines.length) sessionStorage.setItem(CART_KEY, JSON.stringify(lines));
    else sessionStorage.removeItem(CART_KEY);
  } catch {
    // Private windows can refuse storage; the cart then lasts only as long as this page.
    cached = { raw: JSON.stringify(lines), lines };
  }
  listeners.forEach((listener) => listener());
}

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

export const useCart = () => useSyncExternalStore(subscribe, readCart, () => EMPTY);

export const cartTotal = (lines: CartLine[]) => lines.reduce((sum, l) => sum + l.quantity * l.unitPriceUsd, 0);
export const money = (usd: number) => usd.toLocaleString("en-US", { style: "currency", currency: "USD" });
