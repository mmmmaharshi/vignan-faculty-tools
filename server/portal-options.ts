import type { Option } from "../shared/api.js";
import { attributeOf, cellText } from "./portal-html.js";

const OPTION = /<option\b(?<attrs>[^>]*)>(?<text>[\s\S]*?)<\/option>/gi;
const PLACEHOLDER = /^-?\s*select\s*-?$/i;
/** Every `<option>` a reply states, with its value, label and title. An entry
 *  missing either half is dropped: the Portal's reports are asked by value, so
 *  a value-less label cannot name anything. The label goes through the same
 *  strip every other reply goes through, so a markup fix reaches it. */
export function options(html: unknown): Option[] {
  const out: Option[] = [];
  for (const m of String(html ?? "").matchAll(OPTION)) {
    const attrs = m.groups?.attrs ?? "";
    const label = cellText(m.groups?.text ?? "");
    const value = attributeOf(attrs, "value");
    if (label && value) {
      out.push({ value, title: attributeOf(attrs, "title"), label });
    }
  }
  return out;
}
const isPlaceholder = (o: Option): boolean =>
  o.value === "0" || PLACEHOLDER.test(o.label);
export const realOptions = (list: Option[]): Option[] =>
  list.filter((o) => !isPlaceholder(o));
/** A label without the word that merely names its kind: "III Semester" and "III"
 *  are the same semester, and "Section-1" and "1" are not forced together —
 *  everything else about the comparison stays exact. */
const bareLabel = (label: string): string =>
  label
    .replaceAll(
      /\b(?:semester|section|branch|course|year|degree|programme|program)\b/gi,
      ""
    )
    .toLowerCase()
    .replaceAll(/[^a-z0-9]/g, "");
/** The option a page's own words name, or null. Value first, because the Portal's
 * reports are asked by value rather than by label; then the label. A text that
 * names more than one option names none of them: guessing a class reads the
 * wrong section's register, and the figure's own label is the only sign of it. */
export function matchOption(
  text: string,
  list: readonly Option[]
): Option | null {
  const t = text.trim();
  if (!t) return null;
  const byValue = list.find(
    (o) => o.value.trim().toLowerCase() === t.toLowerCase()
  );
  if (byValue) return byValue;
  const bare = bareLabel(t);
  if (!bare) return null;
  const exact = list.filter((o) => bareLabel(o.label) === bare);
  if (exact.length === 1) return exact[0] ?? null;
  const partial = list.filter((o) => bareLabel(o.label).includes(bare));
  return partial.length === 1 ? (partial[0] ?? null) : null;
}
