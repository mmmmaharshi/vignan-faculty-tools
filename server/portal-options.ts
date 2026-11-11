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
