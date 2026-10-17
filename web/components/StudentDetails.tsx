import {
  Alert,
  Badge,
  Box,
  Divider,
  Drawer,
  Group,
  Loader,
  Stack,
  Table,
  Text,
  Title,
} from "@mantine/core";

import { CRITICAL_BELOW, IRREGULAR_BELOW } from "../../attendance-bands";
import type { Student, StudentProfile } from "../../shared/api";
import type { ChosenFact } from "../cascade";
import type { Note } from "../types";
import { badgeFor } from "../worklist";
import { FactsTable } from "./FactsTable";

type StudentDetailsProps = {
  /** The student whose row was opened, or null when nothing is open. */
  student: Student | null;
  /** Whether the drawer is showing. Separate from `student` so the panel keeps
   *  its content through the ~200ms slide-out: on `opened` going false the
   *  drawer still has a student to draw, and an empty one sliding away was the
   *  bug. `student` is cleared on the way out — see `onExitTransitionEnd`. */
  opened: boolean;
  onClose: () => void;
  /** Called once the slide-out has finished, which is when the panel's student
   *  may be dropped. Clearing it at the click instead empties the drawer first. */
  onExitTransitionEnd: () => void;
  /** The All subjects path: the panel shows the overall figure, while a subject
   *  register shows its own alone. Shared with the table — one prop, because a
   *  subject was either chosen or not. */
  overallMode?: boolean;
  /** The register this student was read from, with the period it was read over:
   *  a percentage means nothing without the two, and the table says the same
   *  facts above itself. One fact per row, in the order the line names them. */
  chosen: ChosenFact[];
  /** The student's GPA and phone numbers, which the register does not state and
   *  ECAP answers for one roll number at a time. Read when the panel opens, so
   *  the attendance figures are on screen while this is still arriving. */
  profile: StudentProfile | null;
  busy: boolean;
  note: Note | null;
};
type FigureProps = {
  label: string;
  cell: string;
  pct: number | null;
  badge: string;
  color: string;
};
/** The absent dates, five to a row, so a long list stays readably wide. */
const chunked = (dates: readonly string[]): string[][] =>
  Array.from({ length: Math.ceil(dates.length / 5) }, (_, i) =>
    dates.slice(i * 5, i * 5 + 5)
  );
const FigureRow = ({
  label,
  cell,
  pct,
  badge,
  color,
}: FigureProps): React.JSX.Element => (
  <Table.Tr>
    <Table.Td c="dimmed">
      <Text size="sm">{label}</Text>
    </Table.Td>
    <Table.Td ta="right">
      <Group gap={6} justify="flex-end" wrap="nowrap">
        <Text size="sm" fw={600}>
          {cell}
        </Text>
        <Text size="sm" fw={700}>
          {pct == null ? "—" : `${pct.toFixed(2)}%`}
        </Text>
        {badge && (
          <Badge color={color} size="sm" variant="light">
            {badge}
          </Badge>
        )}
      </Group>
    </Table.Td>
  </Table.Tr>
);
/**
 * One student: the register row that was clicked, with the band each figure it
 * shows sits in spelled out, then the GPA and phone numbers ECAP holds for
 * them. The row itself is not fetched — it is repeated from the table — and the
 * profile is, once, when the panel opens.
 */
export const StudentDetails = ({
  student,
  opened,
  onClose,
  onExitTransitionEnd,
  overallMode = false,
  chosen,
  profile,
  busy,
  note,
}: StudentDetailsProps): React.JSX.Element => {
  const phones = profile?.phones ?? [];
  const cgpa = profile?.cgpa ?? "";
  const credits = profile?.credits ?? "";
  const cgpaPercent = profile?.cgpaPercent ?? "";
  const sgpa = profile?.sgpa ?? [];
  const cgpaShown = Boolean(cgpa || credits);
  const hasGpa = cgpaShown || sgpa.length > 0;
  /* Where the dates come from: the register row's own cells where it has them
     (a subject register), and otherwise the Student Wise report the panel asks
     for by this student's roll number — the All subjects report states none. */
  const absences = student?.absent.length
    ? student.absent
    : (profile?.absent ?? []);
  return (
    <Drawer
      opened={opened}
      onClose={onClose}
      position="right"
      size="md"
      title="Student details"
      closeButtonProps={{ "aria-label": "Close student details" }}
      onExitTransitionEnd={onExitTransitionEnd}
    >
      {student ? (
        <Stack gap="sm">
          <Box>
            <Title order={4} tt="uppercase">
              {student.name}
            </Title>
            <Text ff="monospace" size="sm">
              Roll No {student.roll}
            </Text>
          </Box>
          <Divider />
          {/* A figure the Portal did not give is an absence, not a zero, so its
              row is left out rather than printed as a dash — and a subject
              register shows its own figure alone, so the overall row belongs
              to the all-subjects view. */}
          {student.pct != null ||
          student.attendedOfHeld !== "" ||
          (overallMode && student.overallPct != null) ? (
            <Table striped withTableBorder tabularNums>
              <Table.Tbody>
                {student.pct != null || student.attendedOfHeld !== "" ? (
                  <FigureRow
                    label="Subject attendance"
                    cell={student.attendedOfHeld}
                    pct={student.pct}
                    {...badgeFor(
                      student.critical,
                      student.irregular,
                      "subject"
                    )}
                  />
                ) : null}
                {/* The count lives in the table's Attended / Total column; the
                    panel repeats only the figure and its band. */}
                {overallMode && student.overallPct != null ? (
                  <FigureRow
                    label="Overall attendance"
                    cell=""
                    pct={student.overallPct}
                    {...badgeFor(
                      student.overallCritical,
                      student.overallIrregular,
                      "overall"
                    )}
                  />
                ) : null}
              </Table.Tbody>
            </Table>
          ) : null}
          {/* The dates the register's own columns say "A" for this student, in
              the order the register lists them — or, on the All subjects path,
              the ones that student's own grid states, unioned over subjects. No
              list when there are none, because a grid that states no dates must
              not be read as a clean sheet. */}
          {absences.length ? (
            <>
              <Text c="dimmed" size="xs" tt="uppercase">
                Absent
              </Text>
              <Table striped withTableBorder withColumnBorders tabularNums>
                <Table.Tbody>
                  {chunked(absences).map((row) => (
                    <Table.Tr key={row[0]}>
                      {row.map((date) => (
                        <Table.Td key={date} ta="center">
                          <Text size="sm" fw={600}>
                            {date}
                          </Text>
                        </Table.Td>
                      ))}
                    </Table.Tr>
                  ))}
                </Table.Tbody>
              </Table>
            </>
          ) : null}
          {/* Both figures are badged here where the table badges the subject
              alone: two badges on one table row is noise, but two labelled lines
              are how the reader sees which band each figure sits in. */}
          <Text c="dimmed" size="xs">
            {`Regular at or above ${IRREGULAR_BELOW}%; critical below ${CRITICAL_BELOW}%.`}
          </Text>
          <Divider />
          {busy ? (
            <Group gap="xs">
              <Loader size="xs" />
              <Text c="dimmed" size="sm">
                Reading this student&apos;s profile from ECAP...
              </Text>
            </Group>
          ) : null}
          {note ? (
            <Alert color={note.kind === "error" ? "red" : "yellow"}>
              {note.text}
            </Alert>
          ) : null}
          {!busy && !note && profile && !hasGpa && !phones.length ? (
            <Text c="dimmed" size="sm">
              ECAP states no GPA or phone number for this student.
            </Text>
          ) : null}
          {/* The GPA is ECAP's own line, printed as it stands: a student with no
              past semesters has the page's "NA", which is not a zero. The
              semesters under it are the page's own SGPAs, one line each, in the
              order the page states them — cumulative figures, so they share the
              heading and are never added up. */}
          {hasGpa ? (
            <>
              <Text c="dimmed" size="xs" tt="uppercase">
                GPA
              </Text>
              <Table striped withTableBorder tabularNums>
                <Table.Tbody>
                  {cgpaShown ? (
                    <Table.Tr>
                      <Table.Td colSpan={2}>
                        <Group gap="sm" justify="space-between">
                          <Text fw={600}>{`CGPA ${cgpa || "—"}`}</Text>
                          <Group gap="sm">
                            {credits ? (
                              <Text size="sm">{`Credits ${credits}`}</Text>
                            ) : null}
                            {cgpaPercent ? (
                              <Text size="sm">{`${cgpaPercent}%`}</Text>
                            ) : null}
                          </Group>
                        </Group>
                      </Table.Td>
                    </Table.Tr>
                  ) : null}
                  {sgpa.map((semester) => (
                    <Table.Tr key={semester.semester}>
                      <Table.Td c="dimmed">
                        <Text size="sm">{semester.semester}</Text>
                      </Table.Td>
                      <Table.Td ta="right">
                        <Text size="sm" fw={600}>
                          {semester.value}
                        </Text>
                      </Table.Td>
                    </Table.Tr>
                  ))}
                </Table.Tbody>
              </Table>
            </>
          ) : null}
          {hasGpa && phones.length ? <Divider /> : null}
          {phones.length ? (
            <>
              <Text c="dimmed" size="xs" tt="uppercase">
                Phone numbers
              </Text>
              <Table striped withTableBorder tabularNums>
                <Table.Tbody>
                  {phones.map((phone) => (
                    <Table.Tr key={phone.number}>
                      <Table.Td c="dimmed">
                        {/* The page's own word for the student's line is
                            "Mobile.No"; it is renamed here for the reader, and
                            any other line's label (a parent's, say) is kept. */}
                        <Text size="sm">
                          {/mobile|phone/i.test(phone.label) &&
                          !/parent|father|mother|guardian/i.test(phone.label)
                            ? "Student Mobile No"
                            : phone.label}
                        </Text>
                      </Table.Td>
                      <Table.Td ta="right">
                        <Text ff="monospace" size="sm">
                          {phone.number}
                        </Text>
                      </Table.Td>
                    </Table.Tr>
                  ))}
                </Table.Tbody>
              </Table>
            </>
          ) : null}
          {chosen.length ? (
            <>
              <Divider />
              <FactsTable facts={chosen} />
            </>
          ) : null}
        </Stack>
      ) : null}
    </Drawer>
  );
};
