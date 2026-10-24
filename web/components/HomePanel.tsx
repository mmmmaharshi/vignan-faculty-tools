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
            <Table.Tr key={`${entry.period}-${entry.subject}-${index}`}>
              <Table.Td>
                <Text fw={700}>{entry.period || "—"}</Text>
                {entry.time ? (
                  <Text c="dimmed" size="sm">
                    {entry.time}
                  </Text>
                ) : null}
              </Table.Td>
              <Table.Td>
                <Text fw={600}>{entry.subject || "—"}</Text>
                {/* The section's own comma separates its pieces, so each
                    rides its own pill rather than one long line. */}
                {entry.section ? (
                  <Group gap={4} mt={4}>
                    {entry.section.split(",").map((piece) => (
                      <Pill key={piece.trim()} size="xs">
                        {piece.trim()}
                      </Pill>
                    ))}
                  </Group>
                ) : null}
              </Table.Td>
            </Table.Tr>
          ))}
        </Table.Tbody>
      </Table>
    ) : null}
  </Stack>
);
