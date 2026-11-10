import { useCallback, useEffect, useRef } from "react";

import type { OptionsReply, RegisterReply } from "../../shared/api";
import { selectionAfter } from "./cascade";
import type { Sel } from "./cascade";
import {
  abbreviate,
  forgetClass,
  rememberClass,
  savedClasses,
} from "./saved-classes";
import type { SavedClass, SavedClassCard } from "./saved-classes";

/**
 * The saved sections: whether the selection on screen is one worth saving, the
 * cards that reopen a section, and the three actions on them. App keeps the list
 * itself — it is cleared with the session, and the session is App's — so this
 * hook reads it, writes through `setSaved`, and owns nothing else.
 *
 * `save` persists only once a register has loaded (See ADR 0016: a failed or
 * ambiguous request must not save a card, and Load register stays a decision),
 * which is why the effect watches the reply rather than the selection.
 */
export function useSavedClasses(setup: {
  userId: string;
  sel: Sel;
  opts: OptionsReply;
  savedList: SavedClass[] | null;
  registerData: RegisterReply | null;
  setSaved: (value: { userId: string; list: SavedClass[] } | null) => void;
  setSel: (target: Sel) => void;
  runRefresh: (seed: Sel, known: OptionsReply) => Promise<void>;
}): {
  /** The four levels that name a section, all chosen. The subject is not one of
   *  them: a card reopens the section and lands on the section-wide register. */
  classChosen: boolean;
  cards: SavedClassCard[];
  save: () => void;
  apply: (target: Sel) => void;
  clear: (target: Sel) => void;
} {
  const {
    userId,
    sel,
    opts,
    savedList,
    registerData,
    setSaved,
    setSel,
    runRefresh,
  } = setup;
  const classChosen =
    Boolean(sel.course) &&
    Boolean(sel.semester) &&
    Boolean(sel.branch) &&
    Boolean(sel.section);
  const remember = useCallback(() => {
    if (!userId || !classChosen) return;
    rememberClass(
      userId,
      sel,
      opts.section.find((o) => String(o.value) === sel.section)?.label ?? ""
    );
    setSaved({ userId, list: savedClasses(userId) });
  }, [userId, classChosen, sel, opts, setSaved]);
  /** Persist the section only once its register has actually loaded. rememberClass
   *  dedupes, so re-loading the same section just moves it to the front. */
  const lastSavedRegister = useRef<RegisterReply | null>(null);
  useEffect(() => {
    if (!userId || !classChosen || !registerData) return;
    if (registerData === lastSavedRegister.current) return;
    lastSavedRegister.current = registerData;
    remember();
  }, [userId, classChosen, registerData, remember]);
  const clear = useCallback(
    (target: Sel) => {
      forgetClass(userId, target);
      setSaved({ userId, list: savedClasses(userId) });
    },
    [userId, setSaved]
  );
  /** Opening a saved section fills its four levels with the section-wide subject:
   *  no register is fetched, and Load register stays a decision. */
  const apply = useCallback(
    (target: Sel) => {
      setSel(target);
      void runRefresh(selectionAfter(target, "section", target), opts);
    },
    [setSel, runRefresh, opts]
  );
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
  return { classChosen, cards, save: remember, apply, clear };
}
