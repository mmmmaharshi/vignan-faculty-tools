import type { LeaveStatus } from "../shared/api.js";
import { gridTables } from "./portal-html.js";

/** ECAP states the faculty member's name inside the `lblUser` span on
 *  main.aspx, prefixed with "Welcome ". Returns the name, or empty when the
 *  page did not state one (not logged in, or the span is empty). */
export function parseFacultyName(html: string): string {
  const m = html.match(
    /id="lblUser"[^>]*>\s*Welcome\s+(?<name>[\s\S]*?)<\/span>/i
  );
  return m?.groups?.name?.trim() ?? "";
}
/** The number at the front of a cell: the Portal never closes the Approved
 *  cell's div, so that cell reads `5</div` once the tags are stripped. */
const headNumber = (v: string) => v.match(/^\d+(?:\.\d+)?/)?.[0] ?? v;
/** The per-stage counts the APPLY-SELF page's `showLeaves` reply states: one
 *  row per leave type, headed `Leave Type | Eligible | Applied | Approved |
 *  Pending | Declined | Available`. The counts sit inside clickable divs and
 *  the first cell holds a radio button, so neither cell shape nor row shape
 *  can tell this grid apart — only its header can. */
export function parseLeaveStatus(html: string): LeaveStatus[] {
  const grid = gridTables(html).find((rows) =>
    rows.some(
      (cells) =>
        cells.includes("Leave Type") &&
        cells.includes("Applied") &&
        cells.includes("Declined")
    )
  );
  if (!grid) return [];
  return grid
    .filter(
      (cells) =>
        cells.length >= 8 &&
        (cells[1] ?? "") !== "" &&
        cells[1] !== "Leave Type"
    )
    .map((cells) => ({
      type: cells[1] ?? "",
      eligible: headNumber(cells[2] ?? ""),
      applied: headNumber(cells[3] ?? ""),
      approved: headNumber(cells[4] ?? ""),
      pending: headNumber(cells[5] ?? ""),
      declined: headNumber(cells[6] ?? ""),
      available: headNumber(cells[7] ?? ""),
    }));
}
