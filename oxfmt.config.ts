import oxfmt from "ultracite/oxfmt";

const GENERATED = ["**/*.md", "oxlint.config.ts", "oxfmt.config.ts"];
export default { ...oxfmt, ignorePatterns: [...(oxfmt.ignorePatterns ?? []), ...GENERATED] };