// Sample figures for the product preview on the landing page.

export type Order = {
  id: string;
  c: string;
  ch: string;
  ts: string;
  cm: string;
  rg: string;
  wh: string;
  A: string | null;
  C: boolean;
  S: boolean;
  pick: string;
};

export const orders: Order[] = [
  { id: "ORD-S00194", c: "C046", ch: "Email", ts: "08:17", cm: "same-day", rg: "Midwest", wh: "W1", A: "state missing", C: true, S: false, pick: "Tue 6 Oct" },
  { id: "ORD-S00595", c: "C055", ch: "Email", ts: "00:30", cm: "standard", rg: "Midwest", wh: "W1", A: "street missing, ZIP not in OH", C: false, S: false, pick: "Mon 5 Oct" },
  { id: "ORD-S01046", c: "C259", ch: "Email", ts: "06:08", cm: "same-day", rg: "Midwest", wh: "W1", A: "city missing", C: false, S: false, pick: "Mon 5 Oct" },
  { id: "ORD-S00538", c: "C187", ch: "API", ts: "08:00", cm: "same-day", rg: "Southeast", wh: "W3", A: null, C: true, S: false, pick: "Tue 6 Oct" },
  { id: "ORD-S00289", c: "C190", ch: "Email", ts: "08:18", cm: "same-day", rg: "West", wh: "W5", A: null, C: true, S: false, pick: "Tue 6 Oct" },
  { id: "ORD-S00509", c: "C232", ch: "EDI", ts: "00:52", cm: "standard", rg: "Northeast", wh: "W4", A: null, C: false, S: true, pick: "Mon 5 Oct" },
  { id: "ORD-S00654", c: "C073", ch: "API", ts: "00:53", cm: "next-day", rg: "West", wh: "W5", A: null, C: false, S: true, pick: "Mon 5 Oct" },
  { id: "ORD-S00883", c: "C113", ch: "EDI", ts: "00:08", cm: "same-day", rg: "West", wh: "W5", A: null, C: false, S: false, pick: "Mon 5 Oct" },
  { id: "ORD-S00173", c: "C024", ch: "API", ts: "00:10", cm: "same-day", rg: "Southeast", wh: "W3", A: null, C: false, S: false, pick: "Mon 5 Oct" },
  { id: "ORD-S00475", c: "C118", ch: "EDI", ts: "00:16", cm: "standard", rg: "Midwest", wh: "W1", A: null, C: false, S: false, pick: "Mon 5 Oct" },
];

const P = { A: 0.65, C: 0.61, S: 0.48 };

export function risk(o: Order): number {
  let k = 1;
  if (o.A) k *= 1 - P.A;
  if (o.C) k *= 1 - P.C;
  if (o.S) k *= 1 - P.S;
  return k === 1 ? 3 : Math.round((1 - k) * 100);
}

export const regions = ["Midwest", "Northeast", "Southeast", "West"];

export const laneData: Record<string, number[]> = {
  A: [5.3, 4.8, 6.4, 6.7],
  B: [6.1, 6.6, 5.4, 6.3],
  C: [5.6, 4.7, 5.2, 5.1],
  D: [45.7, 22.7, 44.5, 22.3],
  E: [6.2, 3.9, 6.4, 45.9],
  F: [5.5, 43.3, 46.1, 5.2],
};

export const allIn: Record<string, number> = { B: 39.9, A: 41.29, F: 42.24, C: 42.46, E: 42.89, D: 50.46 };

export const laneNotes: Record<string, string> = {
  "D-Midwest": "Carrier D runs 46% late into the Midwest on otherwise clean shipments: the biggest weak lane by volume.",
  "D-Southeast": "Carrier D runs 45% late into the Southeast.",
  "D-Northeast": "D is middling here at 23%, still above the 10% line, so it drops to last choice.",
  "D-West": "D is middling here at 22%, above the 10% line, so other carriers are preferred.",
  "E-West": "Carrier E is reliable in three regions and runs 46% late only into the West.",
  "F-Northeast": "F holds the preferred-supplier agreement but runs 43% late into the Northeast.",
  "F-Southeast": "F holds the preferred-supplier agreement. It runs about 5% late in the Midwest and West, so the agreement can stay where F performs.",
};
