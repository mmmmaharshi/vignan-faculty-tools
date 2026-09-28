/**
 * Formatting, straight from the Ultracite preset so it cannot drift.
 *
 * The preset's `proseWrap: "never"` does not mean "leave prose alone" - it means
 * "never wrap", so it *unwraps* every soft line break already in the file. Run
 * over this repository that deleted 579 lines across nine markdown files, turning
 * each hand-wrapped paragraph at 80 columns into a single long line. These docs
 * are read in a terminal and in diffs, where that wrapping is the point, and they
 * are prose rather than code, so a formatter has no business rewriting them.
 *
 * Both config files are excluded too, since they are read by the tools rather than
 * written by hand, and letting the formatter reflow them would just churn.
 */

import oxfmt from "ultracite/oxfmt";

const GENERATED = ["**/*.md", "oxlint.config.ts", "oxfmt.config.ts"];

export default { ...oxfmt, ignorePatterns: [...(oxfmt.ignorePatterns ?? []), ...GENERATED] };
