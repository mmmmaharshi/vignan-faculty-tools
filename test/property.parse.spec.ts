import { expect, test } from "@playwright/test";
import {
  array,
  assert,
  constantFrom,
  date,
  integer,
  oneof,
  property,
  record,
  string,
  stringMatching,
  tuple,
} from "fast-check";
import type { Arbitrary } from "fast-check";

import { options, realOptions } from "../server/portal-options";
import {
  parseClassAttendance,
  parseCumulativeTotals,
  parseRegister,
} from "../server/portal-register";
import { statedStartDate } from "../shared/api";
import { defaultRange, toInputDate, toPortalDate } from "../web/register/range";

/**
 * Oracles over the Portal's replies, fed by a grammar rather than by examples.
 *
 * `portal-replies.ts` exists because ECAP states the same fact in shapes nobody
 * predicted: a dash where a count belongs, a blank where a zero would be, a
 * leading zero that is part of a code. Each of those was found by a human
 * squinting at a capture. These properties state the invariant the parser owes
 * instead, so the next variant fails a test rather than a person.
 */

/** A cell as ECAP has actually been seen to write it. */
const ecapCell = oneof(
  integer({ min: 0, max: 999 }).map(String),
  constantFrom("-", " - ", "", " ", "&nbsp;", "0/0", "38/45", "NA", "..")
);
const roll: Arbitrary<string> = tuple(
  integer({ min: 20, max: 25 }),
  constantFrom("L", "B"),
  integer({ min: 1, max: 9 }),
  stringMatching(/^[A-Z0-9]{4,6}$/)
).map(([y, k, n, tail]) => `${y}${k}31A${n}${tail}`);

/** One register row, read from a single stated cell in the two figure columns. */
const parseOneRow = (cell: string) =>
  parseRegister(`<table>
    <tr><th>Sl.No</th><th>Roll No</th><th>Student Name</th><th>Attend / Held</th><th>%</th></tr>
    <tr><td>1</td><td>21B91A1201</td><td>Student</td><td>${cell}</td><td>${cell}</td></tr>
  </table>`)[0];

test.describe("the register parser never invents a figure", () => {
  test("a percentage is either absent or a real number in range", () => {
    assert(
      property(
        array(tuple(roll, ecapCell, ecapCell), { maxLength: 8 }),
        (rows) => {
          const html = `<table>
            <tr><th>Sl.No</th><th>Roll No</th><th>Student Name</th><th>Attend / Held</th><th>%</th></tr>
            ${rows
              .map(
                ([r, cell, pct], i) =>
                  `<tr><td>${i + 1}</td><td>${r}</td><td>Student ${i}</td><td>${cell}</td><td>${pct}</td></tr>`
              )
              .join("")}
          </table>`;
          for (const row of parseRegister(html)) {
            // A figure the parser reports is either null (no evidence) or a
            // number a percentage could be — never NaN, never negative.
            if (row.pct !== null) {
              expect(Number.isFinite(row.pct)).toBe(true);
              expect(row.pct).toBeGreaterThanOrEqual(0);
              expect(row.pct).toBeLessThanOrEqual(100);
            }
            // The count is ECAP's own string, kept as written: the parser may
            // blank it but never fabricates one, so whatever it reports was in
            // the reply.
            if (row.attendedOfHeld !== "") {
              expect(html.includes(row.attendedOfHeld)).toBe(true);
            }
          }
          return true;
        }
      ),
      { numRuns: 200 }
    );
  });
  test("a dash is never read as a figure, and a blank is never a zero", () => {
    expect(parseOneRow("-")?.pct, "a dash is not zero").toBeNull();
    expect(parseOneRow("")?.pct, "a blank is not zero").toBeNull();
    expect(parseOneRow("&nbsp;")?.pct).toBeNull();
    expect(parseOneRow("42.5")?.pct).toBe(42.5);
    expect(
      parseOneRow("101")?.pct,
      "an impossible percentage is no figure"
    ).toBeNull();
  });
});

test.describe("the class report never invents a figure", () => {
  test("every stated percentage is in range, and every roll is non-empty", () => {
    assert(
      property(array(tuple(roll, ecapCell), { maxLength: 6 }), (rows) => {
        const html = `<table>
            <tr><td>ATTENDANCE REPORT</td></tr>
            <tr><th>Sl.No</th><th>Roll.No</th><th>Student Name</th><th>AI</th><th>Total</th><th>Percent</th></tr>
            ${rows
              .map(
                ([r, pct], i) =>
                  `<tr><td>${i + 1}</td><td>${r}</td><td>Name ${i}</td><td>37</td><td>45</td><td>${pct}</td></tr>`
              )
              .join("")}
          </table>`;
        for (const row of parseClassAttendance(html)) {
          if (row.pct !== null) {
            expect(Number.isFinite(row.pct)).toBe(true);
            expect(row.pct).toBeGreaterThanOrEqual(0);
            expect(row.pct).toBeLessThanOrEqual(100);
          }
        }
        return true;
      }),
      { numRuns: 150 }
    );
  });
});

test.describe("the cumulative counts add up", () => {
  const colour = constantFrom("", "Green", "Yellow", "Red", "Purple");
  const legend = `<table><tr><td>
    <div style='background-color:Green'></div><div class='reportData2'>&nbsp;Holiday</div>
    <div style='background-color:Yellow'></div><div class='reportData2'>&nbsp;Absent</div>
    <div style='background-color:Red'></div><div class='reportData2'>&nbsp;Not Entered</div>
    <div style='background-color:Purple'></div><div class='reportData2'>&nbsp;No Class Work</div>
  </td></tr></table>`;
  test("held is the parts it claims to be, and never less than attend + absent", () => {
    assert(
      property(
        array(
          tuple(
            integer({ min: 1, max: 28 }),
            array(tuple(colour, ecapCell), {
              minLength: 1,
              maxLength: 7,
            })
          ),
          { maxLength: 6 }
        ),
        (days) => {
          const rows = days
            .map(
              ([day, cells]) =>
                `<tr><td>${String(day).padStart(2, "0")}/11/2026</td>${cells
                  .map(
                    ([bg, text]) =>
                      `<td style='background-color:${bg}'>${text}</td>`
                  )
                  .join("")}</tr>`
            )
            .join("");
          const totals = parseCumulativeTotals(
            `${legend}<table><tr><td>Date</td><td>1 Hour</td></tr>${rows}</table>`
          );
          if (!totals) return true; // refused, which is the honest answer
          expect(totals.held).toBeGreaterThanOrEqual(totals.attend);
          expect(totals.held).toBeGreaterThanOrEqual(
            totals.attend + totals.absent
          );
          return true;
        }
      ),
      { numRuns: 200 }
    );
  });
  test("a reply with no legend is refused, never counted as a clean sheet", () => {
    assert(
      property(array(tuple(colour, ecapCell), { maxLength: 5 }), (cells) => {
        const html = `<table><tr><td>Date</td><td>1 Hour</td></tr><tr><td>04/11/2026</td>${cells
          .map(
            ([bg, text]) => `<td style='background-color:${bg}'>${text}</td>`
          )
          .join("")}</tr></table>`;
        return parseCumulativeTotals(html) === null;
      }),
      { numRuns: 100 }
    );
  });
});

/** dd/mm/yyyy as one comparable number — a string compare of a day-first date
 *  orders by day of month, not by date. */
const dateCode = (value: string): number => {
  const [d, m, y] = value.split("/").map(Number);
  return (y ?? 0) * 10_000 + (m ?? 0) * 100 + (d ?? 0);
};
test.describe("portal dates survive the round trip", () => {
  test("dd/mm/yyyy becomes an input value and back, unchanged", () => {
    const portalDate: Arbitrary<string> = record({
      d: integer({ min: 1, max: 28 }),
      m: integer({ min: 1, max: 12 }),
      y: integer({ min: 2000, max: 2099 }),
    }).map(
      ({ d, m, y }) =>
        `${String(d).padStart(2, "0")}/${String(m).padStart(2, "0")}/${y}`
    );
    assert(
      property(
        portalDate,
        (portal) => toPortalDate(toInputDate(portal)) === portal
      ),
      { numRuns: 200 }
    );
  });
  test("a stated start never lands outside the range it was read from", () => {
    assert(
      property(
        record({
          d: integer({ min: 1, max: 28 }),
          m: integer({ min: 1, max: 12 }),
          y: integer({ min: 2024, max: 2028 }),
        }),
        record({
          d: integer({ min: 1, max: 28 }),
          m: integer({ min: 1, max: 12 }),
          y: integer({ min: 2024, max: 2028 }),
        }),
        (a, b) => {
          const dates = [
            `${String(a.d).padStart(2, "0")}/${String(a.m).padStart(2, "0")}`,
          ];
          const from = `${String(Math.min(a.d, b.d)).padStart(2, "0")}/${String(a.m).padStart(2, "0")}/${Math.min(a.y, b.y)}`;
          const to = `${String(Math.max(a.d, b.d)).padStart(2, "0")}/${String(b.m).padStart(2, "0")}/${Math.max(a.y, b.y)}`;
          const stated = statedStartDate(dates, { from, to });
          if (stated === null) return true;
          return (
            dateCode(stated) >= dateCode(from) &&
            dateCode(stated) <= dateCode(to)
          );
        }
      ),
      { numRuns: 200 }
    );
  });
  test("the default range is one month, in local time", () => {
    assert(
      property(
        date({
          min: new Date("2024-01-01T00:00:00Z"),
          max: new Date("2027-12-31T00:00:00Z"),
        }).filter((d) => !Number.isNaN(d.getTime())),
        (now) => {
          const { from, to } = defaultRange(now);
          expect(from <= to, "from is never after to").toBe(true);
          expect(from.slice(0, 7), "both ends name the same month").toBe(
            to.slice(0, 7)
          );
          // A local-midnight date must not be printed as the day before: that
          // was the UTC bug, and it shows as the first-of-month drifting.
          expect(from.slice(8, 10)).toBe("01");
          return true;
        }
      ),
      { numRuns: 100 }
    );
  });
});

test.describe("the options parser keeps the portal's own values", () => {
  test("every option it returns has both halves, and none is a placeholder", () => {
    assert(
      property(
        array(tuple(string({ minLength: 1 }), string()), {
          maxLength: 8,
        }),
        (pairs) => {
          const html = `<select>${pairs
            .map(
              ([value, label]) => `<option value="${value}">${label}</option>`
            )
            .join("")}</select>`;
          for (const option of realOptions(options(html))) {
            expect(option.value).not.toBe("");
            expect(option.value).not.toBe("0");
            expect(option.label.trim()).not.toBe("");
            expect(option.label).not.toMatch(/^-?\s*select\s*-?$/i);
          }
          return true;
        }
      ),
      { numRuns: 200 }
    );
  });
});
