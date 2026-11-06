"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import Icon from "@/components/Icon";
import Table from "@/components/Table";
import { DEFAULT_PAGE_SIZE } from "@/lib/pagination";
import { useConsoleUser } from "./ConsoleShell";
import UsersTabs from "./UsersTabs";

import { ACCOUNT_STATUSES, CLIENT_REGIONS, clientsApi, type Client, type ClientList } from "@/lib/clients";
import ClientLoginsDialog from "./ClientLoginsDialog";


const usd = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
const statusLabel = (status: string | null) => (status ?? "unknown").replace(/_/g, " ");

// Every client company from the database, searchable by id or name. Admins can sign up new ones.
export default function ClientsView() {
  const user = useConsoleUser();
  const [search, setSearch] = useState("");
  const [q, setQ] = useState("");
  const [region, setRegion] = useState("");
  const [status, setStatus] = useState("");
  const [offset, setOffset] = useState(0);
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE);
  const [page, setPage] = useState<ClientList | null>(null);
  const [error, setError] = useState(false);
  const [loginsFor, setLoginsFor] = useState<Client | null>(null);
  const isAdmin = user.role === "admin";

  // Search as you type, without a request per keystroke.
  useEffect(() => {
    const t = setTimeout(() => {
      setQ(search.trim());
      setOffset(0);
    }, 250);
    return () => clearTimeout(t);
  }, [search]);

  useEffect(() => {
    let active = true;
    clientsApi
      .list({ q, region, status, limit: pageSize, offset })
      .then((result) => {
        if (!active) return;
        setPage(result);
        setError(false);
      })
      .catch(() => active && setError(true));
    return () => {
      active = false;
    };
  }, [q, region, status, offset, pageSize]);

  const total = page?.total ?? 0;

  return (
    <>
      <div className="page-h">
        <div>
          <p className="kick">Accounts</p>
          <h1>Users</h1>
          <p>Clients: every client company Halcyon ships for{page ? `, ${total.toLocaleString("en-US")} matching` : ""}.</p>
        </div>
        {isAdmin && (
          <div className="acts">
            <Link className="btn btn-brand" href="/portal/clients/new">
              <Icon name="plus" />
              Sign up client
            </Link>
          </div>
        )}
      </div>

      <UsersTabs current="clients" />

      <section className="card" aria-label="Clients">
        <div className="toolbar">
          <select
            className="select"
            aria-label="Region"
            value={region}
            onChange={(e) => {
              setRegion(e.target.value);
              setOffset(0);
            }}
          >
            <option value="">All regions</option>
            {CLIENT_REGIONS.map((r) => (
              <option key={r} value={r}>{r}</option>
            ))}
          </select>
          <select
            className="select"
            aria-label="Account status"
            value={status}
            onChange={(e) => {
              setStatus(e.target.value);
              setOffset(0);
            }}
          >
            <option value="">All statuses</option>
            {ACCOUNT_STATUSES.map((s) => (
              <option key={s} value={s}>{statusLabel(s)}</option>
            ))}
          </select>
          <label className="searchbox">
            <span className="sr">Search clients</span>
            <Icon name="magnifying-glass" />
            <input
              className="input"
              placeholder="Client id or name"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </label>
        </div>

        {error ? (
          <div className="empty" role="alert">
            <Icon name="warning" className="lg" />
            We couldn’t load clients. Refresh the page to try again.
          </div>
        ) : !page ? (
          <div className="empty" aria-busy="true">Loading clients…</div>
        ) : (
          <Table
            label="Clients"
            noun="clients"
            rows={page.clients}
            rowKey={(c) => c.clientId}
            empty={
              <div className="empty">
                <Icon name="storefront" className="lg" />
                No clients match these filters.
              </div>
            }
            paging={{
              total,
              page: Math.floor(offset / pageSize) + 1,
              pageSize,
              onPage: (p) => setOffset((p - 1) * pageSize),
              onPageSize: (n) => {
                setPageSize(n);
                setOffset(0);
              },
            }}
            columns={[
              {
                key: "client",
                header: "Client",
                cell: (c) => (
                  <>
                    {c.clientName ?? "Unnamed client"}
                    <span className="sub mono">{c.clientId}</span>
                  </>
                ),
              },
              { key: "region", header: "Region", cell: (c) => c.region ?? "–" },
              { key: "channel", header: "Orders by", cell: (c) => <span className="chip ch">{c.primaryOrderChannel ?? "–"}</span> },
              { key: "tier", header: "Tier", cell: (c) => c.accountTier ?? "–" },
              {
                key: "sla",
                header: "SLA penalty",
                cell: (c) => (c.slaPenaltyClause ? <span className="chip warn">Yes</span> : <span className="muted">No</span>),
              },
              {
                key: "revenue",
                header: "Annual revenue",
                numeric: true,
                cell: (c) => (c.annualRevenueUsd === null ? "–" : usd.format(c.annualRevenueUsd)),
              },
              {
                key: "status",
                header: "Status",
                cell: (c) => <span className={`chip ${c.accountStatus === "active" ? "ok" : "bad"}`}>{statusLabel(c.accountStatus)}</span>,
              },
              ...(isAdmin
                ? [
                    {
                      key: "logins",
                      header: <span className="sr">Logins</span>,
                      cell: (c: Client) => (
                        <button className="btn btn-secondary btn-sm" type="button" onClick={() => setLoginsFor(c)}>
                          <Icon name="users" />
                          Logins
                        </button>
                      ),
                    },
                  ]
                : []),
            ]}
          />
        )}
      </section>
      {loginsFor && <ClientLoginsDialog key={loginsFor.clientId} client={loginsFor} onClose={() => setLoginsFor(null)} />}
    </>
  );
}
