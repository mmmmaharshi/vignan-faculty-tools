import {
  Alert,
  Center,
  Loader,
  Paper,
  Select,
  SimpleGrid,
  Stack,
  Text,
  Title,
} from "@mantine/core";
import React, { useState } from "react";

import type { DayWorkSection } from "../../shared/api";
import { sectionShort } from "../format";
import type { Note } from "../types";

export type UnpostedPanelProps = {
  /** Every section's cells in the report's order. Null while unread; empty
   *  when the report stated no sections at all — no classes that day, which
   *  is not the same as all posted. */
  sections?: DayWorkSection[] | null;
  busy?: boolean;
  /** A read that failed says so here. A fully posted day is not this — it is
   *  an "all posted" line below. */
  note?: Note | null;
};
/** One branch's sections shown individually: each section gets its own row of
 *  period boxes, filled when that period's attendance is posted, empty
 *  otherwise. */
const BranchPending = ({
  sections,
}: {
  sections: DayWorkSection[];
}): React.JSX.Element => (
  <Stack gap="md">
    {sections.map((section) => {
      const postedByPeriod = new Map<string, boolean>();
      for (const cell of section.cells) {
        const current = postedByPeriod.get(cell.period);
        postedByPeriod.set(cell.period, (current ?? true) && cell.posted);
      }
      const where = sectionShort(section.semester, section.section);
      const periods = Array.from({ length: 7 }, (_, index) =>
        String(index + 1)
      );
      return (
        <Stack key={where} gap="xs">
          <Text fw={600} size="sm">
            {where}
          </Text>
          <SimpleGrid cols={7} spacing="xs">
            {periods.map((period) => {
              const posted = postedByPeriod.get(period) === true;
              return (
                <Paper
                  key={period}
                  h={40}
                  p={0}
                  bg={posted ? "green.6" : "gray.1"}
                  withBorder
                  radius="sm"
                >
                  <Center h={40}>
                    <Text size="sm" fw={700} c={posted ? "white" : "dimmed"}>
                      {period}
                    </Text>
                  </Center>
                </Paper>
              );
            })}
          </SimpleGrid>
        </Stack>
      );
    })}
  </Stack>
);
export const UnpostedPanel = ({
  sections,
  busy,
  note,
}: UnpostedPanelProps): React.JSX.Element => {
  const branches: string[] = [];
  if (sections) {
    for (const section of sections) {
      if (!branches.includes(section.branch)) branches.push(section.branch);
    }
  }
  const [chosen, setChosen] = useState<string | null>(null);
  const active =
    chosen && branches.includes(chosen) ? chosen : (branches[0] ?? null);
  const inBranch = (branch: string): DayWorkSection[] =>
    sections ? sections.filter((s) => s.branch === branch) : [];
  const shortOf = (branch: string): string =>
    sections?.find((s) => s.branch === branch)?.branchShort ?? branch;
  return (
    <Stack gap="md" mt="xl" pb="md">
      <Title order={4}>Today&apos;s Attendance</Title>
      {note ? (
        <Alert color={note.kind === "error" ? "red" : "yellow"}>
          {note.text}
        </Alert>
      ) : null}
      {!sections && busy ? (
        <Stack align="center" mt="xl" gap="sm">
          <Loader size="lg" />
          <Text c="dimmed" size="sm">
            Reading the branches from ECAP...
          </Text>
        </Stack>
      ) : null}
      {sections && sections.length === 0 && !busy ? (
        <Paper withBorder p="lg">
          <Text c="dimmed">No classes today.</Text>
        </Paper>
      ) : null}
      {sections && sections.length > 0 ? (
        <>
          <Select
            value={active ?? ""}
            onChange={(value) => setChosen(value ?? null)}
            data={branches.map((branch) => ({
              value: branch,
              label: shortOf(branch),
            }))}
            placeholder="Choose a branch"
            aria-label="Branch"
          />
          {active ? (
            <BranchPending key={active} sections={inBranch(active)} />
          ) : null}
        </>
      ) : null}
    </Stack>
  );
};
