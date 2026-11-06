import {
  Badge,
  Button,
  Checkbox,
  Divider,
  Group,
  Paper,
  Table,
  Text,
  TextInput,
  UnstyledButton,
} from "@mantine/core";
import { MagnifyingGlass } from "@phosphor-icons/react";

import { overallCellForDisplay } from "../../shared/api";
import type { RegisterReply, Student } from "../../shared/api";
import type { ChosenFact } from "../register/cascade";
import {
  BARS,
  badgeFor,
  carriesOverall,
  cycleSubjectBar,
  displayName,
  FIGURE_STYLE,
  tintFor,
  emptyRegisterText,
  isFiltering,
} from "../register/worklist";
import type { FigureKind, RowFilter, BarCounts } from "../register/worklist";
import { FactsTable } from "./FactsTable";

type RegisterTableProps = {
  rows: Student[];
  total: number;
  summary: RegisterReply["summary"];
  filter: RowFilter;
  /** How many rows each ticked bar alone would keep, under the current
   *  search: shown beside its checkbox so the reader sees what a tick is
   *  worth before ticking it. Null before any register loads, when there
   *  is nothing to count yet. */
  counts: BarCounts | null;
  /** The whole filter the table should now show. A checkbox sends the filter
   *  with its own key flipped, a subject header the same with the next step of
   *  its own cycle — so no control has to know the patch shape. */
  onFilterChange: (next: RowFilter) => void;
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
    <Group gap={6} justify="center" wrap="nowrap">
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
/** One header label that never wraps onto a second line: the table scrolls
 *  horizontally instead, so a long code like "WT TEST" stays readable
 *  whole. Mantine-only — truncate carries the no-wrap. */
const Head = ({ label }: { label: string }): React.JSX.Element => (
  <Text span truncate inherit>
    {label}
  </Text>
);
export const RegisterTable = ({
  rows,
  total,
  summary,
  filter,
  counts,
  onFilterChange,
  onShowDetails,
  chosen,
  overallMode = false,
}: RegisterTableProps): React.JSX.Element => {
  // Both figures ride the table: the subject register shows its own columns
  // and the overall column beside them, so a row's triage figure and its
  // semester figure explain each other. The overall reads beside the name
  // rather than after every subject column, because it is the triage number.
  // The column shows whenever any row carries an overall — a report that failed
  // leaves every figure absent, and showing a column of dashes would read as
  // "nobody has an overall". The worklist still judges the subject figure alone
  // (see `worklist.ts`): the overall is a second fact on the row, never the
  // bar that admits it.
  const showOverall = rows.some(carriesOverall);
  // The section-wide view states one attended count per subject the Portal
  // offered, in the summary's column order: stated, never recomputed, so no
  // badges and no band reads them — the overall figures stay the only ones
  // judged. A report that states no subjects states no columns.
  const subjectColumns = overallMode ? summary.subjectColumns : [];
  return (
    <Paper withBorder p="lg">
      <Group gap="md" mb="sm">
        <Group gap="md">
          <Checkbox
            label={`All irregular students${counts ? ` (${counts.irregular})` : ""}`}
            checked={filter.irregular}
            onChange={(e) =>
              onFilterChange({ ...filter, irregular: e.currentTarget.checked })
            }
          />
          {/* One map over the bars, so a new threshold is a line in `BARS` and
              nothing here. */}
          {BARS.map(({ key, below }) => (
            <Checkbox
              key={key}
              label={`Below ${below}%${counts ? ` (${counts[key]})` : ""}`}
              checked={filter[key]}
              onChange={(e) =>
                onFilterChange({ ...filter, [key]: e.currentTarget.checked })
              }
            />
          ))}
        </Group>
        {/* Full width on a phone, a fixed box pulled to the right edge on wider
            screens: the flex basis drops it onto its own line below the boxes,
            and the auto margin is what still holds it right when it does. */}
        <TextInput
          aria-label="Search students by name or roll number"
          placeholder="Name or roll no."
          leftSection={<MagnifyingGlass size={16} aria-hidden />}
          value={filter.search}
          onChange={(e) =>
            onFilterChange({ ...filter, search: e.currentTarget.value })
          }
          flex={{ base: "1 1 100%", sm: "0 1 280px" }}
          ms="auto"
        />
      </Group>
      {chosen.length ? (
        <>
          <FactsTable facts={chosen} />
          <Divider my="sm" />
        </>
      ) : null}
      {rows.length === 0 ? (
        <>
          <Text c="dimmed" size="sm">
            {emptyRegisterText(filter, summary.irregularBelow)}
          </Text>
          {overallMode && filter.subjectBars.length > 0 && (
            <Button
              variant="subtle"
              size="compact-sm"
              mt="sm"
              onClick={() => onFilterChange({ ...filter, subjectBars: [] })}
            >
              Clear subject filters
            </Button>
          )}
        </>
      ) : (
        <>
          <Table.ScrollContainer minWidth={980}>
            <Table
              striped
              highlightOnHover
              withTableBorder
              withColumnBorders
              tabularNums
            >
              <Table.Thead>
                <Table.Tr>
                  <Table.Th ta="center">
                    <Head label="Sl.No" />
                  </Table.Th>
                  {/* The roll column sticks to the scroll edge while the subject
                      columns scroll away beneath it: positioned beats static,
                      so no z-index prop is needed. The stuck cells are opaque
                      in the row's own colour — the tint where one is set, else
                      the table's own odd-row stripe — or the sliding Sl.No
                      ghosts through the text. The header names its white
                      explicitly, because the head row carries no stripe. */}
                  <Table.Th pos="sticky" left={0} bg="white">
                    <Head label="Roll No" />
                  </Table.Th>
                  <Table.Th>
                    <Head label="Student Name" />
                  </Table.Th>
                  {showOverall && (
                    <Table.Th ta="center" bg="blue.0">
                      <Head label="Overall Attendance %" />
                    </Table.Th>
                  )}
                  {subjectColumns.map((code, i) => {
                    const bar = filter.subjectBars.find(
                      (b) => b.code === code
                    )?.below;
                    // The header is the bar's whole UI: one click ticks below
                    // 75, the next tightens to 65, the next clears it. The
                    // threshold rides in the label, so the name announces the
                    // state it will leave behind on the next click.
                    return (
                      <Table.Th key={`${code}-${i}`} ta="center">
                        <UnstyledButton
                          onClick={() =>
                            onFilterChange({
                              ...filter,
                              subjectBars: cycleSubjectBar(
                                filter.subjectBars,
                                code
                              ),
                            })
                          }
                        >
                          <Head
                            label={bar == null ? code : `${code} <${bar}%`}
                          />
                        </UnstyledButton>
                      </Table.Th>
                    );
                  })}
                  {!overallMode && (
                    <Table.Th ta="center">
                      <Head label="Attend / Held" />
                    </Table.Th>
                  )}
                  {!overallMode && (
                    <Table.Th ta="center">
                      <Head label="Subject Attendance %" />
                    </Table.Th>
                  )}
                  {overallMode && (
                    <Table.Th ta="center" bg="blue.0">
                      <Head label="Attended / Total" />
                    </Table.Th>
                  )}
                  <Table.Th ta="center">
                    <Head label="Details" />
                  </Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {rows.map((s, rowIndex) => (
                  <Table.Tr key={s.roll} bg={tintFor(s, overallMode)}>
                    <Table.Td c="dimmed" ta="center">
                      {s.sl}
                    </Table.Td>
                    <Table.Td
                      pos="sticky"
                      left={0}
                      bg={
                        tintFor(s, overallMode) ??
                        (rowIndex % 2 === 0 ? "gray.0" : "white")
                      }
                    >
                      <Text ff="monospace" size="sm">
                        {s.roll}
                      </Text>
                    </Table.Td>
                    <Table.Td>
                      <Text size="sm">{displayName(s.name)}</Text>
                    </Table.Td>
                    {showOverall && (
                      <Table.Td ta="center" bg="blue.0">
                        {s.overallPct == null ? (
                          <Text c="dimmed" size="sm">
                            —
                          </Text>
                        ) : (
                          // Each figure badges its own band: the subject cell its
                          // subject band below, this one the overall band —
                          // and the irregular filter reads the path's own band.
                          <Figure
                            pct={s.overallPct}
                            kind="overall"
                            critical={s.overallCritical}
                            irregular={s.overallIrregular}
                          />
                        )}
                      </Table.Td>
                    )}
                    {subjectColumns.map((code, i) => (
                      <Table.Td key={`${code}-${i}`} ta="center">
                        {s.subjects[i] == null ? (
                          <Text c="dimmed" size="sm">
                            —
                          </Text>
                        ) : (
                          `${s.subjects[i].toFixed(2)}%`
                        )}
                      </Table.Td>
                    ))}
                    {!overallMode && (
                      <Table.Td ta="center">{s.attendedOfHeld}</Table.Td>
                    )}
                    {!overallMode && (
                      <Table.Td ta="center">
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
                      <Table.Td ta="center" bg="blue.0">
                        {overallCellForDisplay(s.overallAttendedOfHeld) || "—"}
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
