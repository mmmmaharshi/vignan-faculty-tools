import {
  Badge,
  Button,
  Checkbox,
  Divider,
  Group,
  Paper,
  Table,
  Text,
} from "@mantine/core";

import { overallCellForDisplay } from "../../attendance-bands";
import type { RegisterReply, Student } from "../../shared/api";
import type { ChosenFact } from "../cascade";
import {
  badgeFor,
  FIGURE_STYLE,
  tintFor,
  emptyRegisterText,
  isFiltering,
} from "../worklist";
import type { FigureKind, RowFilter } from "../worklist";
import { FactsTable } from "./FactsTable";

type RegisterTableProps = {
  rows: Student[];
  total: number;
  summary: RegisterReply["summary"];
  filter: RowFilter;
  onToggleFilter: (key: keyof RowFilter, value: boolean) => void;
  onShowDetails: (student: Student) => void;
  chosen: ChosenFact[];
  /** The All subjects path: no subject was chosen, so there are no subject columns
   *  and the bands on show — and the row tint — are the overall ones. One prop,
   *  because a subject was either chosen or not; two names for it could disagree. */
  overallMode?: boolean;
};
type CellProps = {
  pct: number;
  kind: FigureKind;
  critical: boolean;
  irregular: boolean;
};
/** One badged percentage in the register's dense table: the figure reads its own
 *  weight and badge from its kind, so call sites name the figure, not the
 *  styling. The panel's rows are their own component — roomier type and a
 *  leading cell — and stay that way on purpose; unifying the two would trade
 *  that difference for a prop. */
const Figure = ({
  pct,
  kind,
  critical,
  irregular,
}: CellProps): React.JSX.Element => {
  const { badge, color } = badgeFor(critical, irregular, kind);
  return (
    <Group gap={6} justify="flex-end" wrap="nowrap">
      <Text fw={FIGURE_STYLE[kind].weight} size="sm">
        {pct.toFixed(2)}%
      </Text>
      {badge && (
        <Badge color={color} size="xs" variant="light">
          {badge}
        </Badge>
      )}
    </Group>
  );
};
export const RegisterTable = ({
  rows,
  total,
  summary,
  filter,
  onToggleFilter,
  onShowDetails,
  chosen,
  overallMode = false,
}: RegisterTableProps): React.JSX.Element => {
  // A subject register shows its own figures alone: the overall column belongs
  // to the all-subjects view, so a class report that failed changes nothing
  // visible here. On the all-subjects path the column shows whenever any row
  // carries an overall — a report that failed leaves every figure absent, and
  // showing a column of dashes would read as "nobody has an overall".
  const showOverall =
    overallMode &&
    rows.some((s) => s.overallPct != null || s.overallAttendedOfHeld !== "");
  return (
    <Paper withBorder p="lg">
      <Group gap="md" mb="sm">
        <Checkbox
          label="All irregular students"
          checked={filter.irregular}
          onChange={(e) => onToggleFilter("irregular", e.currentTarget.checked)}
        />
        <Checkbox
          label="Below 75%"
          checked={filter.below75}
          onChange={(e) => onToggleFilter("below75", e.currentTarget.checked)}
        />
        <Checkbox
          label="Below 65%"
          checked={filter.below65}
          onChange={(e) => onToggleFilter("below65", e.currentTarget.checked)}
        />
      </Group>
      {chosen.length ? (
        <>
          <FactsTable facts={chosen} />
          <Divider my="sm" />
        </>
      ) : null}
      {rows.length === 0 ? (
        <Text c="dimmed" size="sm">
          {emptyRegisterText(filter, summary.irregularBelow)}
        </Text>
      ) : (
        <>
          <Table.ScrollContainer minWidth={980}>
            <Table striped highlightOnHover withTableBorder tabularNums>
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>Sl.No</Table.Th>
                  <Table.Th>Roll No</Table.Th>
                  <Table.Th>Student Name</Table.Th>
                  {!overallMode && (
                    <Table.Th ta="right">Attend / Held</Table.Th>
                  )}
                  {!overallMode && (
                    <Table.Th ta="right">Subject Attendance %</Table.Th>
                  )}
                  {overallMode && (
                    <Table.Th ta="center">Attended / Total</Table.Th>
                  )}
                  {showOverall && (
                    <Table.Th ta="right">Overall Attendance %</Table.Th>
                  )}
                  <Table.Th ta="center">Details</Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {rows.map((s) => (
                  <Table.Tr key={s.roll} bg={tintFor(s, overallMode)}>
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
                    {!overallMode && (
                      <Table.Td ta="right">{s.attendedOfHeld}</Table.Td>
                    )}
                    {!overallMode && (
                      <Table.Td ta="right">
                        {s.pct == null ? (
                          "—"
                        ) : (
                          <Figure
                            pct={s.pct}
                            kind="subject"
                            critical={s.critical}
                            irregular={s.irregular}
                          />
                        )}
                      </Table.Td>
                    )}
                    {overallMode && (
                      <Table.Td ta="center">
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
                            kind="overall"
                            critical={s.overallCritical}
                            irregular={s.overallIrregular}
                          />
                        )}
                      </Table.Td>
                    )}
                    <Table.Td ta="center">
                      <Button
                        variant="subtle"
                        size="compact-xs"
                        aria-label={`Show details for ${s.name}`}
                        onClick={() => onShowDetails(s)}
                      >
                        Show Details
                      </Button>
                    </Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          </Table.ScrollContainer>
          <Text c="dimmed" size="sm" mt="sm">
            Showing {rows.length} of {total} students,{" "}
            {isFiltering(filter)
              ? "lowest attendance first."
              : "in the Portal's own order."}{" "}
            A tinted row is a student below {summary.criticalBelow}%.
          </Text>
        </>
      )}
    </Paper>
  );
};
