import {
  Badge,
  Checkbox,
  Divider,
  Group,
  Paper,
  Table,
  Text,
} from "@mantine/core";

import type { RegisterReply, Student } from "../../shared/api";
import { tintFor } from "../cascade";

/**
 * The register itself: the filter, the line naming what is on screen, and the
 * roster.
 *
 * The row tint is Mantine's own `bg` prop reading Mantine's own colour tokens.
 * There is no custom CSS in this project, so `tintFor` returns a token or
 * nothing at all.
 */

type RegisterTableProps = {
  rows: Student[];
  /** How many the server returned, before the irregular-only filter. */
  total: number;
  summary: RegisterReply["summary"];
  onlyIrregular: boolean;
  onToggleIrregular: (value: boolean) => void;
  /** "Course: B.Tech · Section: A" - names the register so a stale read is visible. */
  chosenText: string;
};

export const RegisterTable = ({
  rows,
  total,
  summary,
  onlyIrregular,
  onToggleIrregular,
  chosenText,
}: RegisterTableProps): React.JSX.Element => (
  <Paper withBorder p="lg">
    <Group justify="space-between" mb="sm">
      <Checkbox
        label="Show only irregular students"
        checked={onlyIrregular}
        onChange={(e) => onToggleIrregular(e.currentTarget.checked)}
      />
    </Group>

    {/*
        Name the register on screen. With five dropdowns in front of you it is
        easy to read last week's numbers as this week's.
      */}
    {chosenText && (
      <>
        <Text c="dimmed" size="sm" mb="sm">
          {chosenText}
          {summary.range?.from
            ? `   ·   ${summary.range.from} to ${summary.range.to}`
            : ""}
        </Text>
        <Divider mb="sm" />
      </>
    )}

    {rows.length === 0 ? (
      <Text c="dimmed" size="sm">
        {onlyIrregular
          ? `No irregular students. Everyone is at or above ${summary.irregularBelow}%.`
          : "No students in this register."}
      </Text>
    ) : (
      <>
        <Table.ScrollContainer minWidth={640}>
          <Table striped highlightOnHover withTableBorder tabularNums>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Sl.No</Table.Th>
                <Table.Th>Roll No</Table.Th>
                <Table.Th>Student Name</Table.Th>
                <Table.Th ta="right">Attend / Held</Table.Th>
                <Table.Th ta="right">%</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {rows.map((s) => (
                <Table.Tr key={s.roll} bg={tintFor(s)}>
                  <Table.Td c="dimmed">{s.sl}</Table.Td>
                  <Table.Td>
                    <Text ff="monospace" size="sm">
                      {s.roll}
                    </Text>
                  </Table.Td>
                  <Table.Td>
                    <Text tt="uppercase" size="sm">
                      {s.name}
                    </Text>
                  </Table.Td>
                  <Table.Td ta="right">{s.attendedOfHeld}</Table.Td>
                  <Table.Td ta="right">
                    {s.pct == null ? (
                      "—"
                    ) : (
                      <Group gap={6} justify="flex-end" wrap="nowrap">
                        <Text fw={700} size="sm">
                          {s.pct.toFixed(2)}%
                        </Text>
                        {s.critical && (
                          <Badge color="red" size="xs" variant="light">
                            critical
                          </Badge>
                        )}
                        {!s.critical && s.irregular && (
                          <Badge color="yellow" size="xs" variant="light">
                            low
                          </Badge>
                        )}
                      </Group>
                    )}
                  </Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        </Table.ScrollContainer>
        <Text c="dimmed" size="sm" mt="sm">
          Showing {rows.length} of {total} students, lowest attendance first.
        </Text>
      </>
    )}
  </Paper>
);
