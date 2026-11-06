// When an order delivers under the same-day cutoff: received before the cutoff (in the cutoff's time zone) it delivers
// that day, otherwise the next.

export interface DeliveryRule {
  // "HH:MM", 24-hour.
  sameDayCutoff: string;
  // IANA zone the cutoff is read in, e.g. "America/New_York".
  timeZone: string;
}

export const DEFAULT_DELIVERY_RULE: DeliveryRule = { sameDayCutoff: "08:00", timeZone: "America/New_York" };

export interface ExpectedDelivery {
  // "YYYY-MM-DD" in the rule's time zone.
  date: string;
  sameDay: boolean;
  cutoff: string;
  timeZone: string;
  // Set when the client accepted a new date after a stock problem; date is that new date.
  rescheduled: boolean;
}

export const isTimeZone = (zone: string) => {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: zone });
    return true;
  } catch {
    return false;
  }
};

// The calendar date and "HH:MM" of `at` in the zone.
function localParts(at: Date, timeZone: string) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" })
      .formatToParts(at)
      .map((p) => [p.type, p.value]),
  );
  return { date: `${parts.year}-${parts.month}-${parts.day}`, time: `${parts.hour}:${parts.minute}` };
}

const nextDay = (date: string) => {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
};

// Today's date in the rule's zone, and whether the cutoff has passed: after it, today's same-day orders are final.
export function cutoffState(now: Date, rule: DeliveryRule) {
  const { date, time } = localParts(now, rule.timeZone);
  return { today: date, passed: time >= rule.sameDayCutoff };
}

export function expectedDelivery(receivedAt: Date, rule: DeliveryRule, rescheduledTo?: string | null): ExpectedDelivery {
  const { date, time } = localParts(receivedAt, rule.timeZone);
  const sameDay = time < rule.sameDayCutoff;
  return {
    date: rescheduledTo ?? (sameDay ? date : nextDay(date)),
    sameDay,
    cutoff: rule.sameDayCutoff,
    timeZone: rule.timeZone,
    rescheduled: !!rescheduledTo,
  };
}
