import { Button, Group, TextInput } from "@mantine/core";
import React from "react";

import type { SearchResult } from "../register/search-result";
import { StudentDetails } from "./StudentDetails";

/** Student Search's form and its one panel. The ask and its result are decided
 *  in App; this component only reads the outcome the result already carries. */
export const SearchScreen = ({
  roll,
  onRollChange,
  onSubmit,
  searching,
  found,
}: {
  roll: string;
  onRollChange: (roll: string) => void;
  onSubmit: (event: React.FormEvent<HTMLFormElement>) => void;
  searching: boolean;
  found: SearchResult;
}): React.JSX.Element => (
  <>
    <form onSubmit={onSubmit}>
      <Group align="flex-end" gap="sm">
        <TextInput
          label="Roll number"
          placeholder="21CS001"
          value={roll}
          onChange={(e) => onRollChange(e.currentTarget.value)}
          flex={1}
        />
        <Button type="submit" loading={searching}>
          Search
        </Button>
      </Group>
    </form>
    {/* Idle has no student, no note and no busy: nothing for the panel to say
        until an ask has an answer. */}
    {found.kind === "idle" ? null : (
      <StudentDetails
        student={found.student}
        inline
        profile={found.profile}
        busy={searching}
        note={found.note}
        scope={found.scope ?? []}
        fullAbsent={found.fullAbsent}
        fullTitle="Absent — full semester"
      />
    )}
  </>
);
