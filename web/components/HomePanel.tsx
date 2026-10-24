import {
  Alert,
  Group,
  Loader,
  Pill,
  Stack,
  Table,
  Text,
  Title,
} from "@mantine/core";
import React, { useEffect, useState } from "react";

import type { TodayClass } from "../../shared/api";
import type { Note } from "../types";

export type HomePanelProps = {
  /** Today's periods in the grid's own order. Null while unread. */
  classes?: TodayClass[] | null;
  busy?: boolean;
  /** A read that failed says so here. An empty day is not this — it is the
   *  sentence below, because ECAP clears the day after ~4pm. */
  note?: Note | null;
};
/** "08:45 AM- 09:35 PM" as minutes since midnight, or null when the grid
 *  wrote something else. Twelve-hour clock, as ECAP writes it. */
const TIME_RANGE =
  /(?<from>\d{1,2}:\d{2}\s*[AP]M)\s*-\s*(?<to>\d{1,2}:\d{2}\s*[AP]M)/i;
const toMinutes = (clock: string): number | null => {
  const parts = clock
    .trim()
    .match(/^(?<hour>\d{1,2}):(?<minute>\d{2})\s*(?<half>[AP])M$/i)?.groups;
  if (!parts?.hour || !parts.minute || !parts.half) return null;
  const hour =
    (Number(parts.hour) % 12) + (parts.half.toUpperCase() === "P" ? 12 : 0);
  return hour * 60 + Number(parts.minute);
};
/** Whether the faculty member is inside this period right now, by the
 *  browser's own clock — ECAP and the faculty share the campus day. */
const isLive = (time: string, now: Date): boolean => {
  const range = time.match(TIME_RANGE)?.groups;
  const from = range?.from ? toMinutes(range.from) : null;
  const to = range?.to ? toMinutes(range.to) : null;
  if (from === null || to === null) return false;
  const at = now.getHours() * 60 + now.getMinutes();
  return from <= at && at < to;
};
/** The subject's trailing branch ("FLUTER LAB (CSE (AI))" → "FLUTER LAB" plus
 *  "(CSE (AI))"), so the branch rides a pill with the rest. A subject with no
 *  trailing parens keeps its single line. */
/** "(CSE (AI))" rides the pill as "CSE(AI)": outer parens off, spaces out. */
const compactBranch = (branch: string): string =>
  branch.replace(/^\((?<inner>.*)\)$/, "$<inner>").replaceAll(/\s+/g, "");
const splitSubject = (subject: string): { name: string; branch: string } => {
  const parts = subject.match(/^(?<name>.*?)\s*(?<branch>\(.*\))$/)?.groups;
  return parts?.name && parts.branch
    ? { name: parts.name, branch: compactBranch(parts.branch) }
    : { name: subject, branch: "" };
};
/** The section's pieces, each riding its own pill: the comma separates the
 *  section from the course line, a "B.Tech V Semester" course line splits
 *  into its course and a short "V Sem", and anything else stays one pill. */
const pillsOf = (section: string): string[] =>
  section
    .split(",")
    .flatMap((piece) => {
      const words = piece.trim();
      const full = words.match(
        /^(?<course>\S+)\s+(?<numeral>[IVX]+)\s+Semester$/i
      )?.groups;
      if (full?.course && full.numeral) {
        return [full.course, `${full.numeral} Sem`];
      }
      const bare = words.match(/^(?<numeral>[IVX]+)\s+Semester$/i)?.groups;
      if (bare?.numeral) return [`${bare.numeral} Sem`];
      return [words];
    })
    .filter(Boolean);
/** "FLUTER LAB" reads "Fluter Lab": ECAP shouts its subject names, and the
 *  Class column should not. Words of two letters or fewer stay as written, so
 *  an acronym like "AI" does not come out "Ai". */
const capitalCase = (text: string): string =>
  text
    .split(" ")
    .map((word) =>
      word.length <= 2
        ? word
        : word.toLowerCase().replace(/^\S/, (first) => first.toUpperCase())
    )
    .join(" ");
const ClassCell = ({ entry }: { entry: TodayClass }): React.JSX.Element => {
  const { name, branch } = splitSubject(entry.subject);
  const pills = [...(branch ? [branch] : []), ...pillsOf(entry.section)];
  return (
    <>
      {name ? <Text fw={600}>{capitalCase(name)}</Text> : null}
      {/* The branch and the section's own pieces ride pills rather than one
          long line. */}
      {pills.length ? (
        <Group gap={4} mt={4}>
          {pills.map((pill) => (
            <Pill key={pill} size="xs">
              {pill}
            </Pill>
          ))}
        </Group>
      ) : null}
    </>
  );
};
/** An empty day still shows the usual table: seven periods, blank classes.
 *  ECAP clears the day rather than naming it, so the skeleton is fixed. */
const EMPTY_DAY: TodayClass[] = Array.from({ length: 7 }, (_, index) => ({
  period: `Period ${index + 1}`,
  time: "",
  subject: "",
  section: "",
  room: "",
}));
export const HomePanel = ({
  classes,
  busy,
  note,
}: HomePanelProps): React.JSX.Element => {
  // The highlight must flip when a period starts or ends mid-visit, so the
  // clock ticks rather than being read once on mount.
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const tick = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(tick);
  }, []);
  return (
    <Stack gap="md">
      <Title order={4}>Today&apos;s Classes</Title>
      {note ? (
        <Alert color={note.kind === "error" ? "red" : "yellow"}>
          {note.text}
        </Alert>
      ) : null}
      {!classes && busy ? (
        <Stack align="center" mt="xl" gap="sm">
          <Loader size="lg" />
          <Text c="dimmed" size="sm">
            Reading today from ECAP...
          </Text>
        </Stack>
      ) : null}
      {classes && !busy ? (
        <Table striped highlightOnHover withTableBorder withColumnBorders>
          <Table.Thead>
            <Table.Tr>
              <Table.Th>Period</Table.Th>
              <Table.Th>Class</Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {(classes.length ? classes : EMPTY_DAY).map((entry, index) => (
              // The grid states no identifiers, so the order it gave is the key.
              // The live period carries the register's critical-row tint in
              // blue: it answers "where am I supposed to be" at a glance.
              <Table.Tr
                key={`${entry.period}-${entry.subject}-${index}`}
                bg={
                  isLive(entry.time, now)
                    ? "var(--mantine-color-blue-light)"
                    : undefined
                }
              >
                <Table.Td>
                  <Text fw={700}>{entry.period || "—"}</Text>
                  {entry.time ? (
                    <Text c="dimmed" size="xs">
                      {entry.time}
                    </Text>
                  ) : null}
                </Table.Td>
                <Table.Td>
                  <ClassCell entry={entry} />
                </Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      ) : null}
    </Stack>
  );
};
