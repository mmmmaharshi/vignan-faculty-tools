import type { Dispatch, SetStateAction } from "react";
import { useEffect, useMemo, useState } from "react";

import type { RangeEdited } from "../app/load-gate";
import { useRegisterLoad } from "../data/client";
import type { RegisterClick } from "../data/client";
import { EMPTY_SEL, selOfRequest } from "./cascade";
import type { Sel } from "./cascade";
import { rangeOfRequest, startingRange } from "./range";
import type { Range } from "./range";
import { restoreView, writeRegisterMemory } from "./register-memory";
import { NO_FILTER } from "./worklist";
import type { RowFilter } from "./worklist";

export type DashboardView = {
  /** The selection the page opens on: the class it was showing, or nothing. The
   *  boot cascade settles around this rather than from the top. */
  initialSel: Sel;
  sel: Sel;
  setSel: Dispatch<SetStateAction<Sel>>;
  range: Range;
  setRange: Dispatch<SetStateAction<Range>>;
  filter: RowFilter;
  setFilter: Dispatch<SetStateAction<RowFilter>>;
  rangeEdited: RangeEdited;
  setRangeEdited: Dispatch<SetStateAction<RangeEdited>>;
  click: RegisterClick | null;
  setClick: Dispatch<SetStateAction<RegisterClick | null>>;
  /** The register the click asked for, as the data layer holds it. */
  register: ReturnType<typeof useRegisterLoad>;
};

/**
 * The dashboard's own view of itself: the class the form names, the window, the
 * ticked bars, and the click whose reply the table is showing — plus the one
 * thing that spans a reload, which is all of them.
 *
 * They live together because a reload restores all of them together: one
 * snapshot, one initializer per field from that snapshot, one effect that writes
 * it back. Kept in App they were six declarations threaded through a variable and
 * a cache write hidden in an initializer; kept here, the ordering that makes the
 * restore work is stated in one place.
 */
export function useDashboardView(): DashboardView {
  /** Read once, and handed to the cache before the register hook below asks for
   *  anything: that is what makes a reload show the rows the page last had
   *  instead of fetching them again (ADR 0031). */
  const restored = useMemo(() => restoreView(), []);
  /** The class and the window come out of the click, so they cannot disagree with
   *  the reply this snapshot also holds. */
  const initialSel = useMemo<Sel>(
    () => (restored ? selOfRequest(restored.click.request) : EMPTY_SEL),
    [restored]
  );
  const [sel, setSel] = useState<Sel>(initialSel);
  const [range, setRange] = useState<Range>(() =>
    restored ? rangeOfRequest(restored.click.request) : startingRange()
  );
  const [filter, setFilter] = useState<RowFilter>(
    () => restored?.filter ?? NO_FILTER
  );
  const [rangeEdited, setRangeEdited] = useState<RangeEdited>(
    () => restored?.rangeEdited ?? ""
  );
  const [click, setClick] = useState<RegisterClick | null>(
    () => restored?.click ?? null
  );
  const register = useRegisterLoad(click);
  /** Written whenever the reply on screen, the bars or the hand-typed window
   *  change, and only then: a memory written from a blank screen would erase the
   *  thing it exists to protect. */
  useEffect(() => {
    if (!click || !register.data) return;
    writeRegisterMemory({
      filter,
      rangeEdited,
      click,
      register: register.data,
    });
  }, [click, register.data, filter, rangeEdited]);
  return {
    initialSel,
    sel,
    setSel,
    range,
    setRange,
    filter,
    setFilter,
    rangeEdited,
    setRangeEdited,
    click,
    setClick,
    register,
  };
}
