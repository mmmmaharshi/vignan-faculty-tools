import { useCallback, useEffect, useRef, useState } from "react";

import type { OptionsReply, RegisterReply } from "../../shared/api";
import { selectionAfter } from "./cascade";
import type { Sel } from "./cascade";
import type { CascadeOutcome } from "./cascade-run";
import {
  abbreviate,
  forgetSection,
  rememberSection,
  savedSections,
  sectionKeyOf,
} from "./saved-sections";
import type { SavedSection } from "./saved-sections";

/**
 * The saved sections: whether the selection on screen is one worth saving, the
 * cards that reopen a section, and the three actions on them. App keeps the list
 * itself — it is cleared with the session, and the session is App's — so this
 * hook reads it, writes through `setSaved`, and owns nothing else.
 *
 * The automatic save persists only once a register has loaded (ADR 0016: a
 * failed or ambiguous request must not save a card, and Load register stays a
 * decision), which is why the effect watches the reply rather than the
 * selection. The `save` action this hook returns is the deliberate override:
 * the Save this section button writes the card immediately, before any load.
 */
export function useSavedSections(setup: {
  userId: string;
  sel: Sel;
  opts: OptionsReply;
  savedList: Array<SavedSection> | null;
  registerData: RegisterReply | null;
  setSaved: (
    value: { userId: string; list: Array<SavedSection> } | null
  ) => void;
  setSel: (target: Sel) => void;
  runRefresh: (
    seed: Sel,
    known: OptionsReply
  ) => Promise<CascadeOutcome | null>;
  /** True once the class form can take a register request for the settled class. */
  loadReady: boolean;
  /** Loads the register for a selection the cascade has just settled. */
  loadRegister: (sel: Sel, opts: OptionsReply) => void;
}) {
  const {
    userId,
    sel,
    opts,
    savedList,
    registerData,
    setSaved,
    setSel,
    runRefresh,
    loadReady,
    loadRegister,
  } = setup;
  const sectionChosen =
    Boolean(sel.course) &&
    Boolean(sel.semester) &&
    Boolean(sel.branch) &&
    Boolean(sel.section);
  /** The saved subject is always section-wide, so a subject pick inside an
   *  already saved section does not make it a second saveable class. */
  const currentSaved = Boolean(
    sectionChosen &&
    savedList?.some((s) => sectionKeyOf(s) === sectionKeyOf(sel))
  );
  const remember = useCallback(() => {
    if (!userId || !sectionChosen) {
      return;
    }
    rememberSection(
      userId,
      sel,
      opts.section.find((o) => String(o.value) === sel.section)?.label ?? ""
    );
    setSaved({ userId, list: savedSections(userId) });
  }, [userId, sectionChosen, sel, opts, setSaved]);
  /** Persist the section only once its register has actually loaded. rememberSection
   *  dedupes, so re-loading the same section just moves it to the front. An
   *  already saved section is left alone: an Open must not rewrite the card order. */
  const lastSavedRegister = useRef<RegisterReply | null>(null);
  useEffect(() => {
    if (!userId || !sectionChosen || !registerData) {
      return;
    }
    if (registerData === lastSavedRegister.current) {
      return;
    }
    lastSavedRegister.current = registerData;
    if (!currentSaved) {
      remember();
    }
  }, [userId, sectionChosen, currentSaved, registerData, remember]);
  const clear = useCallback(
    (target: Sel) => {
      forgetSection(userId, target);
      setSaved({ userId, list: savedSections(userId) });
    },
    [userId, setSaved]
  );
  /** Opening a saved section fills its four levels with the section-wide subject
   *  and loads the register it names. Values come from the settled run because
   *  React has not committed that selection yet. */
  const [pendingOpen, setPendingOpen] = useState<{
    outcome: CascadeOutcome;
    userId: string;
  } | null>(null);
  const apply = useCallback(
    async (target: Sel) => {
      setSel(target);
      const outcome = await runRefresh(
        selectionAfter(target, "section", target),
        opts
      );
      if (outcome) {
        setPendingOpen({ outcome, userId });
      }
    },
    [setSel, runRefresh, opts, userId]
  );
  /** The register waits for the gate, so an unremembered class is loaded at the
   *  semester start the settle walk names, not at the month it is about to
   *  replace. A moved selection and the previous session both cancel the open. */
  /* oxlint-disable react/set-state-in-effect */
  useEffect(() => {
    if (!pendingOpen) {
      return;
    }
    if (!userId || pendingOpen.userId !== userId) {
      setPendingOpen(null);
      return;
    }
    if (!loadReady) {
      return;
    }
    if (sectionKeyOf(sel) !== sectionKeyOf(pendingOpen.outcome.sel)) {
      setPendingOpen(null);
      return;
    }
    setPendingOpen(null);
    loadRegister(pendingOpen.outcome.sel, pendingOpen.outcome.opts);
  }, [pendingOpen, userId, loadReady, sel, loadRegister]);
  /* oxlint-enable react/set-state-in-effect */
  /** Each card's names come from the cascade wherever this session has offered
   *  them, falling back to the label saved with the card — `opts` holds only the
   *  branch on screen, so a card from another branch has no name here. */
  const cards =
    savedList?.map((s) => {
      const labelOf = (key: keyof Sel): string =>
        opts[key].find((o) => String(o.value) === String(s[key]))?.label ?? "";
      return {
        sel: s,
        sectionName: labelOf("section") || s.sectionLabel || s.section,
        course: [
          labelOf("course"),
          labelOf("semester"),
          abbreviate(labelOf("branch")),
        ]
          .filter(Boolean)
          .join(" · "),
      };
    }) ?? [];
  return { sectionChosen, currentSaved, cards, save: remember, apply, clear };
}
