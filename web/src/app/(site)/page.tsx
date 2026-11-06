import type { CSSProperties } from "react";
import Link from "next/link";
import Icon from "@/components/Icon";
import ProductShowcase from "@/components/ProductShowcase";
import Yard from "@/components/Yard";

const v = (n: number) => ({ "--v": n }) as CSSProperties;

// The portal's brand mark, so the site and the signed-in app look like one product.
const Logo = () => (
  <span className="logo-mk">
    <Icon name="package" />
  </span>
);

const ribbonInputs = ["Order emails", "API orders", "Client portal", "EDI clients", "5 warehouses", "6 carriers", "4 regions"];
const ribbonChecks = ["Email intake", "Missing details", "Same-day cutoff", "Nearest warehouse", "Stock rebalancing", "Carrier plan"];

// The marquee scrolls by -50%, so each band repeats its items four times.
const Track = ({ items }: { items: string[] }) => (
  <div className="track-x">
    {[0, 1, 2, 3].flatMap((n) => items.map((s) => <span key={`${n}-${s}`}>{s}</span>))}
  </div>
);

export default function Home() {
  return (
    <>
      <header className="nav">
        <div className="wrap">
          <a href="#top" className="brand" aria-label="Halcyon home">
            <Logo />
            Halcyon
          </a>
          <nav className="nav-links" aria-label="Main">
            <a href="#platform">Platform</a>
            <a href="#product">Product</a>
            <a href="#security">Security</a>
            <a href="#start">Who it&apos;s for</a>
            <Link href="/marketplace">Marketplace</Link>
          </nav>
          <div className="nav-cta">
            <Link className="btn btn-line btn-sm signin" href="/signin">Sign in</Link>
            <Link className="btn btn-blue btn-sm" href="/marketplace">Marketplace</Link>
          </div>
        </div>
      </header>

      <main id="top">
        <section className="hero">
          <div className="wrap hero-grid">
            <div className="hero-copy">
              <span className="badge"><b>NEW</b>Order intake to despatch for Halcyon Logistics</span>
              <h1>Stop late deliveries <em>before</em> they reach the dock.</h1>
              <p className="lede">
                Halcyon takes orders by email, API and client portal, checks the address and stock, and routes each one
                to the nearest warehouse that can ship it. Anything it can&apos;t settle goes to Halcyon&apos;s team with a reply to
                the customer already drafted.
              </p>
              <div className="hero-cta">
                <Link className="btn btn-blue" href="/marketplace">Open the marketplace <span className="arr" aria-hidden="true">→</span></Link>
                <a className="btn btn-line" href="#product">See the product</a>
              </div>
            </div>
            <Yard />
          </div>
          <div className="ribbon" aria-hidden="true">
            <div className="band b2"><Track items={ribbonInputs} /></div>
            <div className="band b1"><Track items={ribbonChecks} /></div>
          </div>
        </section>

        <section className="stats-sec" aria-label="Key figures">
          <div className="wrap">
            <div className="stats">
              <div className="stat"><span className="src">WAREHOUSES</span><div className="n">5</div><p>ranked by distance to every delivery region</p></div>
              <div className="stat"><span className="src">CARRIERS</span><div className="n">6</div><p>planned each day on late rate and capacity by region</p></div>
              <div className="stat"><span className="src">SAME-DAY CUTOFF</span><div className="n">08:00</div><p>by default, set by a Halcyon admin with its time zone</p></div>
              <div className="stat"><span className="src">AI AGENTS</span><div className="n">4</div><p>reading orders, drafting replies, planning stock and carriers</p></div>
            </div>
          </div>
        </section>

        <section id="platform">
          <div className="wrap">
            <div className="head">
              <span className="kicker">The platform</span>
              <h2>Six steps between the inbox and the doorstep.</h2>
              <p className="lede">Each step runs where its problem starts, while there is still time to fix it.</p>
            </div>
            <div className="checks">
              <article className="card">
                <div className="vis">
                  <div className="mform">
                    <div><span>Street</span><span>4112 Market Pkwy</span><i></i></div>
                    <div><span>City</span><span>Albany, NY</span><i></i></div>
                    <div><span>ZIP</span><span className="x">missing</span><i></i></div>
                    <div><span>Items</span><span>Compact lamp ×10</span><i></i></div>
                  </div>
                </div>
                <div className="card-body">
                  <div className="stage"><span>Order arrives</span><b>Intake agent</b></div>
                  <h3>Email intake</h3>
                  <p>Halcyon watches the order inbox. An AI agent reads each email, whatever its layout, into a structured order: customer, address, products and quantities.</p>
                </div>
              </article>
              <article className="card">
                <div className="vis">
                  <div className="chat">
                    <div className="bubble">Hi, order PO-857347 is missing the ZIP for 4112 Market Pkwy, Albany NY. Could you reply with it?</div>
                    <div className="acts"><span>Edit</span><span className="go">Send</span></div>
                  </div>
                </div>
                <div className="card-body">
                  <div className="stage"><span>Before routing</span><b>Exceptions</b></div>
                  <h3>Missing details</h3>
                  <p>A missing address, product or quantity puts the order in the exceptions queue. Staff ask the customer in one click, and questions left unanswered for a day come back to be chased.</p>
                </div>
              </article>
              <article className="card">
                <div className="vis">
                  <div className="clock">
                    <div className="dial"><span className="h"></span><span className="m"></span><span className="c"></span></div>
                    <div className="clock-txt">
                      <span style={{ color: "var(--faint)" }}>SAME-DAY CUTOFF</span>
                      <b>08:00</b>
                      <span className="pill warn">After it → next day</span>
                    </div>
                  </div>
                </div>
                <div className="card-body">
                  <div className="stage"><span>The promise</span><b>Settings</b></div>
                  <h3>Same-day cutoff</h3>
                  <p>Orders in before the cutoff deliver today; later ones deliver tomorrow. Admins set the time and time zone, and the console counts down to it.</p>
                </div>
              </article>
              <article className="card">
                <div className="vis routevis">
                  <svg viewBox="0 0 320 132" aria-hidden="true">
                    <path d="M56 34 C130 30 200 40 268 70" fill="none" stroke="var(--line-2)" strokeWidth="3" strokeDasharray="6 7" />
                    <path d="M56 100 C130 104 200 96 268 70" fill="none" stroke="var(--blue)" strokeWidth="3" />
                    <circle cx="44" cy="34" r="9" fill="var(--risk)" />
                    <circle cx="44" cy="100" r="9" fill="var(--blue)" />
                    <circle cx="280" cy="70" r="9" fill="var(--ink)" />
                    <text x="62" y="20" fontFamily="Geist Mono, monospace" fontSize="11" fill="var(--risk)">W1 · short</text>
                    <text x="62" y="124" fontFamily="Geist Mono, monospace" fontSize="11" fill="var(--blue)">W3 · has it all</text>
                    <text x="280" y="98" textAnchor="middle" fontFamily="Geist Mono, monospace" fontSize="11" fill="var(--muted)">Customer</text>
                  </svg>
                </div>
                <div className="card-body">
                  <div className="stage"><span>Routing</span><b>Automatic</b></div>
                  <h3>Nearest warehouse</h3>
                  <p>Warehouses are ranked by distance to the delivery region. The nearest one with enough stock ships, and if none has everything, the order waits for a person.</p>
                </div>
              </article>
              <article className="card">
                <div className="vis">
                  <div className="stockbars">
                    <div><i style={{ height: 78 }}></i>W1</div>
                    <div><i style={{ height: 64 }}></i>W2</div>
                    <div><i style={{ height: 86 }}></i>W3</div>
                    <div><i className="lo" style={{ height: 14 }}></i>W4</div>
                    <div><i style={{ height: 70 }}></i>W5</div>
                  </div>
                </div>
                <div className="card-body">
                  <div className="stage"><span>Inventory</span><b>Allocation agent</b></div>
                  <h3>Stock rebalancing</h3>
                  <p>Every order a warehouse couldn&apos;t fill is logged against it. The allocation agent proposes transfers from that demand, and staff track the cartons until they arrive.</p>
                </div>
              </article>
              <article className="card">
                <div className="vis">
                  <div className="mheat">
                    <span></span><span>MW</span><span>NE</span><span>SE</span><span>W</span>
                    <b>A</b><i style={v(5)}></i><i style={v(5)}></i><i style={v(6)}></i><i style={v(7)}></i>
                    <b>D</b><i className="bad" style={v(46)}></i><i style={v(23)}></i><i className="bad" style={v(45)}></i><i style={v(22)}></i>
                    <b>E</b><i style={v(6)}></i><i style={v(4)}></i><i style={v(6)}></i><i className="bad" style={v(46)}></i>
                    <b>F</b><i style={v(6)}></i><i className="bad" style={v(43)}></i><i className="bad" style={v(46)}></i><i style={v(5)}></i>
                  </div>
                </div>
                <div className="card-body">
                  <div className="stage"><span>Despatch</span><b>Carrier agent</b></div>
                  <h3>Carrier plan</h3>
                  <p>After the cutoff, the carrier agent assigns the day&apos;s same-day orders using each carrier&apos;s late rate by region and its capacity. Code checks the plan before anyone uses it.</p>
                </div>
              </article>
            </div>
          </div>
        </section>

        <section className="showcase" id="product">
          <div className="wrap">
            <div className="head center">
              <span className="kicker">The product</span>
              <h2>One workspace for coordinators, warehouses and leadership.</h2>
              <p className="lede">Held orders and carrier lanes, each with the reasons behind every decision.</p>
            </div>
            <ProductShowcase />
          </div>
        </section>

        <section id="start">
          <div className="wrap">
            <div className="head">
              <span className="kicker">Who it&apos;s for</span>
              <h2>An open marketplace, run by one company.</h2>
              <p className="lede">Anyone can browse the marketplace and place an order. The operations portal behind it stays with Halcyon Logistics&apos; own staff.</p>
            </div>
            <div className="steps">
              <div className="step">
                <span className="no">Orders</span>
                <h3>How orders come in</h3>
                <p>Halcyon reads the inbox its clients already email. Orders from the client portal and the API join the same queue, so they all take one path. EDI is recorded as a client&apos;s order channel, with full EDI intake coming next.</p>
                <div className="chips"><span>Email</span><span>API</span><span>Client portal</span><span>EDI next</span></div>
              </div>
              <div className="step">
                <span className="no">Network</span>
                <h3>Halcyon&apos;s network</h3>
                <p>Every order runs on Halcyon&apos;s own warehouses, stock and carriers. A Halcyon admin sets the same-day cutoff and the time zone it runs in.</p>
                <div className="chips"><span>Warehouses</span><span>Stock</span><span>Carriers</span><span>08:00 cutoff</span></div>
              </div>
              <div className="step">
                <span className="no">People</span>
                <h3>Who signs in</h3>
                <p>Halcyon staff sign in as admins or contributors. Clients create their account when they first order from the marketplace, or get one from a Halcyon admin, then order and follow their own deliveries.</p>
                <div className="chips"><span>Admin</span><span>Contributor</span><span>Client logins</span></div>
              </div>
            </div>
          </div>
        </section>

        <section className="trust" id="security">
          <div className="wrap">
            <div className="head">
              <span className="kicker">Security and control</span>
              <h2>AI reads. Code checks. People approve.</h2>
              <p className="lede">Agents handle language and suggestions. Code makes the decisions that change an order, and nothing reaches a customer until a person sends it.</p>
            </div>
            <div className="pillars">
              <div className="pillar">
                <span className="tag">AI · four agents</span>
                <h3>Reads</h3>
                <p>Turns order emails into structured orders, drafts customer replies, and proposes stock transfers and carrier plans.</p>
                <ul><li>Replies must match a fixed format</li><li>Suggestions only; nothing changes on its own</li><li>Falls back to templates if an agent is down</li></ul>
              </div>
              <div className="pillar">
                <span className="tag">Code · rules</span>
                <h3>Checks</h3>
                <p>Applies the same-day cutoff, picks the nearest warehouse with stock and logs every stock-out.</p>
                <ul><li>Sets every delivery date</li><li>Validates each carrier plan against capacity</li><li>Records where and why each order was routed</li></ul>
              </div>
              <div className="pillar">
                <span className="tag">People · Halcyon&apos;s team</span>
                <h3>Approves</h3>
                <p>Staff resolve exceptions and send every message a customer receives.</p>
                <ul><li>Separate access for admins, contributors and clients</li><li>Every action is audit-logged</li><li>Secure sessions with sign-in rate limits</li></ul>
              </div>
            </div>
          </div>
        </section>

        <section className="cta">
          <div className="wrap">
            <div className="cta-box">
              <div style={{ display: "grid", gap: 16, position: "relative" }}>
                <h2>Catch the late delivery while it&apos;s still an email.</h2>
                <p>Order from the marketplace, or sign in to the portal if you already have a login.</p>
              </div>
              <div className="btns">
                <Link className="btn btn-w" href="/marketplace">Open the marketplace <span className="arr" aria-hidden="true">→</span></Link>
                <Link className="btn btn-o" href="/signin">Sign in</Link>
              </div>
            </div>
          </div>
        </section>
      </main>

      <footer>
        <div className="wrap">
          <div className="f-grid">
            <div className="f-brand">
              <span className="brand"><Logo />Halcyon</span>
              <p>Order intake to despatch for Halcyon Logistics, by Last Mile Labs.</p>
            </div>
            <div><h4>Platform</h4><ul><li><a href="#platform">How it works</a></li><li><a href="#security">Security</a></li></ul></div>
            <div><h4>Product</h4><ul><li><a href="#product">Tour</a></li><li><a href="#start">Who it&apos;s for</a></li></ul></div>
            <div><h4>Account</h4><ul><li><Link href="/signin">Sign in</Link></li></ul></div>
          </div>
          <div className="f-base">
            <span>Product screens on this page show sample data.</span>
            <span>© 2026 Last Mile Labs</span>
          </div>
        </div>
      </footer>
    </>
  );
}
