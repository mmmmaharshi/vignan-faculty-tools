import type { CascadeLevel } from "../shared/api";

/**
 * Client-side shapes shared between `App` and the components it composes.
 *
 * They live here rather than in `App.tsx` because the components need them too,
 * and importing them from `App` would be circular. None of them is part of the
 * server contract in `shared/api.ts` — they are what this app's own state looks
 * like, which is a different thing.
 */

/** What the user has chosen at each level. Every level is present, possibly "". */
export type Sel = Record<CascadeLevel, string>;

/** The date range, as `yyyy-mm-dd` from the date inputs. */
export type Range = { from: string; to: string };

/** A message under a form, coloured by kind. */
export type Note = { kind: "error" | "warning"; text: string };

/** Which dropdowns should be enabled, given the levels chosen above them. */
export type Disabled = Record<CascadeLevel, boolean>;
