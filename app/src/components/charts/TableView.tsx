/* The table twin every chart carries.
 *
 * A chart encodes values as position and colour, and both of those fail
 * somebody: colour-vision deficiency, a screen reader, a printout, or just
 * wanting the exact number rather than "roughly there". The rule this
 * dashboard follows is that a tooltip may enhance a value but must never
 * be the only way to reach it, so every chart ships with the same numbers
 * as text underneath it.
 *
 * Collapsed by default via <details>, which gets the disclosure keyboard
 * behaviour and the expanded/collapsed announcement from the browser
 * rather than from hand-written ARIA that would have to be maintained.
 */

import type { ReactNode } from "react";

export interface Column<T> {
  key: string;
  label: string;
  align?: "left" | "right";
  render: (row: T) => ReactNode;
}

export function TableView<T>({
  label,
  caption,
  columns,
  rows,
  rowKey,
}: {
  /** what the disclosure says, e.g. "Table view: daily footfall" */
  label: string;
  caption?: string;
  columns: Column<T>[];
  rows: T[];
  rowKey: (row: T, index: number) => string;
}) {
  return (
    <details className="tableview">
      <summary className="tableview__summary">{label}</summary>
      {caption ? <p className="tableview__caption">{caption}</p> : null}
      {/* The scroll container, not the page, takes the overflow: a wide
          table must never make the whole dashboard scroll sideways. */}
      <div className="tableview__scroll">
        <table className="tableview__table">
          <thead>
            <tr>
              {columns.map((column) => (
                <th
                  key={column.key}
                  scope="col"
                  style={{ textAlign: column.align === "right" ? "right" : "left" }}
                >
                  {column.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, index) => (
              <tr key={rowKey(row, index)}>
                {columns.map((column) => (
                  <td
                    key={column.key}
                    style={{ textAlign: column.align === "right" ? "right" : "left" }}
                  >
                    {column.render(row)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>
  );
}
