import { Alert, Badge, Group, Table, Text } from "@mantine/core";
import React from "react";

import type { RegisterReply } from "../../shared/api";

/** One subject's four figures, or nulls while that subject has not answered. */
export interface SectionRow {
  value: string;
  label: string;
  summary: RegisterReply["summary"] | null;
}

const DASH = "—";
/** A count of students, badged only when there is someone to point at. */
const Band = ({ count }: { count: number }): React.JSX.Element =>
  count > 0 ? (
    <Badge color="red" variant="light">
      {count}
    </Badge>
  ) : (
    <Text c="dimmed" size="sm">
      0
    </Text>
  );
/**
 * The saved section's subjects, side by side. Every figure here is one the Portal
 * already stated in a register's own summary: the app adds no arithmetic, and in
 * particular never averages these rows into a figure for the section — a large
 * theory and a small lab would weight it into a number belonging to no student.
 *
 * The threshold column headings are read from the summary rather than written
 * here, so a band that moves moves the label with it. A subject whose figures
 * have not arrived shows a dash, never the last visit's numbers.
 */
export const SectionSummary = ({
  rows,
  name,
  range,
}: {
  rows: readonly SectionRow[];
  name: string;
  range: string;
}): React.JSX.Element => {
  const first = rows.find((r) => r.summary);
  const irregularBelow = first?.summary?.irregularBelow;
  const criticalBelow = first?.summary?.criticalBelow;
  return (
    <>
      <Text size="sm" c="dimmed">
        {name}
        {range ? `   ·   ${range}` : ""}
      </Text>
      {rows.length === 0 ? (
        <Alert mt="sm" color="yellow" variant="light">
          This section has no subjects to show.
        </Alert>
      ) : (
        <Table.ScrollContainer minWidth={620}>
          <Table striped highlightOnHover withTableBorder tabularNums mt="sm">
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Subject</Table.Th>
                <Table.Th ta="right">Students</Table.Th>
                <Table.Th ta="right">Class average</Table.Th>
                <Table.Th ta="right">
                  {irregularBelow == null
                    ? "Below threshold"
                    : `Below ${irregularBelow}%`}
                </Table.Th>
                <Table.Th ta="right">
                  {criticalBelow == null
                    ? "Below threshold"
                    : `Below ${criticalBelow}%`}
                </Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {rows.map((row) => {
                const s = row.summary;
                return (
                  <Table.Tr key={row.value}>
                    <Table.Td>
                      <Text size="sm">{row.label}</Text>
                    </Table.Td>
                    <Table.Td ta="right">{s ? s.total : DASH}</Table.Td>
                    <Table.Td ta="right">
                      {s?.average == null ? DASH : `${s.average}%`}
                    </Table.Td>
                    <Table.Td ta="right">
                      {s ? <Band count={s.irregular} /> : DASH}
                    </Table.Td>
                    <Table.Td ta="right">
                      {s ? <Band count={s.critical} /> : DASH}
                    </Table.Td>
                  </Table.Tr>
                );
              })}
            </Table.Tbody>
          </Table>
        </Table.ScrollContainer>
      )}
      <Group gap="xs" mt="sm">
        <Text size="xs" c="dimmed">
          All rows share one date range, so they are comparable with each other.
          The figures are the Portal&apos;s own.
        </Text>
      </Group>
    </>
  );
};
