import type { Dispatch, SetStateAction } from "react";
import { useState } from "react";

import type { RangeEdited } from "../app/load-gate";
import { useRegisterLoad } from "../data/client";
import type { RegisterClick } from "../data/client";
import { EMPTY_SEL } from "./cascade";
import type { Sel } from "./cascade";
import { startingRange } from "./range";
import type { Range } from "./range";
import { NO_FILTER } from "./worklist";
import type { RowFilter } from "./worklist";

export type DashboardView = {
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
 * The dashboard's own view of itself: the class the form names, the window,
 * the ticked bars, and the click whose reply the table is showing. All of it
 * starts empty on every load: the selection stays out of the URL, and the
 * roster is not kept in the browser for a later visit.
 */
export function useDashboardView(): DashboardView {
  const [sel, setSel] = useState<Sel>(EMPTY_SEL);
  const [range, setRange] = useState<Range>(() => startingRange());
  const [filter, setFilter] = useState<RowFilter>(NO_FILTER);
  const [rangeEdited, setRangeEdited] = useState<RangeEdited>("");
  const [click, setClick] = useState<RegisterClick | null>(null);
  const register = useRegisterLoad(click);
  return {
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
