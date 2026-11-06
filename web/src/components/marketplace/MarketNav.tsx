import Link from "next/link";
import Icon from "@/components/Icon";

export default function MarketNav() {
  return (
    <header className="nav">
      <div className="wrap">
        <Link href="/" className="brand" aria-label="Halcyon home">
          <span className="logo-mk"><Icon name="package" /></span>
          Halcyon
        </Link>
        <nav className="nav-links" aria-label="Main">
          <Link href="/marketplace">Marketplace</Link>
        </nav>
        <div className="nav-cta">
          <Link className="btn btn-line btn-sm signin" href="/signin">Sign in</Link>
        </div>
      </div>
    </header>
  );
}
