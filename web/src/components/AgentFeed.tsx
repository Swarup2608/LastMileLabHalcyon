"use client";

import { useSyncExternalStore } from "react";
import { useConsoleUser } from "@/components/console/ConsoleShell";
import { AGENTS, agentFeed, type AgentName, type FeedItem } from "@/lib/portal/liveAgents";
import Spinner from "./Spinner";

const TONE: Record<FeedItem["state"], string> = { working: "pri", done: "ok", warn: "warn", failed: "bad" };
const LABEL: Record<FeedItem["state"], string> = { working: "Working", done: "Done", warn: "Check", failed: "Failed" };
const server = { enabled: true, items: [], stats: {} } as unknown as ReturnType<typeof agentFeed.snapshot>;

// The real Foundry agents at work on the simulation: what each was asked, and what it answered. Read-only against the
// database; the carrier and allocation agents' answers feed back into the simulation.
export default function AgentFeed() {
  const user = useConsoleUser();
  const { enabled, items, stats } = useSyncExternalStore(agentFeed.subscribe, agentFeed.snapshot, () => server);
  // Staff only: the agents run for the operations console's simulation.
  if (user.type !== "staff") return null;
  const calls = (a: AgentName) => stats[a]?.calls ?? 0;

  return (
    <section className="card" style={{ marginBottom: 16 }} aria-labelledby="agents-h">
      <div className="card-h" id="agents-h">
        Agents at work
        <span className="r">
          <span className="muted" style={{ fontSize: 12, lineHeight: "16px" }}>
            Live calls to the real agents, nothing saved
          </span>
          <button
            type="button"
            className="switch"
            role="switch"
            aria-checked={enabled}
            aria-label="Live agents"
            onClick={() => agentFeed.setEnabled(!enabled)}
          />
        </span>
      </div>
      <div style={{ padding: "12px 16px", display: "flex", flexWrap: "wrap", gap: 8 }}>
        {AGENTS.map((a) => (
          <span key={a} className="chip">
            {a} · {calls(a)} call{calls(a) === 1 ? "" : "s"}
            {stats[a]?.failed ? ` · ${stats[a].failed} failed` : ""}
            {stats[a]?.skipped ? ` · ${stats[a].skipped} skipped while busy` : ""}
          </span>
        ))}
      </div>
      {items.length === 0 ? (
        <p className="muted" style={{ margin: 0, padding: "0 16px 16px", fontSize: 13 }}>
          {enabled
            ? "Press play on the demo clock. Order emails go to the email agent, the carrier agent plans at 08:00, and stock-outs go to the allocation agent."
            : "Live agents are off: the simulation runs on its built-in rules."}
        </p>
      ) : (
        <ul style={{ listStyle: "none", margin: 0, padding: "0 16px 16px", display: "grid", gap: 8, maxHeight: 360, overflowY: "auto" }} aria-live="polite">
          {items.map((i) => (
            <li key={i.id} style={{ display: "grid", gridTemplateColumns: "auto 1fr", gap: "2px 12px", fontSize: 13, lineHeight: "18px" }}>
              <span className={`chip ${TONE[i.state]}`} style={{ gridRow: "span 2", alignSelf: "start" }}>
                {i.state === "working" && <Spinner />}
                {LABEL[i.state]}
              </span>
              <span>
                <b>{i.agent}</b> · {i.title}
                <span className="muted"> · {i.clock}{i.took ? ` · ${(i.took / 1000).toFixed(1)}s` : ""}</span>
              </span>
              {i.detail && <span className="muted">{i.detail}</span>}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
