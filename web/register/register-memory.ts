import type { RegisterReply } from "../../shared/api";
import type { RegisterClick } from "../data/client";
import type { Sel } from "./cascade";
import type { Range } from "./range";
import { readStored, writeStored } from "./string-map-store";
import type { RowFilter } from "./worklist";

/** What the dashboard looked like when the register was last read. */
export type RegisterMemory = {
  /** The class the form named. */
  sel: Sel;
  /** The window the register covered. */
  range: Range;
  /** The bars and the search that were ticked and typed. */
  filter: RowFilter;
  /** The click, so the reply can be found again under the key it answered to. */
  click: RegisterClick;
  /** The reply itself: the table on screen, without a second Portal call. */
  register: RegisterReply;
};

/**
 * Where the dashboard view is kept, so a reload shows what was on screen instead
 * of an empty form.
 *
 * One key, not one per user: this is a live view rather than a personal
 * collection, so it must not outlive the session — `signedOut` clears it, the way
 * it clears everything else that came from the Portal. The register it holds is
 * student data, which is why it lives and dies with the session rather than being
 * filed away under a name.
 */
const MEMORY_KEY = "dashboard-view";

/** As deep as the read goes: enough to catch a shape that is not this one, loose
 *  enough that a field added later does not throw away a working screen. */
const has =
  (...keys: string[]) =>
  (o: unknown): boolean =>
    typeof o === "object" && o !== null && keys.every((k) => k in o);

const isMemory = (value: unknown): value is RegisterMemory => {
  if (typeof value !== "object" || value === null) return false;
  const { sel, range, filter, click, register } = value as Record<
    string,
    unknown
  >;
  return (
    has("course", "semester", "branch", "section", "subject")(sel) &&
    has("from", "to")(range) &&
    has("irregular", "search", "subjectBars")(filter) &&
    has("request", "attempt")(click) &&
    has("students", "summary")(register) &&
    Array.isArray((register as { students: unknown }).students)
  );
};

export function readRegisterMemory(): RegisterMemory | null {
  return readStored(MEMORY_KEY, isMemory);
}

export function writeRegisterMemory(memory: RegisterMemory): void {
  writeStored(MEMORY_KEY, memory);
}

export function forgetRegisterMemory(): void {
  writeStored(MEMORY_KEY, null);
}
