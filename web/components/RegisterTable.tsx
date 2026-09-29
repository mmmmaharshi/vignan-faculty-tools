import {
  Badge,
  Checkbox,
  Divider,
  Group,
  Paper,
  Table,
  Text,
} from "@mantine/core";

import { overallCellForDisplay } from "../../attendance-bands";
import type { RegisterReply, Student } from "../../shared/api";
import { tintFor } from "../cascade";

type RegisterTableProps = {
  rows: Student[];
  total: number;
  summary: RegisterReply["summary"];
  onlyIrregular: boolean;
  onToggleIrregular: (value: boolean) => void;
  chosenText: string;
  /** True when no subject was chosen, so there are no subject columns to show. */
  overallOnly?: boolean;
};
/** The overall badge is orange where the subject one is yellow, so a row
 *  badged on one and not the other is readable at a glance. */
const badgeFor = (
  critical: boolean,
  irregular: boolean,
  low: string
): { badge: string; color: string } => {
  if (critical) return { badge: "critical", color: "red" };
  if (irregular) return { badge: "low", color: low };
  return { badge: "", color: "red" };
};
type CellProps = { pct: number; weight: number; badge: string; color: string };
const Figure = ({
  pct,
  weight,
  badge,
  color,
}: CellProps): React.JSX.Element => (
  <Group gap={6} justify="flex-end" wrap="nowrap">
    <Text fw={weight} size="sm">
      {pct.toFixed(2)}%
    </Text>
    {badge && (
      <Badge color={color} size="xs" variant="light">
        {badge}
      </Badge>
    )}
  </Group>
);
export const RegisterTable = ({
  rows,
  total,
  summary,
  onlyIrregular,
  onToggleIrregular,
  chosenText,
  overallOnly = false,
}: RegisterTableProps): React.JSX.Element => {
  // A class report that failed leaves every figure absent; showing two columns
  // of dashes would read as "nobody has an overall", which is a different lie.
  const showOverall =
    overallOnly ||
    rows.some((s) => s.overallPct != null || s.overallAttendedOfHeld !== "");
  return (
    <Paper withBorder p="lg">
      <Group justify="space-between" mb="sm">
        <Checkbox
          label="Show only irregular students"
          checked={onlyIrregular}
          onChange={(e) => onToggleIrregular(e.currentTarget.checked)}
        />
      </Group>
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
                  {!overallOnly && (
                    <Table.Th ta="right">Attend / Held</Table.Th>
                  )}
                  {!overallOnly && <Table.Th ta="right">Subject %</Table.Th>}
                  {overallOnly && (
                    <Table.Th ta="right">Attended / All Classes</Table.Th>
                  )}
                  {showOverall && <Table.Th ta="right">Overall %</Table.Th>}
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
                    {!overallOnly && (
                      <Table.Td ta="right">{s.attendedOfHeld}</Table.Td>
                    )}
                    {!overallOnly && (
                      <Table.Td ta="right">
                        {s.pct == null ? (
                          "—"
                        ) : (
                          <Figure
                            pct={s.pct}
                            weight={700}
                            {...badgeFor(s.critical, s.irregular, "yellow")}
                          />
                        )}
                      </Table.Td>
                    )}
                    {overallOnly && (
                      <Table.Td ta="right">
                        {overallCellForDisplay(s.overallAttendedOfHeld) || "—"}
                      </Table.Td>
                    )}
                    {showOverall && (
                      <Table.Td ta="right">
                        {s.overallPct == null ? (
                          <Text c="dimmed" size="sm">
                            —
                          </Text>
                        ) : (
                          // Beside a subject the only badge is the subject's:
                          // two badged figures on one row is noise, and the
                          // irregular filter reads the subject band alone.
                          <Figure
                            pct={s.overallPct}
                            weight={600}
                            {...(overallOnly
                              ? badgeFor(
                                  s.overallCritical,
                                  s.overallIrregular,
                                  "orange"
                                )
                              : { badge: "", color: "red" })}
                          />
                        )}
                      </Table.Td>
                    )}
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
};
