// Formatting, straight from the Ultracite preset so it cannot drift.
//
// oxfmt reads .mjs config files, so unlike oxlint this does not need resolving
// into JSON. The rules that matter for this project: LF endings, double quotes,
// semicolons, 80 columns, sorted imports, and a sorted package.json.
export { default } from "ultracite/oxfmt";
