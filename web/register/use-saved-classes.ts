import { useCallback, useEffect, useRef } from "react";

import type { OptionsReply, RegisterReply } from "../../shared/api";
import { isAllSubjects, selectionAfter, subjectNameKey } from "./cascade";
import type { Sel } from "./cascade";
import {
  abbreviate,
  forgetClass,
  rememberClass,
  savedClasses,
} from "./saved-classes";
import type { SavedClass } from "./saved-classes";

/** One card above the class form: the five values a saved class reopens, and
 *  the three names that make it readable. */
export type SavedClassCard = {
  sel: SavedClass;
  subject: string;
  sectionName: string;
  course: string;
};

/**
 * The saved classes: whether the selection on screen is one worth saving, the
 * cards that reopen a class, and the three actions on them. App keeps the list
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
  subjectNames: ReadonlyMap<string, string>;
  registerData: RegisterReply | null;
  setSaved: (value: { userId: string; list: SavedClass[] } | null) => void;
  setSel: (target: Sel) => void;
  runRefresh: (seed: Sel, known: OptionsReply) => Promise<void>;
}): {
  /** All five levels named, and the subject a real one rather than ALL SUBJECTS:
   *  a section-wide view is not a class a card can reopen. */
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
    subjectNames,
    registerData,
    setSaved,
    setSel,
    runRefresh,
  } = setup;
  const classChosen =
    Boolean(sel.course) &&
    Boolean(sel.semester) &&
    Boolean(sel.branch) &&
    Boolean(sel.section) &&
    Boolean(sel.subject) &&
    !isAllSubjects(opts.subject.find((o) => String(o.value) === sel.subject));
  const remember = useCallback(() => {
    if (!userId || !classChosen) return;
    rememberClass(
      userId,
      sel,
      opts.subject.find((o) => String(o.value) === sel.subject)?.label ?? ""
    );
    setSaved({ userId, list: savedClasses(userId) });
  }, [userId, classChosen, sel, opts, setSaved]);
  /** Persist the class only once its register has actually loaded. rememberClass
   *  dedupes, so re-loading the same class just moves it to the front. */
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
  /** Opening a saved class fills all five levels and nothing else: no register
   *  is fetched, and Load register stays a decision. */
  const apply = useCallback(
    (target: Sel) => {
      setSel(target);
      void runRefresh(selectionAfter(target, "section", target), opts);
    },
    [setSel, runRefresh, opts]
  );
  /** Each card's names come from the cascade wherever this session has offered
   *  them, falling back to the label cached at save time for the cards it has
   *  not. The Subject leads, because that is what tells one saved class from
   *  another in the same section. */
  const cards =
    savedList?.map((s) => {
      const labelOf = (key: keyof Sel): string =>
        opts[key].find((o) => String(o.value) === String(s[key]))?.label ?? "";
      return {
        sel: s,
        subject:
          subjectNames.get(subjectNameKey(s.section, s.subject)) ??
          s.label ??
          "",
        sectionName: labelOf("section") || s.section,
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
