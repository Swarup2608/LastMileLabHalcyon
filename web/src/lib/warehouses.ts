// Warehouses: /api/warehouses, and placing them on the US map. The warehouses table has ids, names and regions but
// no locations, so each warehouse gets a representative city in its region; regions without a warehouse of their
// own are served by the nearest one.
import { request } from "./api";

export interface Warehouse {
  warehouseId: string;
  warehouseName: string | null;
  region: string | null;
  pickListCutoff: string | null;
  carrierCollectionWindow: string | null;
  // Miles to each destination region, where the dataset has them.
  milesToRegion: Record<"Midwest" | "Southeast" | "Northeast" | "West", number | null>;
}

export const warehousesApi = {
  list: () => request<{ warehouses: Warehouse[] }>("/warehouses"),
};

export type LatLng = [number, number];

export interface MapWarehouse {
  id: string;
  name: string;
  region: string;
  city: string;
  at: LatLng;
}

// Candidate sites per region, used in order: the first Midwest warehouse goes to Columbus, the second to Indianapolis.
const SITES: Record<string, { city: string; at: LatLng }[]> = {
  West: [{ city: "Reno", at: [39.53, -119.81] }, { city: "Salt Lake City", at: [40.76, -111.89] }],
  Midwest: [{ city: "Columbus", at: [39.96, -83.0] }, { city: "Indianapolis", at: [39.77, -86.16] }, { city: "Chicago", at: [41.88, -87.63] }],
  Southeast: [{ city: "Atlanta", at: [33.75, -84.39] }, { city: "Charlotte", at: [35.23, -80.84] }],
  South: [{ city: "Dallas", at: [32.78, -96.8] }, { city: "Houston", at: [29.76, -95.37] }],
  Northeast: [{ city: "Allentown", at: [40.6, -75.47] }, { city: "Hartford", at: [41.76, -72.67] }],
};

// Rough centre of each delivery region, for placing extra warehouses and picking the nearest one to a region.
const REGION_CENTER: Record<string, LatLng> = {
  West: [40.5, -114],
  Midwest: [41.5, -89],
  Southeast: [32.5, -83.5],
  South: [31.5, -97.5],
  Northeast: [41.5, -74.5],
};

export const DELIVERY_REGIONS = Object.keys(REGION_CENTER);

function miles(a: LatLng, b: LatLng) {
  const r = Math.PI / 180;
  const dLat = (b[0] - a[0]) * r;
  const dLng = (b[1] - a[1]) * r;
  const x = Math.sin(dLat / 2) ** 2 + Math.cos(a[0] * r) * Math.cos(b[0] * r) * Math.sin(dLng / 2) ** 2;
  return 2 * 3959 * Math.asin(Math.sqrt(x));
}

export function placeWarehouses(rows: { warehouseId: string; warehouseName: string | null; region: string | null }[]) {
  const used: Record<string, number> = {};
  return rows.map((row): MapWarehouse => {
    const region = row.region ?? "Midwest";
    const i = (used[region] = (used[region] ?? -1) + 1);
    const center = REGION_CENTER[region] ?? REGION_CENTER.Midwest;
    // More warehouses than named sites: fan them out around the region's centre.
    const site = SITES[region]?.[i] ?? { city: region, at: [center[0] + i * 0.8, center[1] + i * 1.2] as LatLng };
    return { id: row.warehouseId, name: row.warehouseName ?? row.warehouseId, region, city: site.city, at: site.at };
  });
}

// The warehouse each delivery region ships from by default: its own (the first, if it has several), otherwise
// the nearest one.
export function homeWarehouses(warehouses: MapWarehouse[]): Record<string, string> {
  const home: Record<string, string> = {};
  for (const region of DELIVERY_REGIONS) {
    const own = warehouses.find((w) => w.region === region);
    const nearest = [...warehouses].sort(
      (a, b) => miles(a.at, REGION_CENTER[region]) - miles(b.at, REGION_CENTER[region]),
    )[0];
    if (own ?? nearest) home[region] = (own ?? nearest).id;
  }
  return home;
}

// Mirrors db/data/warehouses.csv for the public sign-in page, which can't call the signed-in /api/warehouses.
export const DATASET_WAREHOUSES = placeWarehouses([
  { warehouseId: "W1", warehouseName: "Midwest 1", region: "Midwest" },
  { warehouseId: "W2", warehouseName: "Midwest 2", region: "Midwest" },
  { warehouseId: "W3", warehouseName: "Southeast", region: "Southeast" },
  { warehouseId: "W4", warehouseName: "Northeast", region: "Northeast" },
  { warehouseId: "W5", warehouseName: "West", region: "West" },
]);
