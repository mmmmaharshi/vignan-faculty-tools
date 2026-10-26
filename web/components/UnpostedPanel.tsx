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
  subject,
  staff,
  posted,
  label,
  onOpen,
}: {
  period: string;
  /** What ECAP states for the period, or "" where it states none. Shown on
   *  unposted boxes only — posted and free boxes stay plain numbers. */
  subject: string;
  staff: string;
  posted: boolean;
  label: string;
  onOpen: () => void;
}): React.JSX.Element => {
  const namesClass = !posted && (subject !== "" || staff !== "");
  return (
    // A real button, not a div with a handler: keyboard and reader free.
    <UnstyledButton
      onClick={onOpen}
      aria-label={label}
      style={{ width: "100%" }}
    >
      <Paper
        h={64}
        p={0}
        bg={posted ? "green.6" : "gray.1"}
        withBorder
        radius="sm"
      >
        <Center h={64}>
          <Stack gap={0} align="center">
            <Text size="sm" fw={700} c={posted ? "white" : "dimmed"}>
              {period}
            </Text>
            {namesClass && subject ? (
              <Text size="xs" c="dimmed" truncate maw="100%">
                {subject}
              </Text>
            ) : null}
            {namesClass && staff ? (
              <Text size="xs" c="dimmed" truncate maw="100%">
                {staff}
              </Text>
            ) : null}
          </Stack>
        </Center>
      </Paper>
    </UnstyledButton>
  );
};

/** What a period box opens onto: "Posted", "Not posted yet", or the honest
 *  third answer — a free period states no cell at all, which is not an
 *  unposted class. */
const statusOf = (cell: DayWorkCell | null): string => {
  if (cell == null) return "No class stated";
  return cell.posted ? "Posted" : "Not posted yet";
};

/** Whose class a period box is: the section and period it was opened from,
 *  the subject and staff ECAP states for them, and whether it posted. A
 *  free period states no cell at all, which is not an unposted class — the
 *  modal says so instead of naming a teacher for an empty room. */
const SlotDetails = ({
  section,
  period,
  onClose,
}: {
  section: DayWorkSection;
  period: string | null;
  onClose: () => void;
}): React.JSX.Element => {
  const cell: DayWorkCell | null =
    period === null
      ? null
      : (section.cells.find((entry) => entry.period === period) ?? null);
  return (
    <Modal
      opened={period !== null}
      onClose={onClose}
      title={
        period === null ? "" : `Period ${period} · Section ${section.section}`
      }
    >
      {period === null ? null : (
        <FactsTable
          facts={[
            { label: "Branch", value: section.branch },
            { label: "Semester", value: section.semester },
            { label: "Section", value: section.section },
            { label: "Period", value: period },
            {
              label: "Subject",
              value: cell?.subject || "No class stated",
            },
            { label: "Staff", value: cell?.staff || "—" },
            { label: "Status", value: statusOf(cell) },
          ]}
        />
      )}
    </Modal>
  );
};

const SectionBoxes = ({
  section,
}: {
  section: DayWorkSection;
}): React.JSX.Element => {
  const posted = postedByPeriod(section.cells);
  // UI-ephemeral like HomePanel's clock: what is open lives here, while the
  // branch choice (which section list is on screen) stays in App.
  const [open, setOpen] = useState<string | null>(null);
  return (
    <Stack gap="xs">
      <Text fw={600} size="sm">
        Section {section.section}
      </Text>
      <SimpleGrid cols={7} spacing="xs">
        {PERIODS.map((period) => {
          const cell = section.cells.find((entry) => entry.period === period);
          return (
            <PeriodBox
              key={period}
              period={period}
              subject={cell?.subject ?? ""}
              staff={cell?.staff ?? ""}
              posted={posted.get(period) === true}
              label={`Period ${period}, Section ${section.section}`}
              onOpen={() => setOpen(period)}
            />
          );
        })}
      </SimpleGrid>
      <SlotDetails
        section={section}
        period={open}
        onClose={() => setOpen(null)}
      />
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
