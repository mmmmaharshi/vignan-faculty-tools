/**
 * Whether Load register may fire, as one state instead of three scattered
 * guards. Till Now is the standing window: while the settle walk is still
 * naming an unremembered class's start, the first click must not take the
 * month window still on screen. A typed From lifts the gate at once (it
 * needs no probe); a typed To alone leaves From unsettled, so it does not.
 */
export type RangeEdited = "" | "from" | "to";

export type LoadGate =
  | "ready"
  | "loading-options"
  | "reading-register"
  | "finding-start";

export function loadGate(input: {
  optionsLoading: boolean;
  registerLoading: boolean;
  preLoading: boolean;
  rememberedStart: string | null;
  rangeEdited: RangeEdited;
}): LoadGate {
  if (input.optionsLoading) return "loading-options";
  if (input.registerLoading) return "reading-register";
  if (
    input.preLoading &&
    !input.rememberedStart &&
    input.rangeEdited !== "from"
  )
    return "finding-start";
  return "ready";
}

const NOTES: Record<LoadGate, string> = {
  "loading-options": "Loading options...",
  "reading-register": "Reading the register from ECAP...",
  "finding-start": "Finding the semester start...",
  ready: "",
};
export function loadNote(gate: LoadGate): string {
  return NOTES[gate];
}
