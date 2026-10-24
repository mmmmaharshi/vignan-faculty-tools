import { Alert, Loader, Paper, Stack, Table, Text, Title } from "@mantine/core";

import type { UnpostedPeriod } from "../../shared/api";
import { capitalCase } from "../format";
import type { Note } from "../types";

export type UnpostedPanelProps = {
  /** The day asked, dd/mm/yyyy on the campus clock. */
  date?: string | null;
  /** False when the report stated no sections at all — no classes that day,
   *  which is not the same as all posted. */
  reported?: boolean;
  /** Periods with blank attendance counts, in the report's order. Null while
   *  unread. */
  periods?: UnpostedPeriod[] | null;
  busy?: boolean;
  /** A read that failed says so here. An empty list is not this — it is the
   *  all-posted sentence below. */
  note?: Note | null;
};
const whereOf = (entry: UnpostedPeriod): string =>
  [entry.semester.replace(/\s*Semester\s*/i, ""), entry.section]
    .filter(Boolean)
    .join(" · ");
export const UnpostedPanel = ({
  date,
  reported,
  periods,
  busy,
  note,
}: UnpostedPanelProps): React.JSX.Element => (
  <Stack gap="md" mt="xl">
    <Title order={4}>Attendance Not Posted</Title>
    {note ? (
      <Alert color={note.kind === "error" ? "red" : "yellow"}>
        {note.text}
      </Alert>
    ) : null}
    {!periods && busy ? (
      <Stack align="center" mt="xl" gap="sm">
        <Loader size="lg" />
        <Text c="dimmed" size="sm">
          Reading the branch from ECAP...
        </Text>
      </Stack>
    ) : null}
    {periods && !reported && !busy ? (
      <Paper withBorder p="lg">
        <Text c="dimmed">No classes{date ? ` on ${date}` : ""}.</Text>
      </Paper>
    ) : null}
    {periods && reported && periods.length === 0 && !busy ? (
      <Paper withBorder p="lg">
        <Text c="dimmed">All posted{date ? ` for ${date}` : ""}.</Text>
      </Paper>
    ) : null}
    {periods && periods.length > 0 ? (
      <Table striped highlightOnHover withTableBorder withColumnBorders>
        <Table.Thead>
          <Table.Tr>
            <Table.Th>Period</Table.Th>
            <Table.Th>Subject</Table.Th>
            <Table.Th>Staff</Table.Th>
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {periods.map((entry, index) => (
            // The report states no identifiers, so the order it gave is the key.
            <Table.Tr key={`${entry.period}-${entry.subject}-${index}`}>
              <Table.Td>
                <Text fw={700}>{entry.period || "—"}</Text>
                {whereOf(entry) ? (
                  <Text c="dimmed" size="xs">
                    {whereOf(entry)}
                  </Text>
                ) : null}
              </Table.Td>
              <Table.Td>
                {entry.subject ? (
                  <Text fw={600}>{capitalCase(entry.subject)}</Text>
                ) : (
                  <Text c="dimmed" size="sm">
                    —
                  </Text>
                )}
              </Table.Td>
              <Table.Td>
                <Text size="sm">{entry.staff || "—"}</Text>
              </Table.Td>
            </Table.Tr>
          ))}
        </Table.Tbody>
      </Table>
    ) : null}
  </Stack>
);
