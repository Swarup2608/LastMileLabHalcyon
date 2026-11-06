"use client";

import Icon from "@/components/Icon";
import { PAGE_SIZES, pageCountOf, pageItems, pageSummary } from "@/lib/pagination";

// The pager under a table: Previous, page numbers with ellipses, Next, rows per page and how many rows are showing.
// On a phone it folds to the two arrows and the summary. Renders nothing when the table fits the smallest page size.
export default function Pagination({
  page,
  pageSize,
  total,
  onPage,
  onPageSize,
  label,
  noun,
}: {
  page: number;
  pageSize: number;
  total: number;
  onPage: (page: number) => void;
  // A new rows-per-page choice; the caller goes back to page 1.
  onPageSize: (pageSize: number) => void;
  // What the pager pages through, for screen readers ("Clients pages").
  label: string;
  noun?: string;
}) {
  if (total <= PAGE_SIZES[0]) return null;
  const pageCount = pageCountOf(total, pageSize);

  return (
    <nav className="pager" aria-label={label}>
      <button className="pager-step" type="button" disabled={page <= 1} onClick={() => onPage(page - 1)} aria-label="Previous page">
        <Icon name="caret-left" />
        <span>Previous</span>
      </button>
      <ol className="pager-pages">
        {pageItems(page, pageCount).map((item, i) =>
          item === "gap" ? (
            <li key={`gap-${i}`} className="pager-gap" aria-hidden="true">…</li>
          ) : (
            <li key={item}>
              <button
                className="pager-num"
                type="button"
                aria-current={item === page ? "page" : undefined}
                aria-label={`Page ${item}`}
                onClick={() => onPage(item)}
              >
                {item}
              </button>
            </li>
          ),
        )}
      </ol>
      <button className="pager-step" type="button" disabled={page >= pageCount} onClick={() => onPage(page + 1)} aria-label="Next page">
        <span>Next</span>
        <Icon name="caret-right" />
      </button>
      <label className="pager-size">
        <span>Rows per page</span>
        <select className="select" value={pageSize} onChange={(e) => onPageSize(Number(e.target.value))}>
          {PAGE_SIZES.map((n) => (
            <option key={n} value={n}>{n}</option>
          ))}
        </select>
      </label>
      <span className="pager-sum" aria-live="polite">{pageSummary(page, pageSize, total, noun)}</span>
    </nav>
  );
}
