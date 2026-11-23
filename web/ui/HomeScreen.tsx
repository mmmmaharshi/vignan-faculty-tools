import React from "react";

import { todayIST } from "../../shared/portal-values";
import type { HomePanelProps } from "./HomePanel";
import { HomePanel } from "./HomePanel";
import type { UnpostedPanelProps } from "./UnpostedPanel";
import { UnpostedPanel } from "./UnpostedPanel";

/** Home's two surfaces, assembled once. The campus day is this screen's fact,
 *  not the caller's: both panels must name the same day the reads were for. */
export const HomeScreen = ({
  postings,
  ...today
}: Omit<HomePanelProps, "date"> & {
  postings: UnpostedPanelProps;
}): React.JSX.Element => (
  <>
    <HomePanel {...today} date={todayIST()} />
    <UnpostedPanel {...postings} />
  </>
);
