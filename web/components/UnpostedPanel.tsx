import { Alert, Loader, Paper, Stack, Table, Text, Title } from "@mantine/core";

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
/** One branch's pending postings: each entry names its period, section, and
 *  the staff it waits on. A branch with none reads as one all-posted line. */
const BranchPending = ({
  short,
  sections,
}: {
  short: string;
  sections: DayWorkSection[];
}): React.JSX.Element => {
  const pending = sections.flatMap((section) =>
    section.cells
      .filter((cell) => !cell.posted)
      .map((cell) => ({
        period: cell.period,
        where: sectionShort(section.semester, section.section),
        staff: cell.staff,
      }))
  );
  return (
    <Stack gap="xs">
      <Text fw={600}>{short}</Text>
      {pending.length === 0 ? (
        <Table striped withTableBorder tabularNums>
          <Table.Tbody>
            <Table.Tr>
              <Table.Td>
                <Text c="dimmed" size="sm">
                  All Posted
                </Text>
              </Table.Td>
            </Table.Tr>
          </Table.Tbody>
        </Table>
      ) : (
        <Table striped highlightOnHover withTableBorder withColumnBorders>
          <Table.Thead>
            <Table.Tr>
              <Table.Th>Period</Table.Th>
              <Table.Th>Section</Table.Th>
              <Table.Th>Staff</Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {pending.map((entry) => (
              // The report states no identifiers; period plus section is key.
              <Table.Tr key={`${entry.period}-${entry.where}`}>
                <Table.Td>
                  <Text fw={700}>{entry.period || "—"}</Text>
                </Table.Td>
                <Table.Td>
                  <Text size="sm">{entry.where}</Text>
                </Table.Td>
                <Table.Td>
                  <Text size="sm">{entry.staff || "—"}</Text>
                </Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      )}
    </Stack>
  );
};
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
      {sections && sections.length > 0
        ? branches.map((branch) => (
            <BranchPending
              key={branch}
              short={shortOf(branch)}
              sections={inBranch(branch)}
            />
          ))
        : null}
    </Stack>
  );
};
