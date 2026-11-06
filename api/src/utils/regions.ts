// The delivery region of a US address, as the warehouse distances and carrier figures use them. Same split as the web
// app's fulfilment.ts.
export type Region = "Midwest" | "Northeast" | "Southeast" | "West";

const STATE_REGION: Record<string, Region> = {};
const add = (region: Region, states: string) => states.split(" ").forEach((s) => (STATE_REGION[s] = region));
add("Northeast", "ME NH VT MA RI CT NY NJ PA DE MD DC");
add("Southeast", "VA WV NC SC GA FL AL MS TN AR LA TX OK");
add("Midwest", "OH IN IL MI WI MN IA MO KS NE ND SD KY");
add("West", "MT WY CO NM AZ UT NV ID WA OR CA AK HI");

const STATE_NAMES: Record<string, string> = {
  maine: "ME", "new hampshire": "NH", vermont: "VT", massachusetts: "MA", "rhode island": "RI", connecticut: "CT",
  "new york": "NY", "new jersey": "NJ", pennsylvania: "PA", delaware: "DE", maryland: "MD", virginia: "VA",
  "west virginia": "WV", "north carolina": "NC", "south carolina": "SC", georgia: "GA", florida: "FL", alabama: "AL",
  mississippi: "MS", tennessee: "TN", arkansas: "AR", louisiana: "LA", texas: "TX", oklahoma: "OK", ohio: "OH",
  indiana: "IN", illinois: "IL", michigan: "MI", wisconsin: "WI", minnesota: "MN", iowa: "IA", missouri: "MO",
  kansas: "KS", nebraska: "NE", "north dakota": "ND", "south dakota": "SD", kentucky: "KY", montana: "MT",
  wyoming: "WY", colorado: "CO", "new mexico": "NM", arizona: "AZ", utah: "UT", nevada: "NV", idaho: "ID",
  washington: "WA", oregon: "OR", california: "CA", alaska: "AK", hawaii: "HI",
};

// By the ZIP code's first digit, when there's no state to go on.
const ZIP_REGION: Region[] = ["Northeast", "Northeast", "Southeast", "Southeast", "Midwest", "Midwest", "Midwest", "Southeast", "West", "West"];

// The two-letter code for "IL" or "Illinois"; null when it isn't a US state.
export function stateCode(state: string) {
  const s = state.trim().replace(/\./g, "");
  const code = s.length === 2 ? s.toUpperCase() : STATE_NAMES[s.toLowerCase()];
  return code && STATE_REGION[code] ? code : null;
}

// From the state, else the ZIP code; null when neither says.
export function regionOf(state: string, postal: string): Region | null {
  const code = stateCode(state);
  if (code) return STATE_REGION[code];
  const zip = /^\s*(\d)\d{4}/.exec(postal)?.[1];
  return zip ? ZIP_REGION[Number(zip)] : null;
}
