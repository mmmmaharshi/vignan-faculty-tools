import { Alert, Loader, Paper, Stack, Table, Text, Title } from "@mantine/core";

import type { DayWorkRow, DayWorkSection } from "../../shared/api";
import { capitalCase } from "../format";
import type { Note } from "../types";

export type UnpostedPanelProps = {
  /** The day asked, dd/mm/yyyy on the campus clock. */
  date?: string | null;
  /** False when the report stated no sections at all — no classes that day,
   *  which is not the same as all posted. */
  reported?: boolean;
  /** Every section's rows in the report's order. Null while unread. */
  sections?: DayWorkSection[] | null;
  busy?: boolean;
  /** A read that failed says so here. A fully posted day is not this — it is
   *  the tables below with nothing tinted. */
  note?: Note | null;
};
/** A held period with blank counts is not yet posted: every posted period
 *  states both. The tint is the register's critical-row red — it answers
 *  "whose posting is pending" at a glance. */
const isUnposted = (row: DayWorkRow): boolean =>
  row.present === "" && row.absent === "";
const sectionName = (section: DayWorkSection): string =>
  [section.semester.replace(/\s*Semester\s*/i, ""), section.section]
    .filter(Boolean)
    .join(" · ");
export const UnpostedPanel = ({
  date,
  reported,
  sections,
  busy,
  note,
}: UnpostedPanelProps): React.JSX.Element => (
  <Stack gap="md" mt="xl">
    <Title order={4}>Day Class Work{date ? ` · ${date}` : ""}</Title>
    {note ? (
      <Alert color={note.kind === "error" ? "red" : "yellow"}>
        {note.text}
      </Alert>
    ) : null}
    {!sections && busy ? (
      <Stack align="center" mt="xl" gap="sm">
        <Loader size="lg" />
        <Text c="dimmed" size="sm">
          Reading the branch from ECAP...
        </Text>
      </Stack>
    ) : null}
    {sections && !reported && !busy ? (
      <Paper withBorder p="lg">
        <Text c="dimmed">No classes{date ? ` on ${date}` : ""}.</Text>
      </Paper>
    ) : null}
    {sections?.map((section) => (
      <Stack gap="xs" key={`${section.semester}-${section.section}`}>
        <Text c="dimmed" size="xs" tt="uppercase">
          {sectionName(section) || "Section"}
        </Text>
        <Table
          striped
          highlightOnHover
          withTableBorder
          withColumnBorders
          tabularNums
        >
          <Table.Thead>
            <Table.Tr>
              <Table.Th>Period</Table.Th>
              <Table.Th>Subject</Table.Th>
              <Table.Th>Present</Table.Th>
              <Table.Th>Absent</Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {section.rows.map((row, index) => (
              // The report states no identifiers, so the order it gave is key.
              <Table.Tr
                key={`${row.period}-${row.subject}-${index}`}
                bg={
                  isUnposted(row) ? "var(--mantine-color-red-light)" : undefined
                }
              >
                <Table.Td>
                  <Text fw={700}>{row.period || "—"}</Text>
                </Table.Td>
                <Table.Td>
                  {row.subject ? (
                    <Text fw={600}>{capitalCase(row.subject)}</Text>
                  ) : null}
                  {row.staff ? (
                    <Text c="dimmed" size="xs">
                      {row.staff}
                    </Text>
                  ) : null}
                </Table.Td>
                <Table.Td ta="right">
                  <Text size="sm">{row.present || "—"}</Text>
                </Table.Td>
                <Table.Td ta="right">
                  <Text size="sm">{row.absent || "—"}</Text>
                </Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      </Stack>
    ))}
  </Stack>
);
