"use client";

import { useEffect, useState } from "react";
import toast from "react-hot-toast";
import Spinner from "@/components/Spinner";
import { ApiError } from "@/lib/api";
import { refreshInbox } from "@/lib/inbox";
import { settingsApi, TIME_ZONES, type DeliveryRule } from "@/lib/settings";
import { useConsoleUser } from "./ConsoleShell";

// The same-day cutoff, in the Rules section of an admin's Account settings: orders received before it deliver that day,
// the rest the next day. Only admins change it (anyone else sees it read-only). Every order's expected delivery date
// (Orders, Resolve, the client's order page) follows it.
export default function DeliveryCutoffCard() {
  const user = useConsoleUser();
  const isAdmin = user.role === "admin";
  const [saved, setSaved] = useState<DeliveryRule | null>(null);
  const [rule, setRule] = useState<DeliveryRule | null>(null);
  const [failed, setFailed] = useState(false);
  const [pending, setPending] = useState(false);

  useEffect(() => {
    let active = true;
    settingsApi.get().then(
      (r) => {
        if (!active) return;
        setSaved(r.delivery);
        setRule(r.delivery);
      },
      () => active && setFailed(true),
    );
    return () => {
      active = false;
    };
  }, []);

  const changed = !!rule && !!saved && (rule.sameDayCutoff !== saved.sameDayCutoff || rule.timeZone !== saved.timeZone);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!rule) return;
    setPending(true);
    try {
      const r = await settingsApi.setDelivery(rule);
      setSaved(r.delivery);
      setRule(r.delivery);
      refreshInbox();
      toast.success(`Same-day cutoff set to ${r.delivery.sameDayCutoff}. Orders after it deliver the next day.`);
    } catch (err) {
      toast.error(err instanceof ApiError ? `Halcyon couldn’t save the cutoff: ${err.message}` : "We couldn’t reach Halcyon.");
    } finally {
      setPending(false);
    }
  }

  return (
    <form className="card" onSubmit={save} style={{ padding: 24, display: "grid", gap: 16 }}>
      <div>
        <h2 style={{ fontSize: 18, lineHeight: "28px" }}>Same-day delivery cutoff</h2>
        <p className="muted" style={{ fontSize: 14, lineHeight: "20px" }}>
          Orders received before this time deliver the same day; anything later delivers the next day. Orders show the
          expected delivery date this gives.
        </p>
      </div>
      {failed ? (
        <p className="ferr">We couldn’t load the cutoff from Halcyon.</p>
      ) : !rule ? (
        <p className="muted" aria-busy="true">Loading…</p>
      ) : (
        <>
          <div className="grid2">
            <label className="field">
              Accept same-day orders until
              <input
                className="input"
                type="time"
                required
                value={rule.sameDayCutoff}
                disabled={!isAdmin}
                onChange={(e) => setRule({ ...rule, sameDayCutoff: e.target.value })}
              />
            </label>
            <label className="field">
              Time zone
              <select className="select" value={rule.timeZone} disabled={!isAdmin} onChange={(e) => setRule({ ...rule, timeZone: e.target.value })}>
                {/* A zone set through the API that isn't in the list still shows. */}
                {!TIME_ZONES.some(([z]) => z === rule.timeZone) && <option value={rule.timeZone}>{rule.timeZone}</option>}
                {TIME_ZONES.map(([zone, label]) => (
                  <option key={zone} value={zone}>
                    {label} ({zone})
                  </option>
                ))}
              </select>
            </label>
          </div>
          {isAdmin ? (
            <button className="btn btn-brand" type="submit" disabled={pending || !changed} aria-busy={pending} style={{ width: "max-content" }}>
              {pending && <Spinner />}
              {pending ? "Saving…" : "Save cutoff"}
            </button>
          ) : (
            <span className="help">Only an admin can change the cutoff.</span>
          )}
        </>
      )}
    </form>
  );
}
