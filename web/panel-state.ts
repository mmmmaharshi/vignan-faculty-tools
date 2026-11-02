import type { Student } from "../shared/api";

/**
 * The student panel as one state, not two booleans: open, closing (the
 * ~200ms slide-out that still draws the student), or closed. `detail` and
 * `detailOpen` in App were the same facts apart — a read gated on one but
 * not the other fired for a panel already leaving.
 */
export type PanelState =
  | { status: "closed"; student: null }
  | { status: "open"; student: Student }
  | { status: "closing"; student: Student };

export const CLOSED_PANEL: PanelState = { status: "closed", student: null };

export const openPanel = (student: Student): PanelState => ({
  status: "open",
  student,
});

/** Starts the slide-out but keeps the student to draw with while it leaves. */
export const closePanel = (panel: PanelState): PanelState =>
  panel.status === "closed"
    ? panel
    : { status: "closing", student: panel.student };

/** Drops the student once the slide-out ends. A no-op unless closing, so a
 *  stale exit after a reopen never wipes the live panel. */
export const finishClose = (panel: PanelState): PanelState =>
  panel.status === "closing" ? CLOSED_PANEL : panel;

/** Whether a wider absent-dates read may fire: only for an open panel. */
export const isPanelOpen = (panel: PanelState): boolean =>
  panel.status === "open";
