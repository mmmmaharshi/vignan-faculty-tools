import {
  Alert,
  Card,
  Center,
  Loader,
  Paper,
  Select,
  SimpleGrid,
  Stack,
  Text,
  Title,
} from "@mantine/core";
import React from "react";

import type { DayWorkSection } from "../../shared/api";
import { PERIODS } from "../period-times";
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
  /** The branch currently shown; null means none chosen yet. */
  branch?: string | null;
  /** Called when the user picks a branch. */
  onBranchChange?: (branch: string | null) => void;
};

/** Branches named by the report, in first-seen order. */
export function branchesOf(
  sections: DayWorkSection[] | null | undefined
): string[] {
  const out: string[] = [];
  for (const section of sections ?? []) {
    if (!out.includes(section.branch)) out.push(section.branch);
  }
  return out;
}

/** Postedness per period for one section: a period is posted only when every
 *  cell the section has for it is posted. */
function postedByPeriod(cells: DayWorkSection["cells"]): Map<string, boolean> {
  const map = new Map<string, boolean>();
  for (const cell of cells) {
    const current = map.get(cell.period);
    map.set(
      cell.period,
      current === undefined ? cell.posted : current && cell.posted
    );
  }
  return map;
}

const PeriodBox = ({
  period,
  posted,
}: {
  period: string;
  posted: boolean;
}): React.JSX.Element => (
  <Paper h={40} p={0} bg={posted ? "green.6" : "gray.1"} withBorder radius="sm">
    <Center h={40}>
      <Text size="sm" fw={700} c={posted ? "white" : "dimmed"}>
        {period}
      </Text>
    </Center>
  </Paper>
);

const SectionBoxes = ({
  section,
}: {
  section: DayWorkSection;
}): React.JSX.Element => {
  const posted = postedByPeriod(section.cells);
  const pending = section.cells.filter((cell) => !cell.posted);
  return (
    <Stack gap="xs">
      <Text fw={600} size="sm">
        Section {section.section}
      </Text>
      <SimpleGrid cols={7} spacing="xs">
        {PERIODS.map((period) => (
          <PeriodBox
            key={period}
            period={period}
            posted={posted.get(period) === true}
          />
        ))}
      </SimpleGrid>
      {pending.length > 0 ? (
        <Text size="xs" c="dimmed">
          Pending:{" "}
          {pending
            .map((cell) => `${cell.period} (${cell.staff || "—"})`)
            .join(", ")}
        </Text>
      ) : null}
    </Stack>
  );
};

/** One branch's sections grouped by semester into cards. */
const BranchPending = ({
  sections,
}: {
  sections: DayWorkSection[];
}): React.JSX.Element => {
  const bySemester = new Map<string, DayWorkSection[]>();
  for (const section of sections) {
    const list = bySemester.get(section.semester) ?? [];
    list.push(section);
    bySemester.set(section.semester, list);
  }
  return (
    <Stack gap="md">
      {[...bySemester.entries()].map(([semester, group]) => (
        <Card key={semester} withBorder padding="sm" radius="sm">
          <Stack gap="md">
            <Text fw={700}>{semester}</Text>
            {group.map((section) => (
              <SectionBoxes key={section.section} section={section} />
            ))}
          </Stack>
        </Card>
      ))}
    </Stack>
  );
};

export const UnpostedPanel = ({
  sections,
  busy,
  note,
  branch,
  onBranchChange,
}: UnpostedPanelProps): React.JSX.Element => {
  const branches = branchesOf(sections);
  const shortOf = (b: string): string =>
    sections?.find((s) => s.branch === b)?.branchShort ?? b;
  const inBranch = (b: string): DayWorkSection[] =>
    sections ? sections.filter((s) => s.branch === b) : [];
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
            value={branch ?? ""}
            onChange={(value) => onBranchChange?.(value ?? null)}
            data={branches.map((b) => ({
              value: b,
              label: shortOf(b),
            }))}
            placeholder="Choose a branch"
            aria-label="Branch"
          />
          {branch ? (
            <BranchPending key={branch} sections={inBranch(branch)} />
          ) : null}
        </>
      ) : null}
    </Stack>
  );
};
