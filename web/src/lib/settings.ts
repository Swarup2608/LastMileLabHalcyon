// Settings: /api/settings. Any signed-in user reads them; admins change the same-day cutoff.
import { request } from "./api";

export interface DeliveryRule {
  // "HH:MM", 24-hour: orders received before it deliver the same day, the rest the next day.
  sameDayCutoff: string;
  // IANA zone the cutoff is read in.
  timeZone: string;
}

// When an order is expected to deliver, as the API works it out from the cutoff.
export interface ExpectedDelivery {
  // "YYYY-MM-DD"
  date: string;
  sameDay: boolean;
  cutoff: string;
  timeZone: string;
  // The client accepted a new date after a stock problem.
  rescheduled: boolean;
}

export const settingsApi = {
  get: () => request<{ delivery: DeliveryRule }>("/settings"),
  setDelivery: (rule: DeliveryRule) => request<{ delivery: DeliveryRule }>("/settings/delivery", { method: "PUT", body: rule }),
};

// The zones admins pick from: the US ones the warehouses are in, plus UTC.
export const TIME_ZONES: [string, string][] = [
  ["America/New_York", "Eastern"],
  ["America/Chicago", "Central"],
  ["America/Denver", "Mountain"],
  ["America/Los_Angeles", "Pacific"],
  ["UTC", "UTC"],
];

// "Thu 30 Oct", for a "YYYY-MM-DD" date (read as that calendar day, whatever the browser's zone).
export const deliveryDay = (date: string) =>
  new Date(`${date}T12:00:00Z`).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });

// Why it delivers then: "Same day, before 08:00" / "Next day, after 08:00" / "New date accepted".
export const deliveryReason = (d: ExpectedDelivery) =>
  d.rescheduled ? "New date accepted" : d.sameDay ? `Same day · in before ${d.cutoff}` : `Next day · in after ${d.cutoff}`;
