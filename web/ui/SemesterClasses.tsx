import { Table, Text } from "@mantine/core";

import type { Student, StudentTotals } from "../../shared/api";
import { IRREGULAR_BELOW, classesToRegular } from "../../shared/portal-values";

/**
 * Whether the way-back row is for this student, and whether it escalates to
 * the critical tint — read off the row's own band flags rather than
 * recomputed from the thresholds. The server banded both figures with the
 * same two constants, so a second comparison here is a second place the
 * lines live. The semester-wide figure wins where the register carries it,
 * else the subject's own.
 */
const bandsFor = (
  student: Student | null
): { below: boolean; critical: boolean } => {
  if (!student) return { below: false, critical: false };
  if (student.overallPct != null) {
    return {
      below: student.overallIrregular || student.overallCritical,
      critical: student.overallCritical,
    };
  }
  return {
    below: student.irregular || student.critical,
    critical: student.critical,
  };
};

type SemesterClassesProps = {
  /** The row whose panel is open: its band flags say whether the way-back
   *  row is for this student, so no threshold is recomputed here. */
  student: Student | null;
  /** The semester's own counts, or null where that reply never arrived. */
  totals: StudentTotals | null;
};

/**
 * The semester's own class counts with the way back to the regular line: the
 * consecutive attends from here that reach it, or a dash where no counts
 * arrived to reckon from. Absent entirely for a regular student — there is
 * nothing to recover — and where neither counts nor a below-the-line figure
 * name this student.
 */
export const SemesterClasses = ({ student, totals }: SemesterClassesProps) => {
  const { below, critical } = bandsFor(student);
  /** Null where there is no number — no counts, or already at the line. */
  const need = totals ? classesToRegular(totals.held, totals.attend) : null;
  if (!totals && !(need != null || below)) return null;
  return (
    <>
      <Text c="dimmed" size="xs" tt="uppercase">
        Semester classes
      </Text>
      <Table striped withTableBorder tabularNums>
        <Table.Tbody>
          {/* Held is the periods that ran, so attend and absent are its two
              parts and not-entered the third. */}
          {totals
            ? [
                { label: "Total Held", value: totals.held },
                { label: "Total Attend", value: totals.attend },
                { label: "Total Absent", value: totals.absent },
              ].map(({ label, value }) => (
                <Table.Tr key={label}>
                  <Table.Td c="dimmed">
                    <Text size="sm">{label}</Text>
                  </Table.Td>
                  <Table.Td ta="right">
                    <Text size="sm" fw={600}>
                      {value}
                    </Text>
                  </Table.Td>
                </Table.Tr>
              ))
            : null}
          {/* Below the line, one row names the way back, or a dash where no
              counts arrived — absence of evidence, never a zero. Yellow
              warning, escalating to the register's critical red. */}
          {need != null || below ? (
            <Table.Tr
              bg={
                critical
                  ? "var(--mantine-color-red-light)"
                  : "var(--mantine-color-yellow-light)"
              }
            >
              <Table.Td c="dimmed">
                <Text size="sm">{`Need for ${IRREGULAR_BELOW}%`}</Text>
              </Table.Td>
              <Table.Td ta="right">
                <Text size="sm" fw={600}>
                  {need == null
                    ? "—"
                    : `Attend next ${need} class${need === 1 ? "" : "es"}`}
                </Text>
              </Table.Td>
            </Table.Tr>
          ) : null}
        </Table.Tbody>
      </Table>
    </>
  );
};
