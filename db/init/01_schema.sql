-- Halcyon hackathon schema. Loads the supplied synthetic CSVs on first container start.

CREATE TABLE clients (
  client_id              TEXT PRIMARY KEY,
  client_name            TEXT,
  region                 TEXT,
  primary_order_channel  TEXT,
  account_tier           TEXT,
  sla_penalty_clause     CHAR(1),
  annual_revenue_usd     NUMERIC,
  account_status         TEXT
);

CREATE TABLE carriers (
  carrier_id                   TEXT PRIMARY KEY,
  carrier_name                 TEXT,
  has_api                      CHAR(1),
  delivery_event_feed          TEXT,
  preferred_supplier_agreement CHAR(1),
  base_rate_usd                NUMERIC
);

CREATE TABLE warehouses (
  warehouse_id              TEXT PRIMARY KEY,
  warehouse_name            TEXT,
  region                    TEXT,
  pick_list_cutoff          TEXT,
  carrier_collection_window TEXT
);

CREATE TABLE warehouse_region_distance (
  warehouse_id TEXT PRIMARY KEY REFERENCES warehouses(warehouse_id),
  midwest      INT,
  southeast    INT,
  northeast    INT,
  west         INT
);

CREATE TABLE deliveries (
  delivery_id                 TEXT PRIMARY KEY,
  order_id                    TEXT,
  client_id                   TEXT REFERENCES clients(client_id),
  order_channel               TEXT,
  email_format_id             INT,
  order_received_ts           TIMESTAMP,
  commitment_type             TEXT,
  promised_date               DATE,
  address_status              TEXT,
  pick_list_date              DATE,
  shipped_ts                  TIMESTAMP,
  destination_region          TEXT,
  nearest_warehouse_id        TEXT REFERENCES warehouses(warehouse_id),
  fulfilment_warehouse_id     TEXT REFERENCES warehouses(warehouse_id),
  nearest_warehouse_had_stock CHAR(1),
  distance_miles              INT,
  carrier_id                  TEXT REFERENCES carriers(carrier_id),
  carrier_rate_usd            NUMERIC,
  stops_on_route              INT,
  planned_route_km            NUMERIC,
  actual_route_km             NUMERIC,
  delivered_date              DATE,
  days_late                   INT,
  on_time                     CHAR(1),
  redelivery_cost_usd         NUMERIC
);

CREATE TABLE sla_penalties (
  penalty_id  TEXT PRIMARY KEY,
  delivery_id TEXT REFERENCES deliveries(delivery_id),
  client_id   TEXT REFERENCES clients(client_id),
  days_late   INT,
  penalty_usd NUMERIC
);

CREATE TABLE complaints (
  complaint_id               TEXT PRIMARY KEY,
  complaint_date             DATE,
  client_id                  TEXT REFERENCES clients(client_id),
  delivery_id                TEXT REFERENCES deliveries(delivery_id),
  channel                    TEXT,
  category                   TEXT,
  escalated_to_account_owner CHAR(1),
  text                       TEXT
);

CREATE TABLE cs_time_study (
  staff_id                       TEXT,
  week_of                        DATE,
  hours_total                    NUMERIC,
  hours_on_delivery_complaints   NUMERIC,
  hours_keying_email_orders      NUMERIC,
  hours_on_proactive_client_work NUMERIC
);

COPY clients    FROM '/data/clients.csv'    WITH (FORMAT csv, HEADER true);
COPY carriers   FROM '/data/carriers.csv'   WITH (FORMAT csv, HEADER true);
COPY warehouses FROM '/data/warehouses.csv' WITH (FORMAT csv, HEADER true);
COPY warehouse_region_distance FROM '/data/warehouse_region_distance_miles.csv' WITH (FORMAT csv, HEADER true);
COPY deliveries FROM '/data/deliveries.csv' WITH (FORMAT csv, HEADER true);
COPY sla_penalties FROM '/data/sla_penalties.csv' WITH (FORMAT csv, HEADER true);
COPY complaints FROM '/data/complaints.csv' WITH (FORMAT csv, HEADER true);
COPY cs_time_study FROM '/data/customer_success_time_study.csv' WITH (FORMAT csv, HEADER true);

-- Derived flags used by the diagnostics and the risk engine.
CREATE VIEW delivery_facts AS
SELECT d.*,
       (d.on_time = 'Y')                                              AS is_on_time,
       (d.address_status = 'incomplete')                              AS f_incomplete_address,
       (d.nearest_warehouse_had_stock = 'N'
         OR d.fulfilment_warehouse_id <> d.nearest_warehouse_id)      AS f_off_nearest_stock,
       (d.commitment_type = 'same_day'
         AND d.order_received_ts::time >= TIME '08:00')               AS f_same_day_after_cutoff,
       (d.order_received_ts::time >= TIME '08:00')                    AS f_after_cutoff
FROM deliveries d;

CREATE INDEX idx_deliveries_client  ON deliveries(client_id);
CREATE INDEX idx_deliveries_carrier ON deliveries(carrier_id, fulfilment_warehouse_id, commitment_type);

-- Audit trail for every order the pipeline checks, and the human decision on it.
CREATE TABLE order_checks (
  id               SERIAL PRIMARY KEY,
  created_at       TIMESTAMP NOT NULL DEFAULT now(),
  source           TEXT NOT NULL,          -- 'email' or 'form'
  raw_input        TEXT,
  extracted        JSONB NOT NULL,
  extraction_mode  TEXT NOT NULL,          -- 'claude' or 'rules'
  risk             JSONB NOT NULL,
  carrier_options  JSONB NOT NULL,
  client_notice    TEXT,
  notice_mode      TEXT,
  status           TEXT NOT NULL DEFAULT 'pending_review',  -- pending_review | approved | rejected
  reviewer_note    TEXT,
  decided_at       TIMESTAMP
);
