"use client";

import { useEffect, useId, useRef, useState } from "react";
import { clientsApi, type Client } from "@/lib/clients";
import type { OrderRequest } from "@/lib/order-request";
import RqIcon from "./RqIcon";

const money = (n: number) => `$${n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : `${Math.round(n / 1e3)}K`}`;

// The client account an emailed order is from: found from a client login in the email, or picked by staff. Unlinked,
// it suggests the clients whose products the order matched and searches the rest; linked, it shows the account's
// tier, SLA and standing, and the client sees the request on their own Orders and Messages pages. Linking also makes
// that client's product win when a name is shared across catalogues.
export default function ClientCard({
  request: r,
  onChange,
  disabled,
}: {
  request: OrderRequest;
  // null unlinks, even a client the email matched.
  onChange: (clientId: string | null) => void;
  disabled?: boolean;
}) {
  const { clientId } = r;
  const [client, setClient] = useState<Client | null>(null);
  // The id whose load failed, so linking another starts clean.
  const [failedId, setFailedId] = useState<string | null>(null);
  const failed = !!clientId && failedId === clientId;

  useEffect(() => {
    if (!clientId) return;
    let active = true;
    clientsApi.get(clientId).then(
      (res) => active && setClient(res.client),
      () => active && setFailedId(clientId),
    );
    return () => {
      active = false;
    };
  }, [clientId]);

  // Clients owning the matched products, most items first.
  const owners = new Map<string, { name: string; items: number }>();
  for (const l of r.lines) {
    if (!l.product || l.declined) continue;
    const o = owners.get(l.product.clientId) ?? { name: l.product.clientName ?? l.product.clientId, items: 0 };
    owners.set(l.product.clientId, { ...o, items: o.items + 1 });
  }
  const suggested = [...owners].sort((a, b) => b[1].items - a[1].items);

  const shown = clientId && client?.clientId === clientId ? client : null;

  return (
    <div className="card rq-aside">
      <h4 className="rq-eyebrow">Client account</h4>
      {clientId ? (
        failed ? (
          <p className="muted">We couldn’t load {clientId} from Halcyon.</p>
        ) : !shown ? (
          <p className="muted" aria-busy="true">Loading {clientId}…</p>
        ) : (
          <>
            <dl className="rq-kv">
              <dt>Client</dt>
              <dd>
                {shown.clientName ?? shown.clientId}
                <small className="rq-sub mono">{shown.clientId}</small>
              </dd>
              <dt>Tier</dt>
              <dd>{shown.accountTier ?? <span className="rq-empty">Not set</span>}</dd>
              <dt>Region</dt>
              <dd>{shown.region ?? <span className="rq-empty">Not set</span>}</dd>
              <dt>Orders by</dt>
              <dd>{shown.primaryOrderChannel ?? <span className="rq-empty">Not set</span>}</dd>
              <dt>SLA penalty</dt>
              <dd>{shown.slaPenaltyClause ? "Yes" : "No"}</dd>
              {shown.annualRevenueUsd !== null && (
                <>
                  <dt>Revenue</dt>
                  <dd className="mono">{money(shown.annualRevenueUsd)} a year</dd>
                </>
              )}
            </dl>
            <p className="rq-note">
              <RqIcon name="info" />
              <span>
                {r.clientAuto ? "Linked automatically: a login of this client is in the email. " : ""}
                They see this request on their Orders and Messages pages.
              </span>
            </p>
            {(shown.accountStatus === "threatening_to_leave" || shown.slaPenaltyClause) && (
              <p className="rq-note warn">
                <RqIcon name="alert" />
                <span>
                  {shown.accountStatus === "threatening_to_leave" ? "This client is at risk of leaving. " : ""}
                  {shown.slaPenaltyClause ? "A late shipment costs an SLA penalty." : "Handle it promptly."}
                </span>
              </p>
            )}
          </>
        )
      ) : suggested.length ? (
        <div className="rq-lines">
          {suggested.map(([id, o]) => (
            <div key={id} className="rq-resolved">
              <RqIcon name="info" />
              <span>
                {suggested.length === 1 ? "The products are" : `${o.items} ${o.items === 1 ? "item is" : "items are"}`} from{" "}
                <b>{o.name}</b>’s catalogue
              </span>
              {!disabled && (
                <button className="btn btn-secondary btn-sm" type="button" onClick={() => onChange(id)}>
                  Link
                </button>
              )}
            </div>
          ))}
        </div>
      ) : (
        <p className="muted">Not linked to a client yet.</p>
      )}
      {!disabled && <ClientSearch linked={!!clientId} onPick={onChange} />}
    </div>
  );
}

// Search the clients by name or id; with one linked, also offers to unlink.
function ClientSearch({ linked, onPick }: { linked: boolean; onPick: (clientId: string | null) => void }) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [found, setFound] = useState<Client[] | null>(null);
  const listId = useId();
  const wrap = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    let active = true;
    const t = setTimeout(() => {
      clientsApi.list({ q: query.trim() || undefined, limit: 8 }).then(
        (res) => active && setFound(res.clients),
        () => active && setFound([]),
      );
    }, 250);
    return () => {
      active = false;
      clearTimeout(t);
    };
  }, [query, open]);

  return (
    <div className="rq-match-row" style={{ marginTop: 12 }}>
      <div
        className="rq-combo"
        ref={wrap}
        onBlur={(e) => {
          if (!wrap.current?.contains(e.relatedTarget as Node)) setOpen(false);
        }}
      >
        <input
          className="input"
          placeholder={linked ? "Change client" : "Search clients"}
          value={query}
          role="combobox"
          aria-expanded={open}
          aria-controls={listId}
          autoComplete="off"
          onFocus={() => setOpen(true)}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
          }}
          onKeyDown={(e) => e.key === "Escape" && setOpen(false)}
        />
        {open && (
          <div className="rq-pop" id={listId} role="listbox">
            {!found ? (
              <div className="rq-pop-empty">Searching…</div>
            ) : found.length ? (
              found.map((c) => (
                <button
                  key={c.clientId}
                  className="rq-opt"
                  type="button"
                  role="option"
                  aria-selected={false}
                  onClick={() => {
                    setOpen(false);
                    setQuery("");
                    onPick(c.clientId);
                  }}
                >
                  <span>
                    {c.clientName ?? c.clientId}
                    <small className="mono">{c.clientId}</small>
                  </span>
                  <small>{[c.accountTier, c.region].filter(Boolean).join(" · ")}</small>
                </button>
              ))
            ) : (
              <div className="rq-pop-empty">No client matches “{query}”.</div>
            )}
          </div>
        )}
      </div>
      {linked && (
        <button className="btn btn-quiet btn-sm" type="button" onClick={() => onPick(null)}>
          Unlink
        </button>
      )}
    </div>
  );
}
