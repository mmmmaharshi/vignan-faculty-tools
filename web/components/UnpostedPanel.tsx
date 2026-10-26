import {
  Alert,
  Card,
  Center,
  Loader,
  Modal,
  Paper,
  Select,
  SimpleGrid,
  Stack,
  Text,
  Title,
  UnstyledButton,
} from "@mantine/core";
import React, { useState } from "react";

import type { DayWorkCell, DayWorkSection } from "../../shared/api";
import { PERIODS } from "../period-times";
import type { Note } from "../types";
import { FactsTable } from "./FactsTable";

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

/** One section's cells by period, in the report's order: the boxes and the
 *  detail modal read this one grouping, so a period cannot show posted in
 *  one and unposted in the other. */
function cellsByPeriod(cells: DayWorkCell[]): Map<string, DayWorkCell[]> {
  const map = new Map<string, DayWorkCell[]>();
  for (const cell of cells) {
    const list = map.get(cell.period) ?? [];
    list.push(cell);
    map.set(cell.period, list);
  }
  return map;
}

/** Postedness per period for one section: a period is posted only when every
 *  cell the section has for it is posted. */
function postedByPeriod(cells: DayWorkCell[]): Map<string, boolean> {
  const map = new Map<string, boolean>();
  for (const [period, group] of cellsByPeriod(cells)) {
    map.set(
      period,
      group.every((cell) => cell.posted)
    );
  }
  return map;
}

/** The cell a period box opens onto: the first the report states for it. */
function firstCell(cells: DayWorkCell[], period: string): DayWorkCell | null {
  return cellsByPeriod(cells).get(period)?.[0] ?? null;
}

const PeriodBox = ({
  period,
  posted,
  label,
  onOpen,
}: {
  period: string;
  posted: boolean;
  label: string;
  onOpen: () => void;
}): React.JSX.Element => (
  // A real button, not a div with a handler: keyboard and reader free.
  // The box names only its period; subject and staff live in the modal it
  // opens, so the grid stays glanceable.
  <UnstyledButton onClick={onOpen} aria-label={label} w="100%">
    <Paper
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
  </UnstyledButton>
);

/** What a period box opens onto: "Posted", "Not posted yet", or the honest
 *  third answer — a free period states no cell at all, which is not an
 *  unposted class. */
const statusOf = (cell: DayWorkCell | null): string => {
  if (cell == null) return "No class stated";
  return cell.posted ? "Posted" : "Not posted yet";
};

/** One open box: the section and period it was opened from. A single modal
 *  serves the whole branch — one mounted dialog, not one per section. */
type SlotSelection = {
  section: DayWorkSection;
  period: string;
} | null;

/** Whose class a period box is: the section and period it was opened from,
 *  the subject and staff ECAP states for them, and whether it posted. A
 *  free period states no cell at all, which is not an unposted class — the
 *  modal says so instead of naming a teacher for an empty room. */
const SlotDetails = ({
  selection,
  onClose,
}: {
  selection: SlotSelection;
  onClose: () => void;
}): React.JSX.Element => {
  const cell =
    selection === null
      ? null
      : firstCell(selection.section.cells, selection.period);
  const facts =
    selection === null
      ? null
      : [
          { label: "Branch", value: selection.section.branch },
          { label: "Semester", value: selection.section.semester },
          { label: "Section", value: selection.section.section },
          { label: "Period", value: selection.period },
          {
            label: "Subject",
            value: cell?.subject || "No class stated",
          },
          { label: "Staff", value: cell?.staff || "—" },
          { label: "Status", value: statusOf(cell) },
          // Counts exist only where posted: an unposted period has no
          // headcount to show, not a zero one.
          ...(cell?.posted
            ? [
                { label: "Present", value: cell.present || "—" },
                { label: "Absent", value: cell.absent || "—" },
              ]
            : []),
        ];
  return (
    <Modal
      opened={selection !== null}
      onClose={onClose}
      title={
        selection === null
          ? ""
          : `Period ${selection.period} · Section ${selection.section.section}`
      }
    >
      {facts ? <FactsTable facts={facts} /> : null}
    </Modal>
  );
};

const SectionBoxes = ({
  section,
  onOpen,
}: {
  section: DayWorkSection;
  onOpen: (period: string) => void;
}): React.JSX.Element => {
  const posted = postedByPeriod(section.cells);
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
            label={`Period ${period}, Section ${section.section}`}
            onOpen={() => onOpen(period)}
          />
        ))}
      </SimpleGrid>
    </Stack>
  );
};

/** One branch's sections grouped by semester into cards. Holds the one open
 *  box for the branch: UI-ephemeral like HomePanel's clock, while the branch
 *  choice (which section list is on screen) stays in App. */
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
  const [open, setOpen] = useState<SlotSelection>(null);
  return (
    <Stack gap="md">
      {[...bySemester.entries()].map(([semester, group]) => (
        <Card key={semester} withBorder padding="sm" radius="sm">
          <Stack gap="md">
            <Text fw={700}>{semester}</Text>
            {group.map((section) => (
              <SectionBoxes
                key={section.section}
                section={section}
                onOpen={(period) => setOpen({ section, period })}
              />
            ))}
          </Stack>
        </Card>
      ))}
      <SlotDetails selection={open} onClose={() => setOpen(null)} />
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
