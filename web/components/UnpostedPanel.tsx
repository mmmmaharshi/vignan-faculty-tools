import {
  Alert,
  Loader,
  Paper,
  Stack,
  Table,
  Tabs,
  Text,
  Title,
} from "@mantine/core";

import type { DayWorkSection } from "../../shared/api";
import { PERIOD_COUNT } from "../period-times";
import type { Note } from "../types";

export type UnpostedPanelProps = {
  /** The day asked, dd/mm/yyyy on the campus clock. */
  date?: string | null;
  /** False when the report stated no sections at all — no classes that day,
   *  which is not the same as all posted. */
  reported?: boolean;
  /** Every section's cells in the report's order. Null while unread. */
  sections?: DayWorkSection[] | null;
  busy?: boolean;
  /** A read that failed says so here. A fully posted day is not this — it is
   *  the matrix below with every cell ticked. */
  note?: Note | null;
};
/** One matrix cell: ticked when posted, crossed when not, empty when the
 *  report never listed the period. */
const markOf = (cell: { posted: boolean } | undefined): string => {
  if (!cell) return "—";
  return cell.posted ? "✅" : "❌";
};
/** One branch's matrix: section tabs across the top, one row per semester,
 *  one column per period. A ticked period is posted; a cross is not yet;
 *  empty is a period the report never listed. */
const BranchMatrix = ({
  sections,
}: {
  sections: DayWorkSection[];
}): React.JSX.Element => {
  const names = [...new Set(sections.map((s) => s.section))];
  const semesters = [...new Set(sections.map((s) => s.semester))];
  const at = (semester: string, section: string, period: string) =>
    sections
      .find((s) => s.semester === semester && s.section === section)
      ?.cells.find((c) => c.period === period);
  return (
    <Tabs defaultValue={names[0] ?? ""}>
      <Tabs.List>
        {names.map((name) => (
          <Tabs.Tab key={name} value={name}>
            Sec {name}
          </Tabs.Tab>
        ))}
      </Tabs.List>
      {names.map((name) => (
        <Tabs.Panel key={name} value={name} pt="sm">
          <Table striped highlightOnHover withTableBorder withColumnBorders>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Semester</Table.Th>
                {Array.from({ length: PERIOD_COUNT }, (_, index) => (
                  <Table.Th key={index + 1} ta="center">
                    {index + 1}
                  </Table.Th>
                ))}
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {semesters.map((semester) => (
                <Table.Tr key={semester}>
                  <Table.Td c="dimmed">
                    <Text size="sm">
                      {semester.replace(/\s*Semester\s*/i, "")}
                    </Text>
                  </Table.Td>
                  {Array.from({ length: PERIOD_COUNT }, (_, index) => {
                    const cell = at(semester, name, String(index + 1));
                    return (
                      <Table.Td key={index + 1} ta="center">
                        <Text size="lg">{markOf(cell)}</Text>
                      </Table.Td>
                    );
                  })}
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        </Tabs.Panel>
      ))}
    </Tabs>
  );
};
export const UnpostedPanel = ({
  date,
  reported,
  sections,
  busy,
  note,
}: UnpostedPanelProps): React.JSX.Element => {
  const branches: string[] = [];
  if (sections) {
    for (const section of sections) {
      if (!branches.includes(section.branchShort)) {
        branches.push(section.branchShort);
      }
    }
  }
  const inBranch = (short: string): DayWorkSection[] =>
    sections ? sections.filter((s) => s.branchShort === short) : [];
  return (
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
            Reading the branches from ECAP...
          </Text>
        </Stack>
      ) : null}
      {sections && !reported && !busy ? (
        <Paper withBorder p="lg">
          <Text c="dimmed">No classes{date ? ` on ${date}` : ""}.</Text>
        </Paper>
      ) : null}
      {sections && reported ? (
        <Tabs defaultValue={branches[0] ?? ""}>
          <Tabs.List>
            {branches.map((branch) => (
              <Tabs.Tab key={branch} value={branch}>
                {branch}
              </Tabs.Tab>
            ))}
          </Tabs.List>
          {branches.map((branch) => (
            <Tabs.Panel key={branch} value={branch} pt="sm">
              <BranchMatrix sections={inBranch(branch)} />
            </Tabs.Panel>
          ))}
        </Tabs>
      ) : null}
    </Stack>
  );
};
