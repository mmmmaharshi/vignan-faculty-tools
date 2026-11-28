import React from "react";

import { todayIST } from "../../shared/portal-values";
import type { HomePanelProps } from "./HomePanel";
import { HomePanel } from "./HomePanel";
import type { SavedSections } from "./SavedSections";
import { SavedSections as SavedSectionsList } from "./SavedSections";
import type { UnpostedPanelProps } from "./UnpostedPanel";
import { UnpostedPanel } from "./UnpostedPanel";

/** Home's two surfaces, assembled once. The campus day is this screen's fact,
 *  not the caller's: both panels must name the same day the reads were for.
 *  Saved sections ride above them, so a saved class is one tap away. */
export const HomeScreen = ({
  postings,
  saved,
  ...today
}: Omit<HomePanelProps, "date"> & {
  postings: UnpostedPanelProps;
  saved: React.ComponentProps<typeof SavedSections>;
}): React.JSX.Element => (
  <>
    <SavedSectionsList {...saved} />
    <HomePanel {...today} date={todayIST()} />
    <UnpostedPanel {...postings} />
  </>
);
