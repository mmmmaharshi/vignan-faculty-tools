import {
  Alert,
  Badge,
  Divider,
  Drawer,
  Group,
  Loader,
  Stack,
  Text,
  Title,
} from "@mantine/core";

import {
  CRITICAL_BELOW,
  IRREGULAR_BELOW,
  overallCellForDisplay,
} from "../../attendance-bands";
import type { Student, StudentProfile } from "../../shared/api";
import type { Note } from "../types";
import { badgeFor } from "./RegisterTable";

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
  /** The register this student was read from, with the period it was read over:
   *  a percentage means nothing without the two, and the table says the same
   *  sentence above itself. */
  chosenText: string;
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
 * One student: the register row that was clicked, with the band each of its two
 * figures sits in spelled out, then the GPA and phone numbers ECAP holds for
 * them. The row itself is not fetched — it is repeated from the table — and the
 * profile is, once, when the panel opens.
 */
export const StudentDetails = ({
  student,
  opened,
  onClose,
  onExitTransitionEnd,
  chosenText,
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
          {student.overallPct != null ||
          student.overallAttendedOfHeld !== "" ? (
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
              {cgpaShown ? (
                <Group gap="sm">
                  <Text fw={600}>{`CGPA ${cgpa || "—"}`}</Text>
                  {credits ? (
                    <Text size="sm">{`Credits ${credits}`}</Text>
                  ) : null}
                  {cgpaPercent ? (
                    <Text size="sm">{`${cgpaPercent}%`}</Text>
                  ) : null}
                </Group>
              ) : null}
              {sgpa.map((semester) => (
                <Group gap="xs" justify="space-between" key={semester.semester}>
                  <Text c="dimmed" size="sm">
                    {semester.semester}
                  </Text>
                  <Text fw={600} size="sm">
                    {semester.value}
                  </Text>
                </Group>
              ))}
            </>
          ) : null}
          {phones.length ? (
            <Text c="dimmed" size="xs" tt="uppercase">
              Phone numbers
            </Text>
          ) : null}
          {phones.map((phone) => (
            <Group key={phone.number} gap="xs" justify="space-between">
              <Text c="dimmed" size="sm">
                {phone.label}
              </Text>
              <Text ff="monospace" size="sm">
                {phone.number}
              </Text>
            </Group>
          ))}
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
};
