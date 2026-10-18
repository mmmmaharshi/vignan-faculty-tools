import type { Sel } from "./cascade";

/** A saved class: the five values that name a register, plus the Subject's label as
 *  a display cache. The label is never the answer — the cascade's own label wins
 *  whenever this session has offered the subject — so a renamed subject corrects
 *  itself the moment it is opened, and the cache only covers the cards that have
 *  not been opened yet. */
export type SavedClass = Sel & { label?: string };
/**
 * A saved class is a Subject within a Section: five values, and the Subject's
 * label as a display cache. No date is stored — the range belongs to the
 * register, not to the class, and a remembered `to` would open the app on
 * last month's numbers.
 *
 * The label is a cache and never the answer: the cascade's own label wins whenever
 * this session has offered the subject, so a subject ECAP has renamed corrects
 * itself the moment its card is opened. It is stored because a card that cannot
 * name its own subject asks the user to open every card once per browser session
 * before the screen is readable, which is a worse trade than a name that is right
 * up to the moment ECAP renames it.
 *
 * Storing the Subject means one card per subject taught, which is what the user
 * asked for: opening one fills all five levels and lands on that Subject's
 * register. It is a different trade from ADR 0016's one-card-per-section, and
 * the cost is that three subjects in one section are three cards differing only
 * in their last value. That is deliberate, not an oversight.
 *
 * The key is scoped by user id, so a shared machine does not offer one person's
 * classes to the next. localStorage is per-browser, so it does not follow anyone
 * to another machine.
 */
const CLASS_KEY_PREFIX = "section-";
/** All five levels: a saved class names the register it opens. */
const CLASS_LEVELS = [
  "course",
  "semester",
  "branch",
  "section",
  "subject",
] as const;
/** The identity of a saved class: the five levels in a fixed order, so two saves
 *  of the same class compare equal without depending on key order. */
const classKey = (values: Record<string, string>): string =>
  CLASS_LEVELS.map((key) => values[key]).join(" ");
/** A stored entry becomes a class only if all five levels are strings. Anything
 *  else is dropped rather than half-read. A missing label is not a fault: an entry
 *  written before labels were kept still opens, it just says nothing until opened. */
function readClass(value: unknown): SavedClass | null {
  if (typeof value !== "object" || value === null) return null;
  const values = value as Record<string, unknown>;
  const read = (key: (typeof CLASS_LEVELS)[number]): string => {
    const found = values[key];
    return typeof found === "string" ? found : "";
  };
  const cls: SavedClass = {
    course: read("course"),
    semester: read("semester"),
    branch: read("branch"),
    section: read("section"),
    subject: read("subject"),
  };
  if (!CLASS_LEVELS.every((key) => cls[key])) return null;
  const { label } = values;
  if (typeof label === "string" && label) cls.label = label;
  return cls;
}
function writeClasses(userId: string, list: readonly SavedClass[]): void {
  try {
    localStorage.setItem(`${CLASS_KEY_PREFIX}${userId}`, JSON.stringify(list));
  } catch {
    /* a refused write must not break the screen */
  }
}
export function savedClasses(userId: string): SavedClass[] {
  if (!userId) return [];
  let raw: string | null;
  try {
    raw = localStorage.getItem(`${CLASS_KEY_PREFIX}${userId}`);
  } catch {
    return [];
  }
  if (!raw) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  // A single object is what an earlier build stored, and it is still offered.
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
export function rememberClass(userId: string, sel: Sel, label = ""): void {
  if (!userId) return;
  const cls = readClass(sel);
  if (!cls) return;
  if (label) cls.label = label;
  // Re-saving moves the class to the front rather than duplicating it: the one
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
 * Display only. Two classes are told apart by their five values, never by the text
 * on a card, and the full name is what the dropdown says when the card is opened.
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
