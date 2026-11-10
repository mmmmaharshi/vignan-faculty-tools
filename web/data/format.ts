/**
 * How ECAP's shouting reads on screen, so the timetable's cells and pills never
 * drift apart.
 */
/** "(CSE (AI))" rides the pill as "CSE(AI)": outer parens off, spaces out. */
const compactBranch = (branch: string): string =>
  branch.replace(/^\((?<inner>.*)\)$/, "$<inner>").replaceAll(/\s+/g, "");
/** The subject's trailing branch ("FLUTER LAB (CSE (AI))" → "FLUTER LAB" plus
 *  "(CSE (AI))"), so the branch rides a pill with the rest. A subject with no
 *  trailing parens keeps its single line. */
export const splitSubject = (
  subject: string
): {
  name: string;
  branch: string;
} => {
  const parts = subject.match(/^(?<name>.*?)\s*(?<branch>\(.*\))$/)?.groups;
  return parts?.name && parts.branch
    ? { name: parts.name, branch: compactBranch(parts.branch) }
    : { name: subject, branch: "" };
};
/** The section's pieces, each riding its own pill: the comma separates the
 *  section from the course line, a "B.Tech V Semester" course line splits
 *  into its course and a short "V Sem", and anything else stays one pill. */
export const pillsOf = (section: string): string[] =>
  section
    .split(",")
    .flatMap((piece) => {
      const words = piece.trim();
      const full = words.match(
        /^(?<course>\S+)\s+(?<numeral>[IVX]+)\s+Semester$/i
      )?.groups;
      if (full?.course && full.numeral) {
        return [full.course, `${full.numeral} Sem`];
      }
      const bare = words.match(/^(?<numeral>[IVX]+)\s+Semester$/i)?.groups;
      if (bare?.numeral) return [`${bare.numeral} Sem`];
      return [words];
    })
    .filter(Boolean);
/**
 * "08:45 AM- 09:35 PM" as minutes since midnight, or null when the grid wrote
 * something else. Twelve-hour clock, as ECAP writes it.
 */
const TIME_RANGE =
  /(?<from>\d{1,2}:\d{2}\s*[AP]M)\s*-\s*(?<to>\d{1,2}:\d{2}\s*[AP]M)/i;
const toMinutes = (clock: string): number | null => {
  const parts = clock
    .trim()
    .match(/^(?<hour>\d{1,2}):(?<minute>\d{2})\s*(?<half>[AP])M$/i)?.groups;
  if (!parts?.hour || !parts.minute || !parts.half) return null;
  const hour =
    (Number(parts.hour) % 12) + (parts.half.toUpperCase() === "P" ? 12 : 0);
  return hour * 60 + Number(parts.minute);
};
/**
 * Whether a period is running right now, by the browser's own clock — ECAP and
 * the faculty share the campus day. The two ends read on a 24-hour clock, so a
 * range that runs past midnight still contains its early minutes.
 *
 * It lives here rather than in the panel because a rule that can only be read
 * beside JSX is a rule that cannot be pinned by a test, and this one is wrong
 * for every afternoon period if the 12-hour conversion loses its noon.
 */
export const isLive = (time: string, now: Date): boolean => {
  const range = time.match(TIME_RANGE)?.groups;
  const from = range?.from ? toMinutes(range.from) : null;
  const to = range?.to ? toMinutes(range.to) : null;
  if (from === null || to === null) return false;
  const at = now.getHours() * 60 + now.getMinutes();
  return from <= to ? from <= at && at < to : at >= from || at < to;
};
/** "FLUTER LAB" reads "Fluter Lab": ECAP shouts its subject names, and the *  Class column should not. Words of two letters or fewer stay as written, so
 *  an acronym like "AI" does not come out "Ai". */
export const capitalCase = (text: string): string =>
  text
    .split(" ")
    .map((word) =>
      word.length <= 2
        ? word
        : word.toLowerCase().replace(/^\S/, (first) => first.toUpperCase())
    )
    .join(" ");
