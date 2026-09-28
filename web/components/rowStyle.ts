import type { Student } from "../../shared/api";

/**
 * How one register row is presented.
 *
 * Split out of `App` and `RegisterTable` because the table renders rows and
 * App does not, and neither of them should own the other's presentation rules.
 */

/**
 * The row tint, reading Mantine's own colour tokens.
 *
 * `Table.Tr`'s `bg` prop is the whole mechanism - there is no custom CSS
 * anywhere in this project, so this returns a token or nothing at all.
 */
export function tintFor(s: Student): string | undefined {
  if (s.critical) return "var(--mantine-color-red-light)";
  return s.irregular ? "var(--mantine-color-yellow-light)" : undefined;
}

/** The status word for a student, worst first. */
export function statusOf(s: Student): "Critical" | "Irregular" | "Regular" {
  if (s.critical) return "Critical";
  return s.irregular ? "Irregular" : "Regular";
}
