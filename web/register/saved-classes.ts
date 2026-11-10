import { ALL_SUBJECTS } from "../../shared/api";
import { LEVEL_KEYS } from "./cascade";
import type { Sel } from "./cascade";
import { readStored, writeStored } from "./string-map-store";

/** One saved section, as the cards above the class form read it: the values that
 *  reopen it, and the two names that make the card readable. */
export type SavedClassCard = {
  sel: SavedClass;
  sectionName: string;
  /** Course, semester and branch on one line — the longest string, so it is
   *  quietest. */
  course: string;
};
/**
 * A saved section: the four values that name a section, the Subject key that
 * keeps the stored shape one shape, and the section's own label as a display
 * cache.
 *
 * The subject is always `ALL SUBJECTS`, because a card reopens a section, not one
 * subject inside it — opening one lands on the section-wide register and the user
 * narrows from there. No date is stored either: the range belongs to the
 * register, not to the section, and a remembered `to` would open the app on last
 * month's numbers.
 *
 * `sectionLabel` is a cache and never the answer. The cascade's own label wins
 * whenever this session has offered that branch's sections, so a renamed section
 * corrects itself the moment its card is opened. It is stored because `opts` holds
 * only the branch on screen, so a card from another branch would otherwise print
 * a bare value like `1` where its section should be — which reads as a data fault
 * rather than as a name.
 *
 * The key is scoped by user id, so a shared machine does not offer one person's
 * sections to the next. localStorage is per-browser, so it does not follow anyone
 * to another machine.
 */
export type SavedClass = Sel & { sectionLabel?: string };
const CLASS_KEY_PREFIX = "section-";
/** The identity of a saved section: the five values in a fixed order, so two
 *  saves of the same section compare equal without depending on key order. Also
 *  the identity of a section's earliest-start memory in `sem-starts.ts`. */
export const classKey = (values: Record<string, string>): string =>
  LEVEL_KEYS.map((key) => values[key]).join(" ");
/** A stored entry becomes a section only if all five values are strings; the
 *  subject it was saved under is replaced by the section-wide one, because that
 *  is what a card opens. Anything else is dropped rather than half-read. A
 *  missing section label is not a fault: an entry written before labels were kept
 *  still opens, it just says its value until this session offers the name. */
function readClass(value: unknown): SavedClass | null {
  if (typeof value !== "object" || value === null) return null;
  const values = value as Record<string, unknown>;
  const read = (key: (typeof LEVEL_KEYS)[number]): string => {
    const found = values[key];
    return typeof found === "string" ? found : "";
  };
  const cls: SavedClass = {
    course: read("course"),
    semester: read("semester"),
    branch: read("branch"),
    section: read("section"),
    subject: ALL_SUBJECTS.value,
  };
  if (!LEVEL_KEYS.every((key) => cls[key])) return null;
  const { sectionLabel } = values;
  if (typeof sectionLabel === "string" && sectionLabel) {
    cls.sectionLabel = sectionLabel;
  }
  return cls;
}
const storeKey = (userId: string): string => `${CLASS_KEY_PREFIX}${userId}`;
/** A stored list, or a single class from an earlier build, which is still
 *  offered. Anything that is not an object is no classes at all. */
const isStoredList = (
  value: unknown
): value is unknown[] | Record<string, unknown> =>
  typeof value === "object" && value !== null;
function writeClasses(userId: string, list: readonly SavedClass[]): void {
  writeStored(storeKey(userId), list);
}
export function savedClasses(userId: string): SavedClass[] {
  if (!userId) return [];
  const parsed = readStored(storeKey(userId), isStoredList);
  if (!parsed) return [];
  const entries = Array.isArray(parsed) ? parsed : [parsed];
  const seen = new Set<string>();
  const list: SavedClass[] = [];
  for (const entry of entries) {
    const cls = readClass(entry);
    if (!cls) continue;
    const key = classKey(cls);
    if (seen.has(key)) continue;
    seen.add(key);
    list.push(cls);
  }
  return list;
}
export function rememberClass(
  userId: string,
  sel: Sel,
  sectionLabel = ""
): void {
  if (!userId) return;
  const cls = readClass(sel);
  if (!cls) return;
  if (sectionLabel) cls.sectionLabel = sectionLabel;
  // Re-saving moves the section to the front rather than duplicating it: the one
  // just used is the one most likely to be wanted again.
  const kept = savedClasses(userId).filter(
    (existing) => classKey(existing) !== classKey(cls)
  );
  writeClasses(userId, [cls, ...kept]);
}
export function forgetClass(userId: string, sel: Sel): void {
  if (!userId) return;
  const cls = readClass(sel);
  if (!cls) return;
  writeClasses(
    userId,
    savedClasses(userId).filter(
      (existing) => classKey(existing) !== classKey(cls)
    )
  );
}
const CONNECTING_WORDS = new Set(["and", "of", "the", "for", "in", "a", "to"]);
/** The initials of a phrase, or the phrase itself when it has too few words. */
function initialsOf(words: readonly string[], fallback: string): string {
  const initials = words.map((word) => word[0]?.toUpperCase() ?? "").join("");
  // A lone capital reads as a typo rather than as an abbreviation.
  return initials.length < 2 ? fallback : initials;
}
const INITIALS = /\p{L}/u;
/**
 * A long Portal label reduced to its initialism for a card: "Information
 * Technology" becomes "IT" and "Computer Science and Engineering (Artificial
 * Intelligence)" becomes "CSE(AI)" — the bracket keeps its shape and is shortened
 * inside, because that is how the Portal writes a specialisation.
 *
 * Connecting words contribute nothing, so the name reads "Computer Science and
 * Engineering" becomes "CSE" and not "CSAE". A word already inside the bracket
 * that is itself an initialism is left exactly as written, so "(CSE)" is not
 * turned into "(CS)".
 *
 * Display only. Two sections are told apart by their five values, never by the
 * text on a card, and the full name is what the dropdown says when the card is
 * opened.
 */
export function abbreviate(name: string): string {
  const bracket = name.match(/^\s*(?<head>.*?)\s*\((?<inside>[^()]*)\)\s*$/);
  if (bracket?.groups) {
    const head = bracket.groups.head ?? "";
    const inner = bracket.groups.inside ?? "";
    const before = initialsOf(
      head
        .split(/[\s&/,-]+/)
        .filter((w) => w.length > 0 && !CONNECTING_WORDS.has(w.toLowerCase()))
        .filter((w) => INITIALS.test(w[0] ?? "")),
      head.trim()
    );
    const raw = inner.trim();
    const inside = initialsOf(
      raw
        .split(/[\s&/,-]+/)
        .filter((w) => w.length > 0 && INITIALS.test(w[0] ?? "")),
      raw
    );
    if (!inside) return before;
    // The Portal sometimes writes the short form already: "… (CSE)". Repeating
    // the head beside it would print "CSE(CSE)", so the bracket stands alone.
    return inside === raw && inside === before
      ? inside
      : `${before}(${inside})`;
  }
  return initialsOf(
    name
      .split(/[\s&/,-]+/)
      .filter((w) => w.length > 0 && !CONNECTING_WORDS.has(w.toLowerCase()))
      .filter((w) => INITIALS.test(w[0] ?? "")),
    name
  );
}
