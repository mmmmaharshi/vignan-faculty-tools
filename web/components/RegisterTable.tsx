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
import { tintFor } from "../cascade";
import type { ChosenFact } from "../cascade";

type RegisterTableProps = {
  rows: Student[];
  total: number;
  summary: RegisterReply["summary"];
  onlyIrregular: boolean;
  onToggleIrregular: (value: boolean) => void;
  onShowDetails: (student: Student) => void;
  chosen: ChosenFact[];
  /** The All subjects path: no subject was chosen, so there are no subject columns
   *  and the bands on show — and the row tint — are the overall ones. One prop,
   *  because a subject was either chosen or not; two names for it could disagree. */
  overallMode?: boolean;
};
/** Which figure a percentage is: the subject's own, or the section-wide overall.
 *  The two differ in emphasis — the subject figure reads heavier, and its low
 *  badge is yellow where the overall's is orange — so that pairing lives here,
 *  in one map, instead of as literals at every call site. */
export type FigureKind = "subject" | "overall";
const FIGURE_STYLE = {
  subject: { weight: 700, low: "yellow" },
  overall: { weight: 600, low: "orange" },
} as const;
/** The overall badge is orange where the subject one is yellow, so a row
 *  badged on one and not the other is readable at a glance. Exported because a
 *  student's own panel badges the same two figures and must say the same words. */
export const badgeFor = (
  critical: boolean,
  irregular: boolean,
  kind: FigureKind
): { badge: string; color: string } => {
  if (critical) return { badge: "critical", color: "red" };
  if (irregular) return { badge: "low", color: FIGURE_STYLE[kind].low };
  return { badge: "", color: "red" };
};
type CellProps = {
  pct: number;
  kind: FigureKind;
  critical: boolean;
  irregular: boolean;
};
/** The register's own naming — course through period, one fact per row. Shared
 *  by the card above the register and a student's panel, so the two cannot
 *  disagree about which register is on screen; exported for the same reason as
 *  `badgeFor`. It stays headless on purpose: the specs count register rows as
 *  `thead ~ tbody tr`, and a thead here would join that count. */
export const FactsTable = ({
  facts,
}: {
  facts: ChosenFact[];
}): React.JSX.Element => {
  // Two facts per row, in order: course with semester, branch with section,
  // subject with period. A dangling last fact keeps its row's shape with an
  // empty cell beside it.
  const rows: ChosenFact[][] = [];
  for (const [i, fact] of facts.entries()) {
    if (i % 2 === 0) rows.push([fact]);
    else rows.at(-1)?.push(fact);
  }
  return (
    <Table striped withTableBorder tabularNums>
      <Table.Tbody>
        {rows.map((row) => (
          <Table.Tr key={row.map((fact) => fact.label).join("+")}>
            {row.map((fact) => (
              <Table.Td key={fact.label}>
                <Text size="sm" c="dimmed">
                  {fact.label}
                </Text>
                <Text size="sm" fw={600}>
                  {fact.value}
                </Text>
              </Table.Td>
            ))}
            {row.length === 1 ? <Table.Td key="pad" /> : null}
          </Table.Tr>
        ))}
      </Table.Tbody>
    </Table>
  );
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
  onlyIrregular,
  onToggleIrregular,
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
      <Group justify="space-between" mb="sm">
        <Checkbox
          label="Show only irregular students"
          checked={onlyIrregular}
          onChange={(e) => onToggleIrregular(e.currentTarget.checked)}
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
          {onlyIrregular
            ? `No irregular students. Everyone is at or above ${summary.irregularBelow}%.`
            : "No students in this register."}
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
                    <Table.Th ta="right">Attended / Total</Table.Th>
                  )}
                  {showOverall && (
                    <Table.Th ta="right">Overall Attendance %</Table.Th>
                  )}
                  <Table.Th>Details</Table.Th>
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
                            kind="overall"
                            critical={s.overallCritical}
                            irregular={s.overallIrregular}
                          />
                        )}
                      </Table.Td>
                    )}
                    <Table.Td>
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
            {onlyIrregular
              ? "lowest attendance first."
              : "in the Portal's own order."}{" "}
            A tinted row is a student below {summary.criticalBelow}%.
          </Text>
        </>
      )}
    </Paper>
  );
};
