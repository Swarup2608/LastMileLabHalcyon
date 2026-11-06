# Halcyon: discovery document

|              |                                                         |
| ------------ | ------------------------------------------------------- |
| **Product**  | Halcyon operations portal (repository: Last-Mile-Labs)  |
| **Client**   | Halcyon Logistics Group (fictional, hackathon scenario) |
| **Document** | Problem, users, requirements and scope                  |
| **Date**     | 30 October 2026                                         |
| **Status**   | Draft for stakeholder review                            |

---

## 1. Summary

Halcyon Logistics' leadership believes late deliveries are a carrier routing problem and is about to sign for a routing optimisation product. The delivery data does not support that as the main explanation.

**29.0% of the 48,340 deliveries were late** (April to September 2026). Two-thirds of those late deliveries (65.2%) carried at least one problem that was **created at order intake, before any carrier was involved**:

1. **Same-day orders accepted after the 08:00 pick-list cutoff.** These always land on the next day's pick list, yet are still promised for the same day. 61% are late.
2. **Incomplete delivery addresses shipped as-is.** 65% are late, and email orders are five times more likely to arrive incomplete than API or EDI orders.
3. **The nearest warehouse is out of stock**, so the order ships from about 1,240 miles away instead of about 150. 50% are late.

Carriers do matter, but in a specific way: three of the six carriers are reliable in some regions and poor in others. Five carrier–region lanes carry 16% of orders and 26% of late deliveries. **Route efficiency, which a routing product would optimise, only matters within the roughly 15% of late deliveries left over once intake problems and weak lanes are accounted for.**

The cost is significant. Over about six months, the late deliveries led to **$872,460 in SLA penalties** and **$476,646 in redelivery costs**. Nine clients are threatening to leave, representing **$14.2M (13.5%) of annual revenue**. The customer success team spends **64% of its week handling complaints** and only 25% on proactive client work.

The business has since confirmed the mechanics behind each cause: no address check on any channel, no stock check when an order is accepted, a stock allocation fixed at onboarding and reviewed only quarterly, and carriers assigned on cost and habit without looking at lane performance (section 11.1).

The Halcyon portal addresses the three intake causes directly, and recommends carriers per region rather than routes. Its own week simulation estimates about **+14 percentage points on-time** (71% to 85%, range +12.7 to +16.1 over 20 weeks), of which +12.3 comes from the four rules already built. The simulation's "before" matches the real 71% on-time rate (section 9, A5). That figure is a model, not a measured result.

**Recommendation for leadership:** fix intake and carrier-lane allocation first. Re-assess the routing product against the residual late deliveries once those are in place.

---

## 2. Sources and how to read this document

| Source                                   | What it provided                                                                                                                                       | Access                                                                                     |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------ |
| `db/data/*.csv` and `DATA_DICTIONARY.md` | Six months of deliveries, clients, carriers, warehouses, penalties, complaints and a customer-success time study. Analysed directly for this document. | Full                                                                                       |
| `db/data/README.md`                      | The scenario and the leadership belief being tested                                                                                                    | Full                                                                                       |
| `api/`, `web/`, `db/init/`               | What has been built, and how it behaves                                                                                                                | Full (code review plus a local run)                                                        |
| `npm run sim:week`                       | Modelled before/after comparison for one week, plus 20 seeded weeks                                                                                    | Run on 30 Oct 2026                                                                         |
| `SECURITY.md`                            | Security checks passed                                                                                                                                 | Full                                                                                       |
| `hackathon.xlsx` (participant question log) | Business answers to our questions Q-001 to Q-012 (section 11.1) | Full; answered by 30 Oct 2026 |
| _Participant Problem Pack_               | The official task and judging criteria                                                                                                                 | **Not available.** It is referenced in the data README but not included in the repository. |

Every claim below is tagged:

- **[Data]**: calculated from the CSVs (method in Appendix A).
- **[Code]**: confirmed in the repository.
- **[Sim]**: an output of the week simulation. This is a model, not a measurement.
- **[Business Q-0nn]**: confirmed by the business in the question log (section 11.1).
- **[Inference]**: a reasoned interpretation that has not been confirmed.
- **[Assumption]**: adopted to proceed, and listed in section 9.
- **[Open]**: needs a stakeholder answer (section 11).

All data is synthetic. No real client, carrier, person or address is involved.

---

## 3. The problem

### 3.1 What leadership believes

On-time delivery has fallen, clients are complaining and some are threatening to leave. Leadership attributes this to carrier routing and selection, and is about to buy a routing optimisation product. [Data README]

### 3.2 What the data shows

| #   | Finding                                                                                                                                                                                                                                                                                                                                                                                                                                 | Evidence                                                                                                               |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| F1  | Lateness is high and flat. 29.0% late overall, between 28.5% and 29.7% in every month from April to September.                                                                                                                                                                                                                                                                                                                          | [Data] The decline leadership describes is **not visible inside this window**; it may have happened earlier. [Open Q1] |
| F2 | **Same-day orders after 08:00 are the biggest single intake failure.** 53.6% of same-day orders (4,826) arrive after the 08:00 pick-list cutoff. Every one goes on the next day's pick list, yet each is still promised for the same day. 61.0% are late, against 26.0% for same-day orders received before 08:00. There are no exceptions: an order at 08:03 waits for the next day, yet Halcyon accepts same-day orders until 14:00 without checking the cutoff. For email orders the timestamp is when the order was **keyed**, not when it arrived (arrival isn't recorded); 78.0% of email orders are timestamped after 08:00, against 55.2% for EDI and API. | [Data], [Business Q-001, Q-002] |
| F3 | **Incomplete addresses are shipped anyway.** 5,994 orders (12.4%) were ingested with an incomplete address; 64.6% of them are late, against 24.0% for complete addresses. 27.8% of email orders are incomplete, against 5.3% for API and 5.2% for EDI. No channel checks addresses today, and EDI and API orders still make up 29.1% of incomplete addresses, so an email-only check would miss almost a third. | [Data], [Business Q-001] |
| F4 | **Stock outages at the nearest warehouse push orders far away.** In 12.4% of orders the nearest warehouse had no stock, so the average distance rose from 146 to 1,237 miles. 50.0% of these are late. The rate is constant (12.2% to 12.6%) every month, **Confirmed as real shortages caused by the fixed allocation**: the onboarding team sets each client's warehouse by judgement and reviews it once a quarter, and no channel checks stock when an order is accepted. There is no fallback rule either: the order ships from another region without considering distance, and 691 orders shipped far even though the nearest warehouse had stock (49.2% late). | [Data], [Business Q-003, Q-005, Q-010] |
| F5  | **Together, intake problems explain about half of all lateness.** 32.5% of orders have at least one of F2–F4. These orders are late 58.2% of the time, against 14.9% for orders with none. They make up 65.2% of late deliveries. Measured against the clean-order rate, about 6,800 late deliveries (48.5% of all late) are attributable to these causes.                                                                              | [Data]                                                                                                                 |
| F6 | **Carrier performance is lane-specific, not general.** On clean orders, carriers A, B and C are late 5–6% of the time in every region. D, E and F are fine in some regions and poor in others: D in the Midwest (46%) and Southeast (45%); E in the West (46%); F in the Northeast (43%) and Southeast (46%). Carrier D is also weaker elsewhere (about 22%). These five weak lanes carry 16.3% of orders and 25.8% of late deliveries. D stays on its weak lanes only because it's the second-cheapest carrier and a habit: lane performance isn't checked when carriers are assigned, and D has no agreement or volume commitment, so switching is open. | [Data], [Business Q-004] |
| F7  | **The preferred supplier is on two weak lanes.** Carrier F is Halcyon's only preferred supplier and has the lowest base rate ($10.50), yet it is in the weakest group for the Northeast and Southeast.                                                                                                                                                                                                                                  | [Data]                                                                                                                 |
| F8 | **Route efficiency is a residual factor.** Among orders with no intake problem and a good carrier lane, late rates are about 3% for the three-quarters of routes closest to plan, and 22% for the quarter that deviate most. The deviation does not differ by carrier. Only about 15% of late deliveries have neither an intake problem nor a weak lane. Planned distance is the carrier's road route; up to about 20% over plan is normal variation, and **25% or more over plan is a real routing problem**: 6.0% of orders, 63.6% of them late, **13.0% of late deliveries**. That is the share better routing could address. | [Data], [Business Q-009] |
| F9  | **Order channel doesn't affect lateness directly**: Email 29.3%, API 29.2%, EDI 28.5%. Email matters because it causes incomplete addresses (F3) and manual keying work (F10).                                                                                                                                                                                                                                                          | [Data]                                                                                                                 |
| F10 | **Customer success is consumed by firefighting.** In the studied week, 18 staff logged 720 hours: 460.8 (64%) on complaints and escalations, 44.4 (6%) keying email orders (six people, from 14 different email layouts), and 179.5 (25%) on proactive client work.                                                                                                                                                                     | [Data]                                                                                                                 |
| F11 | **Clients are frustrated by silence as well as lateness.** Of 34 formal complaints in the last 90 days, 14 are "Delivery late", 12 are "Not told about the delay", 6 are "Redelivery needed" and 2 are "Penalty dispute". 26 (76%) were escalated to account owners. 79% of complained-about deliveries had an intake problem. An advance warning would have addressed the 12 "not told" complaints, but not the other 22. | [Data], [Business Q-007] |

### 3.3 Root-cause chain

These Five Whys are hypotheses that have been checked against the data above, not proven causes.

1. **Why are deliveries late?** Mostly because orders enter the process already set up to fail (F5), and partly because of weak carrier lanes (F6).
2. **Why do orders enter that way?** Intake has no checks. Same-day is promised regardless of arrival time (F2), addresses aren't validated (F3), and nobody sees stock gaps until fulfilment (F4).
3. **Why are there no checks?** About a third of orders arrive by email in 14 layouts and are keyed in by hand (F10). No system applies the cutoff rule or validates addresses at the point of entry. [Inference]
4. **Why hasn't it been noticed?** Lateness surfaces only at delivery, as complaints, which customer success absorbs (F10, F11). The data has no "reason late" field, so the cause is never recorded. [Data README]
5. **Why is routing blamed?** Lateness appears at the carrier stage, and carrier performance does vary (F6), so carriers look like the cause. [Inference]

### 3.4 Cost of the problem

| Cost            | Amount                                          | Notes                                                                                                                                                                                       |
| --------------- | ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| SLA penalties   | **$872,460** (4,847 penalties)                  | 68.5% (about $598k) are linked to deliveries with an intake problem. [Data]                                                                                                                 |
| Redelivery      | **$476,646** (14,019 redeliveries)              | Every late delivery has a redelivery cost and no on-time delivery does. This looks like a data rule rather than real behaviour. [Data], [Open Q6]                                           |
| Revenue at risk | **$14.2M a year** (9 clients, 13.5% of revenue) | 7 are Tier 1 and 8 have SLA penalty clauses. Their late rate (29.0%) matches everyone else's, so penalties and escalations, not worse service, may be what drives them. [Data], [Inference] |
| Staff time      | **About 461 hours a week** on complaints        | Measured for one week only (14 September 2026). [Data]                                                                                                                                      |

Penalty and redelivery figures cover 1 April to 25 September 2026, the last order date in the data.

---

## 4. Users and stakeholders

### 4.1 Who is involved

| Group                       | Role in the problem                                                                     | Portal role                      | Size                        |
| --------------------------- | --------------------------------------------------------------------------------------- | -------------------------------- | --------------------------- |
| **Customer success staff**  | Key email orders, handle complaints, chase clients                                      | `contributor`                    | 18 [Data]                   |
| **Operations / admin**      | Set rules (cutoff), manage staff and client logins, own carrier and stock decisions     | `admin`                          | [Open]                      |
| **Client users**            | Place orders by email, API or EDI; receive deliveries; complain                         | `client` (sees own company only) | 280 client companies [Data] |
| **Account owners**          | Receive escalations, own at-risk relationships                                          | None today                       | [Open]                      |
| **Leadership**              | Decides on the routing-product contract and the carrier agreements                      | None today (receives findings)   | —                           |
| **Warehouse teams (W1–W5)** | Compile the 08:00 pick list and hand over to carriers. The scheduled window is 14:00–18:00, but collections actually run 08:30–17:00 and 59.3% leave before 14:00 [Business Q-012b] | None | 5 sites [Data] |
| **Onboarding team** | Decides which warehouse holds each client's stock, by judgement at onboarding; reviews it quarterly [Business Q-003] | None today (FR-07 suggestions would serve them) | [Open] |
| **Operations IT** | Maintains stock records in the warehouse system (real time, medium quality) [Business Q-005] | None | [Open] |
| **Carriers A–F**            | Collect and deliver. A–C provide event APIs; D uses a portal; E and F send batch files. | None (external)                  | 6 [Data]                    |

### 4.2 Primary personas

**Customer success contributor**

- **Job:** turn every incoming order into a correct, routed shipment, and keep clients informed.
- **Pains today:** retyping email orders from 14 layouts; finding out about address and stock problems only after a complaint; spending most of the week on escalations.
- **Needs:** every order in one queue with the problems already flagged; one place to fix the address, choose a warehouse and message the client; drafted messages they can review instead of writing from scratch.

**Operations admin**

- **Job:** set the rules, keep stock in the right warehouses, and pick carriers that perform.
- **Pains today:** no stock-out visibility per warehouse; no view of carrier performance by region; no single setting that enforces the cutoff.
- **Needs:** a cutoff setting the system enforces; per-region carrier rankings; transfer suggestions they can edit and approve.

**Client user**

- **Job:** get goods delivered on the date promised, with as little effort as possible.
- **Pains today:** same-day promises that aren't kept; no warning when delivery will be late; redeliveries; no way to check stock before ordering, so they learn of a shortage only when the delivery is late [Business Q-008].
- **Needs:** an honest promise date at order time; a quick question when their order is incomplete; proactive notice when something changes; a view of their own orders only.

### 4.3 Current workflow (as-is)

| Step             | Actor            | What happens                                             | Failure point                                         |
| ---------------- | ---------------- | -------------------------------------------------------- | ----------------------------------------------------- |
| 1. Order arrives | Client           | By EDI, API or email (14 layouts)                        | Email orders are often incomplete (F3)                |
| 2. Keying | Customer success | Email orders are retyped into the warehouse system; the keying time becomes the order time | Manual work (F10); no address or stock check on any channel [Business Q-001, Q-005] |
| 3. Promise | Client / system | The client picks the commitment type; same-day is accepted until 14:00 | Same-day is promised even after the 08:00 cutoff (F2) [Business Q-002] |
| 4. Allocation | Warehouse system | Ships from the nearest warehouse; if it's short, from another region with no rule on distance | 12% ship from far away (F4); 691 even when the nearest had stock [Business Q-010] |
| 5. Pick list     | Warehouse        | Compiled at 08:00                                        | Orders that arrive after 08:00 wait until tomorrow    |
| 6. Carrier | Operations | Chosen on cost and habit; lane performance isn't checked | Weak lanes are used (F6, F7) [Business Q-004] |
| 7. Delivery      | Carrier          | Delivers, sometimes off-plan                             | Route deviation (F8)                                  |
| 8. Aftermath     | Customer success | Handles complaints, redeliveries and penalties           | No proactive notice (F11); 64% of staff time (F10)    |

---

## 5. Goals and success metrics

The baselines come from the data. The targets are **proposed** and need leadership sign-off ([Open Q2]).

| Metric                                        | Baseline                     | Proposed target                                                         | How to measure                                        |
| --------------------------------------------- | ---------------------------- | ----------------------------------------------------------------------- | ----------------------------------------------------- |
| **On-time rate** (against the promise)        | 71.0%                        | +6 points within one quarter of go-live, half the +12.3 simulated for the four built rules, to allow for the model's assumptions | Weekly, from delivery records                         |
| **Same-day promises kept**                    | 55.2% (all same-day orders)  | ≥ 70%                                                                   | Same-day orders delivered on the promised date        |
| **Orders shipped with an incomplete address** | 12.4% of orders              | ≤ 3%                                                                    | Address status at the time of shipping, not at intake |
| **Staff hours on complaints**                 | 64% of customer success time | ≤ 40%                                                                   | Repeat the one-week time study                        |

**How on-time is measured** [Business Q-006]: a new date agreed with the client **before the order is accepted** becomes the promised date, and on-time is measured against it. A new date given **after acceptance** changes nothing: the delivery still counts as late against the original promise, with any SLA penalty. Report both effects separately against the 71% baseline.

The 450 rows delivered before they shipped (all same-day orders received after 08:00) are recording errors in `delivered_date`. They stay in the 71% baseline as on time, as the business asked, and are left out of any timing analysis [Business Q-011].

Supporting measures to track: SLA penalty dollars per month, the stock-out rate at the nearest warehouse, share of volume on weak lanes, and "not told about the delay" complaints.

The simulation also shows a choice for leadership. With the four built rules alone, **fewer same-day deliveries happen** (−19 points delivered that day), because orders after the cutoff are honestly promised for the next day. With the **proposed afternoon wave**, which doesn't exist today [Business Q-002], same-day deliveries rise instead (+24 points, 55% to 80%). It assumes orders complete between 08:00 and 13:00 are picked at 14:00, up to 15 a warehouse a day; pick capacity isn't recorded (A7). Either way, **far more of the promises made are kept** (55% to 88%, +33 points). [Sim], [Open Q3]

The simulation also splits the on-time gain by rule, each switched on alone: same-day cutoff +4.5 points, address questions +4.3, carrier ranking per region +2.0, AI stock transfers +1.9, nearest warehouse with stock +0.5, afternoon wave +0.0. The rules overlap, so the parts don't add up to the total. All six give +14.2: +12.3 from the four built rules, and +1.9 on top. The transfers' share assumes approved transfers prevent 50% of stock-outs, which the data can't give (A8); at 0% they add nothing. The team accepted this and the wave's limits as planning assumptions on 31 October 2026; neither has been measured. Taking the wave out raises on-time by 0.4 points, so its case rests on same-day delivery, not on-time. [Sim]

### 5.1 The gain in dollars (modelled)

**This is a model, not a measured result.** The "before" column comes from actual costs in the data [Data]. The other columns apply the simulated drop in late deliveries to those costs [Sim]. The main table uses the four rules built today (+12.3 points); the second table adds AI transfers. Amounts are rounded; totals are rounded from unrounded figures.

| Cost of late deliveries | Before: month | Before: year | With Halcyon (+12.3 pts): month | With Halcyon (+12.3 pts): year | Saving: month | Saving: year |
| ----------------------- | ------------- | ------------ | ------------------------------- | ------------------------------ | ------------- | ------------ |
| SLA penalties           | $149k         | $1.79M       | $86k                            | $1.04M                         | $63k          | $754k        |
| Redelivery              | $81k          | $977k        | $47k                            | $566k                          | $34k          | $412k        |
| **Total**               | **$231k**     | **$2.77M**   | **$133k**                       | **$1.60M**                     | **$97k**      | **$1.17M**   |

| Case                             | Fewer late deliveries | Cost after: month | Cost after: year | Saving: month | Saving: year |
| -------------------------------- | --------------------- | ----------------- | ---------------- | ------------- | ------------ |
| Proposed target (+6 pts)         | 20.5%                 | $183k             | $2.20M           | $47k          | $568k        |
| Four built rules, worst week (+10.7 pts) | 36.6%                 | $146k             | $1.75M           | $84k          | $1.01M       |
| Four built rules, average of 20 weeks (+12.3 pts) | 42.1%                 | $133k             | $1.60M           | $97k          | $1.17M       |
| Four built rules, best week (+14.3 pts) | 49.0%                 | $118k             | $1.41M           | $113k         | $1.35M       |
| All six rules, average of 20 weeks (+14.2 pts) | 48.6%                 | $118k             | $1.42M           | $112k         | $1.35M       |

**Method:**

1. **Annualise the actual cost.** $872,460 in penalties plus $476,646 in redelivery is $1,349,106 over the 178 days from 1 April to 25 September 2026. Multiplying by 365/178 gives $2,766,425 a year; dividing by 12 gives $230,535 a month. [Data]
2. **Work out the share of late deliveries avoided.** This is the points gained divided by the simulation's 29.2% late rate: 12.3 / 29.2 = 42.1%. [Sim]
3. **Reduce both costs by that share.** $2,766,425 × 42.1% = about $1.17M a year. Using the proposed target instead, 6 / 29.2 = 20.5%, gives $568k. [Inference]

**Why scaling both costs is reasonable:** every late delivery has a $34 redelivery cost, and every penalty is a flat $180 on a late delivery for a client with a penalty clause (4,847 of those clients' 6,849 late deliveries; none on time, none without a clause). Penalties per late delivery are similar across the causes Halcyon targets: $58 for same-day after the cutoff, $74 for incomplete addresses and $61 for stock-outs, against $62 overall. [Data]

**What this leaves out:**

- **It's a gross saving.** The cost of running Halcyon, of client address questions and of moving stock isn't subtracted; transfer cost is still to be stated (A8).
- **Redelivery may be overstated.** The 1:1 link between late deliveries and redelivery costs looks like a data rule. If a redelivery isn't really charged on every late delivery, the $412k a year shrinks. [Open Q6]
- **Revenue at risk isn't counted.** The $14.2M a year is outside these figures, because the data doesn't show how many of those clients would stay. Their late rate matches everyone else's (section 3.4).
- **Staff time isn't priced.** There's no hourly cost in the data, so the 461 hours a week on complaints have no dollar value here.
- **Carrier spend is treated as unchanged.** The simulation has it at $15.26 an order before and $15.24 after, about $2k a year. [Sim]
- **Same-day delivery has no dollar value.** The data doesn't show what −19 points delivered that day would cost in client goodwill, or what +24 points with the wave would earn. [Open Q3]
- **The range is week-to-week.** It shows the spread between simulated weeks, not a confidence interval.

Use the proposed-target row, **about $568k a year**, for any commitment to leadership, in line with the +6 point target above. The $1.17M is what the full simulated gain would be worth.

---

## 6. Requirements

Priority: **P0** must have; **P1** should have; **P2** could have; **P3** deferred. Status is taken from the code as of 30 October 2026. Acceptance criteria are **proposed** unless they are already covered by a test.

### 6.1 Functional requirements

| ID    | Requirement                                                                                                                  | Addresses | Pri | Proposed acceptance criterion                                                                                           | Status                                                                                                         |
| ----- | ---------------------------------------------------------------------------------------------------------------------------- | --------- | --- | ----------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| FR-01 | Apply a configurable same-day cutoff. Orders after it are promised for the next day, and the promise is shown at order time. | F2        | P0  | An order at 08:01 with a 08:00 cutoff is promised for the next day                                                      | **Built** [Code: settings, delivery rule, tests]                                                               |
| FR-02 | Pull email orders from a shared mailbox into one staff queue                                                                 | F3, F10   | P0  | A new email appears in the queue within one poll interval (default 60 s)                                                | **Built**, optional (Gmail) [Code]                                                                             |
| FR-03 | An AI agent reads each email and extracts the client, products, quantities and address                                       | F10       | P0  | Agent output is stored; staff can see and correct every field before routing                                            | **Built**, optional (Foundry) [Code]                                                                           |
| FR-03a | Set aside order requests that need no staff time: blank emails, repeats of an email from the last 7 days, emails the agent finds no order in, and an API order placed twice within 10 minutes | F10 | P1 | A repeat or blank email never reaches the queue, the agent, the client's list or the carrier plan; staff see why under Ignored and can restore it; a repeated API order gets 409 naming the first | **Built** (30 Oct 2026) [Code, tests: `order-screen.test.ts`, `security.test.ts`, `bad-input.test.ts`] |
| FR-04 | Flag incomplete addresses before routing and let staff ask the client | F3 | P0 | An incomplete order can't be auto-routed until it's resolved or staff override; the client's answer updates the request | **Built** for flagging and asking [Code: answers endpoint]; the API refuses routing while the address is incomplete, unless staff override with an audited `override: true`, which only an API call can send today. Must cover all channels: EDI and API are 29.1% of incomplete addresses [Business Q-001]. |
| FR-05 | Route to the nearest warehouse with stock and log every stock-out at the nearest warehouse                                   | F4        | P0  | Each routing decision writes or clears a stock-out event                                                                | **Built** [Code, tests]                                                                                        |
| FR-06 | Rank carriers per region from monthly performance and produce the day's same-day plan after the cutoff                       | F6, F7    | P0  | The plan never ranks a carrier above another with a lower late rate in that region unless the reason is stated          | **Built** as advisory; staff decide [Code]. Ranking quality not yet evaluated [Open Q4]                        |
| FR-07 | Suggest stock transfers between warehouses from 30 days of orders and stock-outs; staff edit and apply                       | F4        | P1  | Suggestions pass validation (no negative stock, no transfer above available); nothing moves without staff approval      | **Built** [Code, tests]                                                                                        |
| FR-08 | Draft an out-of-stock notice with a new delivery date for staff to review | F11 | P1 | The draft names the order, the items and the new date; it's only sent after staff confirm | **Built**, falls back to a template [Code] Raises on-time only when the new date is agreed before the order is accepted [Business Q-006]. |
| FR-09 | Client portal: place orders (form or email), see own orders, receive messages                                                | F3, F11   | P1  | Clients never see another company's data (security test)                                                                | **Built** [Code, security tests]                                                                               |
| FR-10 | **Notify clients proactively when a delivery will miss its promise** (any cause, not only stock) | F11 | P1 | A client is told before the promised date whenever a known delay exists | **Not built** Addresses the 12 "not told" complaints, not lateness itself [Business Q-007]. |
| FR-11 | Accept EDI orders into the same queue and checks as email and API | F2–F4 | P1 | An EDI order passes the cutoff, address and stock checks | **Not built**; EDI exists only as a channel label [Code] No channel checks address or stock today [Business Q-001, Q-005]. |
| FR-12 | Ingest carrier delivery events (API for A–C, portal for D, batch files for E and F) to detect delays early                   | F8, F11   | P2  | A carrier exception reaches the staff queue within one feed cycle                                                       | **Not built**                                                                                                  |
| FR-13 | Staff analytics: penalties, at-risk clients, weak lanes, stock-out trend                                                     | §3.4      | P2  | Real data only, clearly separated from the simulation                                                                   | **Partial**: Insights shows same-day charts only [Code]                                                        |
| FR-14 | Before/after week simulation for decision support                                                                            | §5        | P2  | Clearly labelled as modelled; assumptions printed                                                                       | **Built** (`sim:week`), calibrated to the 71% baseline, with a check that fails the run if it drifts [Code]                                                                                  |
| FR-15 | Route optimisation within a carrier's day                                                                                    | F8        | P3  | —                                                                                                                       | **Deferred** until FR-01 to FR-06 show their effect                                                            |

### 6.2 Non-functional requirements

| ID     | Area                     | Requirement                                                                                                                       | Status                                                                                                          |
| ------ | ------------------------ | --------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| NFR-01 | **Human in the loop**    | AI agents suggest; people confirm. No agent moves stock or messages a client without staff action. One routing exception: a complete order with every item in stock at one warehouse routes automatically, shows as routed automatically, and staff can undo or change it.        | **Built** by design [Code]                                                                                      |
| NFR-02 | **AI input safety**      | Email content is untrusted. Agent output is validated against a schema before use, and an agent can't trigger actions on its own. | **Built** for the carrier and rebalance outputs (validators and tests) [Code]. Prompt-injection samples tested: the email body is passed to the agent as data, and an injected API order note is stored as plain text (`api/test/bad-input.test.ts`). A full adversarial evaluation set [Open] |
| NFR-03 | **Graceful degradation** | Each integration is optional. The portal works without Gmail, Foundry, SMTP or Redis, and says what's off.                        | **Built** (startup log, UI messages) [Code]                                                                     |
| NFR-04 | **Access control**       | Three roles (admin, contributor, client); clients isolated to their own company; every change audited                             | **Built**. 189 tests: 189 pass, 0 fail [Code]                                      |
| NFR-05 | **Authentication**       | argon2id passwords, short-lived tokens, revocable sessions, CSRF protection, per-IP and per-account login limits                  | **Built** [Code, `SECURITY.md`]                                                                                 |
| NFR-06 | **Security finding** | SEC-01: an admin marked as demo has a public password. Admins may be demo accounts, but a demo account can't create or promote admins | **Direct paths closed; one accepted risk** [Code]: a demo admin can still reach lasting admin access through other account changes, until the demo accounts are deleted after the hackathon. Turn demo off on admins before anything public. First admin from `npm run admin:create` (SEC-05 fixed) |
| NFR-07 | **Data retention**       | Expired sessions deleted after 30 days, audit rows after 365 (configurable)                                                       | **Built** [Code]                                                                                                |
| NFR-08 | **Data honesty** | Simulated and real data are never mixed on one screen without a label | **Built** (30 Oct 2026): real pages show real data only; simulated data is only under the admin-only Simulation, with a "Simulated data" badge [Code] |
| NFR-09 | **Scale** | Handle about 270 orders a day (peaks of about 400) and about 50 same-day orders a day | **Measured** (`npm run bench:scale`, [`SCALE.md`](SCALE.md)): fine at today's volume (inbox about 0.1 s). At 10× nothing fails, but the inbox takes about 1.6 s and *My orders* and stock-outs 3–3.5 s with 20 concurrent users; the query fixes are listed. The *My orders* 500-row window bug found by the test is fixed (R-17) |
| NFR-10 | **Deployability**        | One command to run locally; CI deploys each app independently to Azure                                                            | **Built** [Code, `docs/SETUP.md`]                                                                               |

---

## 7. Scope

### In scope (the current release)

The intake-first workflow for staff, end to end: email intake with AI extraction, the resolve screen, the same-day cutoff, address questions to clients, routing to the nearest stocked warehouse with a stock-out log, the advisory carrier plan, the agent rebalance with staff approval, out-of-stock notices, the client portal, the audit log, and the before/after simulation.

### In scope next (P1 gaps)

- Proactive delay notifications for any cause (FR-10)
- EDI intake through the same checks (FR-11)

### Out of scope

| Item                                    | Reason                                                                                        |
| --------------------------------------- | --------------------------------------------------------------------------------------------- |
| Automatic carrier booking               | The plan is advisory. Booking needs carrier integrations and an approval policy [Open Q4].    |
| Route optimisation (FR-15)              | Addresses at most about 15% of late deliveries (F8). Revisit after the intake fixes.          |
| Carrier contract renegotiation          | Leadership decision. This document supplies the evidence (F6, F7).                            |
| Warehouse management system replacement | Halcyon sits in front of it; the warehouse system stays the system of record [Assumption A3]. |
| Real client, carrier or address data    | Hackathon rules: synthetic data only [Data README].                                           |
| Billing and penalty settlement          | No owner identified [Open].                                                                   |

### Recommendation on the routing product

Do not sign on the current evidence. A routing product targets F8, which sits inside the roughly 15% of late deliveries that remain after intake problems and weak lanes. About half of all lateness is attributable to intake problems (F5), and about a quarter of late deliveries sit on weak carrier–region lanes (F6). **Re-run this analysis about three months after the intake controls go live, and size the routing product against what's left.** [Inference, based on Data]

---

## 8. Constraints

| Constraint                                                                                                   | Source             |
| ------------------------------------------------------------------------------------------------------------ | ------------------ |
| Use only the supplied synthetic data; no real Halcyon, carrier or client information                         | Data README        |
| Pick lists are compiled at 08:00, with no exceptions after it | `warehouses.csv`, [Business Q-002] |
| Carriers' scheduled window is 14:00–18:00, but actual collections run 08:30–17:00 (59.3% before 14:00). Plan any later pick wave against actual `shipped_ts` | [Business Q-012b], [Data] |
| AI runs on Azure AI Foundry; data sent to agents is limited to the order and carrier fields each agent needs | `api/.env.example` |
| Deployed as two Azure App Services, Node 24                                                                  | CI workflow        |
| No "reason late" field exists; causes must be inferred                                                       | Data README        |

---

## 9. Assumptions

| #   | Assumption                                                                                                                                                                                                                                                                                                                                      | If wrong                                                                                                                     |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| A1  | The six months of data represent normal operations                                                                                                                                                                                                                                                                                              | Seasonal effects could shift the shares in F2–F8                                                                             |
| A2  | `address_status` at intake reflects what was shipped (no fixes happened in between)                                                                                                                                                                                                                                                             | F3 would overstate the address effect                                                                                        |
| A3  | The warehouse system remains the system of record; Halcyon sits in front of it                                                                                                                                                                                                                                                                  | An integration design is needed to write routing decisions back                                                              |
| A4  | The weak lanes in F6 are a stable carrier property, not a one-off                                                                                                                                                                                                                                                                               | Carrier ranking would need monthly refresh; this is already built (`carrier_performance` by month)                           |
| A5  | **The simulation is calibrated to history.** Each simulated order's warehouse outcome (nearest out of stock, or shipped farther anyway) is the real one of the delivery it was drawn from, so "before" comes out at 70.8% on time against 71.0% in history (it was 57% when it routed against the generated stock). Halcyon only ships farther when the nearest warehouse really had no stock. The four built rules are reported on their own, because the headline also credits AI transfers on an assumed 50% (A8) and has a proposed afternoon wave (A7) switched on. | The +12 points rests on segment on-time rates from history and on A6. Measure after go-live against the 71% baseline. |
| A6  | Clients answer address questions about 80% of the time                                                                                                                                                                                                                                                                                          | Fewer answers mean less on-time gain from FR-04 [Sim assumption]                                                             |
| A7 | **Pick-and-pack time and daily capacity per warehouse aren't recorded** [Business Q-012]. Observed peaks (80–134 shipments a warehouse a day) aren't the ceiling. An assumed time per order and capacity per site must be stated before claiming a later pick wave or rerouted volume fits. **[Open: values not yet chosen]** | A later pick wave or rebalanced volume (FR-07) may not fit the day |
| A8 | **Stock can move more often than quarterly**: the frequency is a design choice [Business Q-003]. FR-07 assumes staff-approved transfers from 30 days of demand. The cost and lead time of a transfer must be stated. **[Open: cost not yet chosen]** | Rebalancing may cost more than the late deliveries it prevents |

---

## 10. Risks

| Risk                                                                  | Severity | Mitigation                                                                                         | Owner                       |
| --------------------------------------------------------------------- | -------- | -------------------------------------------------------------------------------------------------- | --------------------------- |
| The AI misreads an email order (wrong product or quantity)            | High     | Staff confirm every field before routing (NFR-01); build an evaluation set from real email layouts | Product + customer success  |
| Implausible input is accepted: no quantity cap on emailed orders or staff routing edits (5,000,000 cartons is stored), and an address only needs non-empty fields | Medium | Add caps and a postcode/state check before go-live; today these are documented by `FINDING` tests in `api/test/bad-input.test.ts` and in `samples/README.md` | Engineering |
| A malicious email tries to manipulate an agent                        | Medium   | Agents have no tools that act; outputs are schema-validated; staff confirm. Add adversarial tests. | Engineering                 |
| Fewer same-day deliveries upset clients more than broken promises did | Medium   | Communicate the policy change; track the same-day kept-rate and complaints                         | Leadership + account owners |
| The simulated impact is presented as real                             | High     | Label every simulated figure; calibrated to history (A5); measure after go-live                              | Product                     |
| A demo admin (SEC-01) is left on in a public demo | Medium | It can't create or promote admins, but can change data: turn demo off on every admin before anything public | Engineering |
| Foundry or Gmail outage                                               | Medium   | The portal degrades to manual work (NFR-03); add alerting                                          | Operations                  |
| Carrier F is preferred and cheap but weak in two regions              | Medium   | Use per-region ranking; give leadership the evidence for the supplier conversation                 | Leadership                  |

---

## 11. Open questions

| #   | Question                                                                        | Why it matters / decision it unlocks                                                                              | Options (recommended first)                                                                              |
| --- | ------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| Q1  | Where does "on-time has fallen" come from, and what was the rate before April?  | The data shows lateness flat at 29%. Without an earlier baseline, the urgency case rests on cost, not on a trend. | Share pre-April data · Use penalties and churn as the case · Not sure                                    |
| Q2  | Which success metric does leadership care about most?                           | Sets the go-live target and what the demo must prove                                                              | On-time rate · Penalty dollars · Churn of the 9 at-risk clients · Staff hours                            |
| Q3  | Will leadership accept fewer same-day deliveries in exchange for kept promises? | FR-01 changes client-facing promises and may need contract or communication changes                               | Yes, with client communication · Yes, only for clients without SLA clauses · No, keep promising same-day |
| Q4  | Should the carrier plan stay advisory, or book carriers automatically?          | Determines integration work, approval rules and risk                                                              | Advisory with one-click approval · Fully advisory · Automatic within limits                              |
| Q5  | Are clients obliged to answer address questions, and how fast?                  | Determines whether incomplete orders wait or ship                                                                 | Wait up to a set time, then call · Ship after N hours · Hold until answered                              |
| Q6  | Is a redelivery really charged on every late delivery?                          | The data links them 1:1, which affects the cost model in §3.4                                                     | Confirm with finance · Treat as a data artefact                                                          |
| Q7  | Who owns the nine at-risk accounts, and what would keep them?                   | Their late rate matches everyone else's, so service fixes alone may not retain them                               | Account-owner interviews · Penalty review · Not sure                                                     |
| Q8  | Can Halcyon write routing decisions back to the warehouse system?               | Determines whether Halcyon advises or controls fulfilment (A3)                                                    | Read-only advice · Write-back integration · Not sure                                                     |

### 11.1 Answered by the business (question log, `hackathon.xlsx`)

| ID | Asked | Answer in short | Effect on this document |
| --- | --- | --- | --- |
| Q-001 | Email timestamp: arrival or keying? How are addresses checked? | Keying time; arrival isn't recorded. No address check on any channel; EDI and API are about 29% of incomplete addresses | F2, F3, FR-04, workflow step 2 |
| Q-002 | Can an 08:03 order join that day's pick list? Who decides same-day? | Never; no exceptions. The client picks same-day, accepted until 14:00 without a cutoff check. A later pick wave or new promise rule doesn't exist but may be proposed | F2, workflow step 3, constraints |
| Q-003 | Who decides stock allocation, and how often can it change? | The onboarding team, by judgement at onboarding; reviewed quarterly. Frequency is a design choice; state its cost | F4, stakeholders, A8 |
| Q-004 | Why is carrier D still used in the Midwest and Southeast? | Second-cheapest and habit; lanes aren't checked; no contract, so switching is an option | F6, workflow step 6 |
| Q-005 | Stock levels, who keeps the records, is stock checked at order time? | Levels aren't available or needed. Operations IT keeps real-time records (medium quality). No stock check at acceptance on any channel; shortages are real, from the fixed allocation | F4, stakeholders, FR-11 |
| Q-006 | Does a new delivery date reset on-time? | Only if agreed before the order is accepted. After acceptance it still counts as late, with any penalty | §5 measurement note, FR-08 |
| Q-007 | Would a heads-up have changed the 34 complaints? | Only the 12 "not told" ones; alerts improve communication, not lateness | F11, FR-10 |
| Q-008 | Can clients see stock before ordering? | No. They find out only when a late delivery makes them chase customer success | Client persona |
| Q-009 | Why do drivers drive more than 20% over plan? | Not recorded. Planned distance is the road route; up to 20% over is normal; 25% or more is a real routing problem | F8 (13.0% of late deliveries), Appendix A |
| Q-010 | Who picks the warehouse when the nearest is out of stock? | Nobody; there's no rule and distance isn't considered. Note the 691 far shipments where the nearest had stock | F4, workflow step 4 |
| Q-011 | Why are 450 deliveries delivered before they shipped? | Recording errors in `delivered_date`. Keep them in the 71% baseline as on time; exclude them from timing analysis | §5 note, Appendix A |
| Q-012 | Pick-pack time, target per order, daily capacity? | None recorded or needed. Assume and state both | A7 |
| Q-012b | When do carriers really collect? | `shipped_ts` is the real collection time. 14:00–18:00 is the scheduled window; collections actually run about 08:30–17:00, and more than half are before 14:00 (59.3% by our count; our question said 46%) | Stakeholders, constraints |

These answers don't settle the open questions above (Q1–Q8), which stay open.

---

## Appendix A: Method

All figures were calculated directly from the files in `db/data/`. The definitions are:

- **Late:** `on_time = N`.
- **After the cutoff:** `commitment_type = same_day` and order received at or after 08:00 local time. The cutoff is 08:00 at every warehouse.
- **Incomplete address:** `address_status = incomplete` at intake.
- **Stock-out at nearest:** `nearest_warehouse_had_stock = N`.
- **Intake problem:** any of the three conditions above.
- **Clean order:** none of the three.
- **Attributable late deliveries (F5):** the late rate of orders with an intake problem, minus the clean-order late rate, multiplied by the number of orders with an intake problem.
- **Weak lane (F6):** a carrier–region pair with a clean-order late rate above 40%: D–Midwest, D–Southeast, E–West, F–Northeast, F–Southeast.
- **Route deviation (F8):** `actual_route_km / planned_route_km`, split into quartiles. 1,339 rows with no actual distance were excluded.
- **Routing problem (F8, business definition):** that ratio at 1.25 or more [Business Q-009]; up to 1.20 is normal variation.
- **Penalty link (§3.4):** penalties joined to deliveries on `delivery_id`. All 4,847 matched.

The data has quirks worth knowing: `actual_route_km` is blank in 1,339 rows; `email_format_id` is blank for non-email orders, as designed; the last order is dated 25 September 2026, not 30 September; 450 same-day rows show delivery the day before shipping (recording errors, kept as on time in the baseline and excluded from timing analysis [Business Q-011]); and `shipped_ts` runs from 08:30 to 16:59, with 59.3% before 14:00 [Business Q-012b].

The simulation figures come from:

```
npm run sim:week -- --start 2026-11-02 --seed 1 --runs 20
```

This was run against the seeded database on 30 October 2026, without agents.

## Appendix B: Data at a glance

|                       | Value                                                                |
| --------------------- | -------------------------------------------------------------------- |
| Period                | 1 April – 25 September 2026                                          |
| Deliveries            | 48,340 (about 272 a day; about 51 same-day a day)                    |
| Clients               | 280 (271 active, 9 threatening to leave)                             |
| Annual client revenue | $105.2M                                                              |
| Warehouses            | 5 (Midwest 1, Midwest 2, Southeast, Northeast, West)                 |
| Carriers              | 6 (A–C with event APIs, D portal-only, E–F batch files; F preferred) |
| Order channels        | API 36.5%, EDI 31.9%, Email 31.7%                                    |
| Commitment types      | Standard 48.7%, next-day 32.7%, same-day 18.6%                       |
