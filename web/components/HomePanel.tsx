import {
  Alert,
  Group,
  Loader,
  Paper,
  Pill,
  Stack,
  Table,
  Text,
  Title,
} from "@mantine/core";

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
 *  section from the course line, and a "B.Tech V Semester" course line splits
 *  further into its course and semester. Anything else stays one pill. */
const pillsOf = (section: string): string[] =>
  section
    .split(",")
    .flatMap((piece) => {
      const halves = piece
        .trim()
        .match(/^(?<course>\S+)\s+(?<semester>[IVX]+\s+Semester)$/i)?.groups;
      return halves?.course && halves.semester
        ? [halves.course, halves.semester]
        : [piece.trim()];
    })
    .filter(Boolean);
const ClassCell = ({ entry }: { entry: TodayClass }): React.JSX.Element => {
  const { name, branch } = splitSubject(entry.subject);
  const pills = [...(branch ? [branch] : []), ...pillsOf(entry.section)];
  return (
    <>
      <Text fw={600}>{name || "—"}</Text>
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
export const HomePanel = ({
  classes,
  busy,
  note,
}: HomePanelProps): React.JSX.Element => (
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
    {classes && classes.length === 0 && !busy ? (
      <Paper withBorder p="lg">
        <Text c="dimmed">No periods today.</Text>
      </Paper>
    ) : null}
    {classes && classes.length > 0 ? (
      <Table striped highlightOnHover withTableBorder withColumnBorders>
        <Table.Thead>
          <Table.Tr>
            <Table.Th>Period</Table.Th>
            <Table.Th>Class</Table.Th>
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {classes.map((entry, index) => (
            // The grid states no identifiers, so the order it gave is the key.
            <Table.Tr key={`${entry.period}-${entry.subject}-${index}`}>
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
