/**
 * A message under a form, coloured by kind.
 *
 * The only shape here, and it is here because three modules need it: `App` raises
 * it, and the two modules that render a message take it. Everything else that
 * used to live in this file has a better home - `Sel`, `Range` and `Disabled` are
 * cascade vocabulary and are declared in `web/cascade.ts` beside the rules that
 * use them.
 */
export type Note = { kind: "error" | "warning"; text: string };
