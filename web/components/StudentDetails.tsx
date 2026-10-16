import {
  Badge,
  Divider,
  Drawer,
  Group,
  Stack,
  Text,
  Title,
} from "@mantine/core";

import {
  CRITICAL_BELOW,
  IRREGULAR_BELOW,
  overallCellForDisplay,
} from "../../attendance-bands";
import type { Student } from "../../shared/api";
import { badgeFor } from "./RegisterTable";

type StudentDetailsProps = {
  /** The student whose row was opened, or null when nothing is open. */
  student: Student | null;
  onClose: () => void;
  /** The register this student was read from, with the period it was read over:
   *  a percentage means nothing without the two, and the table says the same
   *  sentence above itself. */
  chosenText: string;
};
type FigureProps = {
  label: string;
  cell: string;
  pct: number | null;
  badge: string;
  color: string;
};
const Figure = ({
  label,
  cell,
  pct,
  badge,
  color,
}: FigureProps): React.JSX.Element => (
  <>
    <Text c="dimmed" size="xs" tt="uppercase">
      {label}
    </Text>
    <Group gap="xs">
      <Text fw={600}>{cell}</Text>
      <Text fw={700}>{pct == null ? "—" : `${pct.toFixed(2)}%`}</Text>
      {badge && (
        <Badge color={color} size="sm" variant="light">
          {badge}
        </Badge>
      )}
    </Group>
  </>
);
/**
 * One student, as the register holds them. Nothing is fetched: the panel repeats
 * the row that was clicked, with the band each figure sits in spelled out.
 */
export const StudentDetails = ({
  student,
  onClose,
  chosenText,
}: StudentDetailsProps): React.JSX.Element => (
  <Drawer
    opened={student !== null}
    onClose={onClose}
    position="right"
    size="md"
    title="Student details"
    closeButtonProps={{ "aria-label": "Close student details" }}
  >
    {student ? (
      <Stack gap="sm">
        <div>
          <Title order={4} tt="uppercase">
            {student.name}
          </Title>
          <Group gap="xs">
            <Text ff="monospace" size="sm">
              Roll No {student.roll}
            </Text>
            <Text c="dimmed" size="sm">
              Sl.No {student.sl}
            </Text>
          </Group>
        </div>
        <Divider />
        {/* A figure the Portal did not give is an absence, not a zero, so its
            line is left out rather than printed as a dash — the rule the table
            already follows for a class report that failed. */}
        {student.pct != null || student.attendedOfHeld !== "" ? (
          <Figure
            label="Subject attendance"
            cell={student.attendedOfHeld}
            pct={student.pct}
            {...badgeFor(student.critical, student.irregular, "yellow")}
          />
        ) : null}
        {student.overallPct != null || student.overallAttendedOfHeld !== "" ? (
          <Figure
            label="Overall attendance"
            cell={overallCellForDisplay(student.overallAttendedOfHeld)}
            pct={student.overallPct}
            {...badgeFor(
              student.overallCritical,
              student.overallIrregular,
              "orange"
            )}
          />
        ) : null}
        {/* Both figures are badged here where the table badges the subject alone:
            two badges on one table row is noise, but two labelled lines are how
            the reader sees which band each figure sits in. */}
        <Text c="dimmed" size="xs">
          {`Regular at or above ${IRREGULAR_BELOW}%; critical below ${CRITICAL_BELOW}%.`}
        </Text>
        {chosenText ? (
          <>
            <Divider />
            <Text c="dimmed" size="sm">
              {chosenText}
            </Text>
          </>
        ) : null}
      </Stack>
    ) : null}
  </Drawer>
);
