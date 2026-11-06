"use client";

import { useEffect, useState } from "react";
import Icon from "@/components/Icon";
import { settingsApi, type DeliveryRule } from "@/lib/settings";

// Minutes past midnight now, in the zone.
function minutesIn(timeZone: string, now: Date) {
  const [h, m] = new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone }).format(now).split(":");
  return Number(h) * 60 + Number(m);
}

const span = (mins: number) => (mins >= 60 ? `${Math.floor(mins / 60)}h ${mins % 60}m` : `${mins}m`);

// The time left until today's same-day cutoff, in the staff header on every page (real time, not the demo clock).
// After it, today's same-day orders are final and the carrier plan runs.
export default function CutoffClock() {
  const [rule, setRule] = useState<DeliveryRule | null>(null);
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    let active = true;
    const load = () => settingsApi.get().then((r) => active && setRule(r.delivery), () => undefined);
    load();
    // The minute ticks; the rule is re-read now and then in case an admin changed it.
    const tick = setInterval(() => setNow(new Date()), 15_000);
    const reload = setInterval(load, 5 * 60_000);
    return () => {
      active = false;
      clearInterval(tick);
      clearInterval(reload);
    };
  }, []);

  if (!rule) return null;
  const [h, m] = rule.sameDayCutoff.split(":").map(Number);
  const left = h * 60 + m - minutesIn(rule.timeZone, now);
  const open = left > 0;

  return (
    <span
      className={`chip ${open ? (left <= 30 ? "warn" : "blue") : ""}`}
      role="timer"
      aria-live="off"
      title={`Same-day cutoff ${rule.sameDayCutoff} (${rule.timeZone})`}
      style={{ height: 32, padding: "0 12px", fontSize: 13 }}
    >
      <Icon name="clock" />
      <b className="mono" aria-label={open ? `Same-day cutoff in ${span(left)}` : "Same-day closed"}>
        {open ? span(left) : "Closed"}
      </b>
    </span>
  );
}
