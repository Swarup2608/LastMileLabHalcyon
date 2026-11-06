// Page numbers for a pager, shared by <Pagination/> and the portal engine's tables. Pages are 1-based; "gap" is an
// ellipsis. Always shows the first and last page and one page either side of the current one:
// 1 2 3 4 5 … 99, 1 … 4 5 6 … 99, 1 … 95 96 97 98 99.
export type PageItem = number | "gap";

// Rows per page the user can pick under a table; every table starts at the first.
export const PAGE_SIZES = [10, 20, 50, 100];
export const DEFAULT_PAGE_SIZE = PAGE_SIZES[0];

export function pageItems(page: number, pageCount: number): PageItem[] {
  if (pageCount <= 7) return Array.from({ length: pageCount }, (_, i) => i + 1);
  if (page <= 4) return [1, 2, 3, 4, 5, "gap", pageCount];
  if (page >= pageCount - 3) return [1, "gap", pageCount - 4, pageCount - 3, pageCount - 2, pageCount - 1, pageCount];
  return [1, "gap", page - 1, page, page + 1, "gap", pageCount];
}

export const pageCountOf = (total: number, pageSize: number) => Math.max(1, Math.ceil(total / pageSize));

// The current page, pulled back inside the list when it shrank (filters changed, rows were archived).
export const clampPage = (page: number, total: number, pageSize: number) =>
  Math.min(Math.max(1, page), pageCountOf(total, pageSize));

// "Showing 21–40 of 1,000 results"
export function pageSummary(page: number, pageSize: number, total: number, noun = "results") {
  const first = (page - 1) * pageSize + 1;
  const last = Math.min(page * pageSize, total);
  return `Showing ${first.toLocaleString("en-US")}–${last.toLocaleString("en-US")} of ${total.toLocaleString("en-US")} ${noun}`;
}
