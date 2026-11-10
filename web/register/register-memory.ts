import type { RegisterReply } from "../../shared/api";
import type { RangeEdited } from "../app/load-gate";
import type { RegisterClick } from "../data/client";
import type { Sel } from "./cascade";
import type { Range } from "./range";
import { readStored, writeStored } from "./string-map-store";
import type { RowFilter } from "./worklist";

/** What the dashboard looked like when the register was last read. */
export type RegisterMemory = {
  /** The class the register was read for, taken from the reply's own request
   *  rather than from the picker: a class changed without pressing Load would
   *  otherwise be remembered beside another class's rows. */
  sel: Sel;
  /** The window the register covered, likewise from its request. */
  range: Range;
  /** The bars and the search that were ticked and typed. */
  filter: RowFilter;
  /** Which end of the window was typed by hand, so the settle-time snaps leave
   *  the restored range exactly as it was. */
  rangeEdited: RangeEdited;
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
 * collection, so it must not outlive the session — every path that ends a session
 * clears it, the way it clears everything else that came from the Portal, and the
 * boot that finds no session clears it too. The register it holds is student
 * data, which is why it lives and dies with the session rather than being filed
 * away under a name.
 */
const MEMORY_KEY = "dashboard-view";

/** Key presence only, so a field added later does not throw a working screen away. */
const has =
  (...keys: string[]) =>
  (o: unknown): boolean =>
    typeof o === "object" && o !== null && keys.every((k) => k in o);

/**
 * As deep as the read goes. The shapes a caller then walks — the ticked bars, the
 * summary, the click's own request — are checked as far as they are used, because
 * a half-written key would otherwise throw inside a render rather than be dropped.
 */
const isMemory = (value: unknown): value is RegisterMemory => {
  if (!has("sel", "range", "filter", "rangeEdited", "click", "register")(value))
    return false;
  const { sel, range, filter, rangeEdited, click, register } = value as Record<
    string,
    unknown
  >;
  return (
    has("course", "semester", "branch", "section", "subject")(sel) &&
    Object.values(sel as Record<string, unknown>).every(
      (v) => typeof v === "string"
    ) &&
    has("from", "to")(range) &&
    has("irregular", "search", "below75", "below65", "subjectBars")(filter) &&
    Array.isArray((filter as { subjectBars: unknown }).subjectBars) &&
    (rangeEdited === "" || rangeEdited === "from" || rangeEdited === "to") &&
    has("request", "attempt")(click) &&
    has(
      "course",
      "semester",
      "branch",
      "section",
      "subject",
      "from",
      "to"
    )((click as { request: unknown }).request) &&
    has("students", "summary")(register) &&
    Array.isArray((register as { students: unknown }).students) &&
    typeof (register as { summary: { range?: unknown } }).summary.range ===
      "object"
  );
};

export function readRegisterMemory(): RegisterMemory | null {
  return readStored(MEMORY_KEY, isMemory);
}

export function writeRegisterMemory(memory: RegisterMemory): void {
  writeStored(MEMORY_KEY, memory);
}

/** Leaves the key behind holding `null`, which `isMemory` refuses: a tombstone
 *  rather than a removal, so the storage walk stays in one module. */
export function forgetRegisterMemory(): void {
  writeStored(MEMORY_KEY, null);
}
