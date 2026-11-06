// Same-day delivery in the supplied dataset (db/data/deliveries.csv): the 9,000 deliveries with
// commitment_type = same_day, April to September 2026, and how often each arrived on time (on_time = Y). Computed once
// from the CSV; each cell is [on-time %, deliveries]. Re-derive with the same filters if the dataset changes.

export const REGIONS = ["Midwest", "Northeast", "Southeast", "West"] as const;

export type Cell = [pct: number, n: number];

export const SAME_DAY_OVERALL: Cell = [55, 9000];

// By when the order arrived (order_received_ts, local hour) and destination region; the last cell is the row's total.
// The pick list closes at 08:00.
export const BY_WINDOW: [label: string, cells: Cell[]][] = [
  ["00:00–06:00", [[76, 648], [77, 603], [74, 468], [70, 461], [75, 2180]]],
  ["06:00–08:00", [[73, 611], [72, 531], [74, 419], [76, 433], [73, 1994]]],
  ["08:00–10:00", [[36, 467], [40, 423], [38, 397], [40, 333], [38, 1620]]],
  ["10:00–14:00", [[40, 975], [40, 832], [38, 692], [39, 707], [39, 3206]]],
];

// By the warehouse it shipped from (fulfilment_warehouse_id) and destination region; the last cell is the row's total.
export const BY_WAREHOUSE: [label: string, cells: Cell[]][] = [
  ["W1 Midwest 1", [[56, 1216], [39, 62], [52, 62], [50, 58], [55, 1398]]],
  ["W2 Midwest 2", [[57, 1200], [47, 70], [54, 39], [50, 56], [56, 1365]]],
  ["W3 Southeast", [[40, 107], [48, 63], [54, 1766], [45, 56], [53, 1992]]],
  ["W4 Northeast", [[46, 83], [58, 2125], [56, 55], [53, 43], [57, 2306]]],
  ["W5 West", [[51, 95], [51, 69], [50, 54], [55, 1721], [55, 1939]]],
];

// On-time rate under each condition; "All three met" is before 08:00, complete address and stock at the nearest
// warehouse.
export const DRIVERS: [label: string, pct: number, n: number][] = [
  ["All three met", 86, 3111],
  ["Received before 08:00", 74, 4174],
  ["Nearest warehouse out of stock", 47, 871],
  ["Received after 08:00", 39, 4826],
  ["Address incomplete", 36, 877],
];

// Below this a cell reads as a failing lane; at or above GOOD as a healthy one.
export const BAD_BELOW = 50;
export const GOOD_FROM = 70;

// By carrier (carrier_id; F holds the preferred-supplier agreement) and destination region; the last cell is the row's
// total. With the carrier's average same-day rate (carrier_rate_usd).
export const BY_CARRIER: [label: string, cells: Cell[]][] = [
  ["A", [[53, 569], [57, 537], [56, 594], [53, 406], [55, 2106]]],
  ["B", [[54, 566], [52, 538], [55, 495], [58, 338], [54, 1937]]],
  ["C", [[58, 386], [59, 325], [50, 340], [50, 264], [55, 1315]]],
  ["D", [[57, 382], [54, 439], [53, 167], [53, 345], [55, 1333]]],
  ["E", [[53, 260], [60, 265], [54, 284], [53, 226], [55, 1035]]],
  ["F preferred", [[56, 538], [64, 285], [55, 96], [60, 355], [59, 1274]]],
];
export const CARRIER_SAME_DAY_RATE: Record<string, string> = {
  A: "$16.28",
  B: "$15.65",
  C: "$17.41",
  D: "$13.46",
  E: "$13.99",
  "F preferred": "$12.32",
};
