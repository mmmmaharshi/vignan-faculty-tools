import React from "react";

import { RegisterSummary } from "./RegisterSummary";
import { RegisterTable } from "./RegisterTable";
import { SavedSections } from "./SavedSections";
import { StudentDetails } from "./StudentDetails";

type TableProps = React.ComponentProps<typeof RegisterTable>;

/** The Register screen: saved cards, the class form, the figures for the load
 *  on screen and the student panel that load opens. Every value comes from App,
 *  which owns the session and the selection behind them. */
export const RegisterScreen = ({
  saved,
  picker,
  table,
  panel,
}: {
  saved: React.ComponentProps<typeof SavedSections>;
  picker: React.ReactNode;
  table: Omit<TableProps, "summary"> & {
    summary: TableProps["summary"] | undefined;
  };
  panel: React.ComponentProps<typeof StudentDetails>;
}): React.JSX.Element => (
  <>
    <SavedSections {...saved} />
    {picker}
    {table.summary ? (
      <>
        <RegisterSummary
          summary={table.summary}
          scope={table.overallMode ? "overall" : "subject"}
        />
        <RegisterTable {...table} summary={table.summary} />
      </>
    ) : null}
    <StudentDetails {...panel} />
  </>
);
