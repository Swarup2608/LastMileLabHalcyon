"use client";

import { useState, type ReactNode } from "react";
import Pagination from "@/components/Pagination";
import { DEFAULT_PAGE_SIZE, clampPage } from "@/lib/pagination";

export interface Column<T> {
  key: string;
  header: ReactNode;
  cell: (row: T) => ReactNode;
  // Right-aligned figures (the .num column style).
  numeric?: boolean;
  // Extra classes and a tooltip for one row's cell, e.g. low-stock colouring.
  cellClass?: (row: T) => string | undefined;
  cellTitle?: (row: T) => string | undefined;
}

// A page the server already cut: the caller fetches `pageSize` rows at `page` and reports the full `total`.
export interface ServerPaging {
  total: number;
  page: number;
  pageSize: number;
  onPage: (page: number) => void;
  onPageSize: (pageSize: number) => void;
}

const cx = (...names: (string | false | undefined)[]) => names.filter(Boolean).join(" ") || undefined;

// The portal's data table with its pager. By default it pages `rows` itself, starting at 10 rows per page; pass
// `paging` when the server pages instead. Loading and error states stay with the caller; `empty` shows when there
// are no rows.
export default function Table<T>({
  columns,
  rows,
  rowKey,
  label,
  noun,
  empty,
  paging,
}: {
  columns: Column<T>[];
  rows: T[];
  rowKey: (row: T) => string;
  // What the table lists, for screen readers ("Clients"); the pager is "<label> pages".
  label: string;
  // The rows in the pager summary ("Showing 1–10 of 40 clients"); defaults to "results".
  noun?: string;
  empty?: ReactNode;
  paging?: ServerPaging;
}) {
  const [pageNo, setPageNo] = useState(1);
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE);

  // Client-side paging pulls the page back in range when the rows shrink (filters changed) rather than resetting it.
  const local = !paging;
  const total = paging ? paging.total : rows.length;
  const size = paging ? paging.pageSize : pageSize;
  const page = paging ? paging.page : clampPage(pageNo, total, size);
  const shown = local ? rows.slice((page - 1) * size, page * size) : rows;

  if (rows.length === 0 && empty) return <>{empty}</>;

  return (
    <>
      <div className="tbl-wrap">
        <table className="tbl" aria-label={label}>
          <thead>
            <tr>
              {columns.map((c) => (
                <th key={c.key} className={c.numeric ? "num" : undefined}>{c.header}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {shown.map((row) => (
              <tr key={rowKey(row)}>
                {columns.map((c) => (
                  <td key={c.key} className={cx(c.numeric && "num", c.cellClass?.(row))} title={c.cellTitle?.(row)}>
                    {c.cell(row)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Pagination
        page={page}
        pageSize={size}
        total={total}
        label={`${label} pages`}
        noun={noun}
        onPage={paging ? paging.onPage : setPageNo}
        onPageSize={(n) => {
          if (paging) return paging.onPageSize(n);
          setPageSize(n);
          setPageNo(1);
        }}
      />
    </>
  );
}
