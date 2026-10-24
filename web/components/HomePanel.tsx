import { Alert, Loader, Paper, Stack, Table, Text, Title } from "@mantine/core";

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
const classOf = (entry: TodayClass): string =>
  [entry.subject, entry.section].filter(Boolean).join(" · ");
export const HomePanel = ({
  classes,
  busy,
  note,
}: HomePanelProps): React.JSX.Element => (
  <Stack gap="md">
    <Title order={4}>Today</Title>
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
      <Table striped highlightOnHover>
        <Table.Thead>
          <Table.Tr>
            <Table.Th>Period</Table.Th>
            <Table.Th>Class</Table.Th>
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {classes.map((entry, index) => (
            // The grid states no identifiers, so the order it gave is the key.
            <Table.Tr key={`${entry.time}-${entry.subject}-${index}`}>
              <Table.Td>{entry.time || "—"}</Table.Td>
              <Table.Td>{classOf(entry) || "—"}</Table.Td>
            </Table.Tr>
          ))}
        </Table.Tbody>
      </Table>
    ) : null}
  </Stack>
);
