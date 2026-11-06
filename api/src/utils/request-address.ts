// Where an order request delivers, read like Resolve does: staff's fixes first, then the agent's reply (repaired when it
// isn't quite JSON), or an API order's payload. Shared by the carrier plan and the stock-out log.
import type { toEmailDto } from "../repositories/email.repository.js";
import { FIELD, fieldOf } from "./agent-json.js";
import { regionOf, stateCode, type Region } from "./regions.js";

const REGIONS: Region[] = ["Midwest", "Northeast", "Southeast", "West"];
// Same as the web app's lib/emails.ts (DELIVERY, ONE_LINE), so the hold agrees with what Resolve shows.
const STREET = /^(?!.*\b(e ?mail|city|state|zip|postal)\b).*\b(address|street)\b|\bline 1\b/;
const ONE_LINE = /,\s*([^,]+?),\s*([A-Za-z][A-Za-z .]*?)\.?(?:\s+(\d{5}(?:-\d{4})?))?\s*$/;

export function addressOf(dto: ReturnType<typeof toEmailDto>) {
  const edits = (dto.edits ?? {}) as { address?: Record<string, string> };
  const output = (dto.aiResult as { output?: unknown } | null)?.output;
  const city = edits.address?.city || fieldOf(output, FIELD.city);
  const state = edits.address?.region || fieldOf(output, FIELD.state);
  const postal = edits.address?.postal || fieldOf(output, FIELD.postal);
  // The region the agent named ("destinationRegion"), when the state and ZIP don't settle it.
  const named = fieldOf(output, FIELD.region);
  const region: Region | null = regionOf(state, postal) ?? (REGIONS.find((r) => r.toLowerCase() === named.toLowerCase()) || null);
  return { city, state, postal, region };
}

// The address fields still empty, read like Resolve: what staff typed replaces the agent's reply, even when blank, and
// a one-line address fills in the city, state and ZIP it holds. FR-04 holds routing until this is empty.
export function missingAddress(output: unknown, edits: { address?: Record<string, string> }) {
  const typed = edits.address ?? {};
  const street = typed.street ?? fieldOf(output, STREET);
  const [, city, state, postal] = ONE_LINE.exec(fieldOf(output, STREET)) ?? [];
  const fields: [string, string | undefined][] = [
    ["street", street],
    ["city", typed.city ?? (fieldOf(output, FIELD.city) || city)],
    ["state", typed.region ?? (fieldOf(output, FIELD.state) || state)],
    ["postal code", typed.postal ?? (fieldOf(output, FIELD.postal) || postal)],
  ];
  return fields.filter(([, value]) => !value?.trim()).map(([label]) => label);
}

// The first three ZIP digits by state (USPS sectional centers). Some prefixes serve two states, so ranges overlap.
// Territories and military codes are left out: they're in none of the four delivery regions.
const ZIP3: [number, number, string][] = [
  [5, 5, "NY"], [10, 27, "MA"], [28, 29, "RI"], [30, 38, "NH"], [39, 49, "ME"], [50, 54, "VT"], [55, 55, "MA"], [56, 59, "VT"],
  [60, 69, "CT"], [63, 63, "NY"], [70, 89, "NJ"], [100, 149, "NY"], [150, 196, "PA"], [197, 199, "DE"], [200, 200, "DC"],
  [201, 201, "VA"], [202, 205, "DC"], [206, 219, "MD"], [220, 246, "VA"], [247, 268, "WV"], [270, 289, "NC"], [290, 299, "SC"],
  [300, 319, "GA"], [398, 399, "GA"], [320, 339, "FL"], [341, 349, "FL"], [350, 369, "AL"], [370, 385, "TN"], [386, 397, "MS"],
  [400, 427, "KY"], [430, 459, "OH"], [460, 479, "IN"], [480, 499, "MI"], [500, 528, "IA"], [530, 549, "WI"], [550, 567, "MN"],
  [569, 569, "DC"], [570, 577, "SD"], [580, 588, "ND"], [590, 599, "MT"], [600, 629, "IL"], [630, 658, "MO"], [660, 679, "KS"],
  [680, 693, "NE"], [700, 714, "LA"], [716, 729, "AR"], [755, 755, "AR"], [730, 731, "OK"], [734, 749, "OK"], [733, 733, "TX"],
  [750, 799, "TX"], [885, 885, "TX"], [800, 816, "CO"], [820, 831, "WY"], [834, 834, "WY"], [832, 838, "ID"], [840, 847, "UT"],
  [850, 865, "AZ"], [870, 884, "NM"], [889, 898, "NV"], [900, 961, "CA"], [967, 968, "HI"], [970, 979, "OR"], [980, 994, "WA"],
  [995, 999, "AK"],
];
const US = /^(US|USA|U ?S ?A?|UNITED STATES( OF AMERICA)?)$/;

// What's wrong with a typed US address: a plausibility check on the state, ZIP and country, not proof it's deliverable.
// Blank fields pass; whether they're required is the caller's rule.
export function addressProblem(state: string, postal: string, country?: string): { field: "region" | "postal" | "country"; message: string } | null {
  const code = state.trim() ? stateCode(state) : null;
  if (state.trim() && !code) return { field: "region", message: "unknown state" };
  if (postal.trim()) {
    if (!/^\d{5}(-\d{4})?$/.test(postal.trim())) return { field: "postal", message: "invalid zip" };
    const prefix = Number(postal.trim().slice(0, 3));
    const states = ZIP3.filter(([from, to]) => prefix >= from && prefix <= to).map(([, , s]) => s);
    if (!states.length) return { field: "postal", message: "unknown zip" };
    if (code && !states.includes(code)) return { field: "postal", message: "zip does not match state" };
  }
  if (country?.trim() && !US.test(country.trim().toUpperCase().replace(/\./g, " ").replace(/\s+/g, " ").trim())) return { field: "country", message: "unsupported country" };
  return null;
}
