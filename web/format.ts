/**
 * How ECAP's shouting reads on screen: one module for the words both panels
 * shape, so the timetable and the unposted list never drift apart.
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
/** "III Semester" + "A" reads "III-A": the pending list's section cell. */
export const sectionShort = (semester: string, section: string): string =>
  `${semester.replace(/\s*Semester\s*/i, "").trim()}-${section.trim()}`;
/** "FLUTER LAB" reads "Fluter Lab": ECAP shouts its subject names, and the
 *  Class column should not. Words of two letters or fewer stay as written, so
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
