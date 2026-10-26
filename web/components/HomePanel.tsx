import {
  Alert,
  Group,
  Loader,
  Pill,
  Stack,
  Table,
  Text,
  Title,
} from "@mantine/core";
import React, { useEffect, useMemo, useState } from "react";

import type { TodayClass } from "../../shared/api";
import { capitalCase, pillsOf, splitSubject } from "../format";
import {
  notePeriodTimes,
  readPeriodTimes,
  writePeriodTimes,
  PERIOD_COUNT,
} from "../period-times";
import type { PeriodTimes } from "../period-times";
import type { Note } from "../types";

export type HomePanelProps = {
  /** Today's periods in the grid's own order. Null while unread. */
  classes?: TodayClass[] | null;
  busy?: boolean;
  /** A read that failed says so here. An empty day is not this — it is the
   *  skeleton below, because ECAP clears the day after ~4pm. */
  note?: Note | null;
  /** The day both Home sections cover, dd/mm/yyyy on the campus clock. */
  date?: string | null;
};
/** "08:45 AM- 09:35 PM" as minutes since midnight, or null when the grid
 *  wrote something else. Twelve-hour clock, as ECAP writes it. */
const TIME_RANGE =
  /(?<from>\d{1,2}:\d{2}\s*[AP]M)\s*-\s*(?<to>\d{1,2}:\d{2}\s*[AP]M)/i;
const toMinutes = (clock: string): number | null => {
  const parts = clock
    .trim()
    .match(/^(?<hour>\d{1,2}):(?<minute>\d{2})\s*(?<half>[AP])M$/i)?.groups;
  if (!parts?.hour || !parts.minute || !parts.half) return null;
  const hour =
    (Number(parts.hour) % 12) + (parts.half.toUpperCase() === "P" ? 12 : 0);
  return hour * 60 + Number(parts.minute);
};
/** Whether the faculty member is inside this period right now, by the
 *  browser's own clock — ECAP and the faculty share the campus day. Ranges
 *  read on a 24-hour clock, so an evening range past midnight still contains
 *  its early minutes. */
const isLive = (time: string, now: Date): boolean => {
  const range = time.match(TIME_RANGE)?.groups;
  const from = range?.from ? toMinutes(range.from) : null;
  const to = range?.to ? toMinutes(range.to) : null;
  if (from === null || to === null) return false;
  const at = now.getHours() * 60 + now.getMinutes();
  return from <= to ? from <= at && at < to : at >= from || at < to;
};
const ClassCell = ({ entry }: { entry: TodayClass }): React.JSX.Element => {
  const { name, branch } = splitSubject(entry.subject);
  const pills = [...(branch ? [branch] : []), ...pillsOf(entry.section)];
  return (
    <>
      {name ? <Text fw={600}>{capitalCase(name)}</Text> : null}
      {/* The branch and the section's own pieces ride pills rather than one
          long line. */}
      {pills.length ? (
        <Group gap={4} mt={4}>
          {pills.map((pill) => (
            <Pill key={pill} size="xs">
              {pill}
            </Pill>
          ))}
        </Group>
      ) : null}
    </>
  );
};
/** Whether ECAP stated a class in this slot. A free period still carries its
 *  hours, so the hours cannot answer this — only the class can. */
const hasClass = (entry: TodayClass): boolean =>
  Boolean(entry.subject || entry.section);
const dayRows = (
  classes: TodayClass[],
  known: PeriodTimes = {}
): TodayClass[] => {
  const rows: TodayClass[] = [];
  for (let index = 1; index <= PERIOD_COUNT; index += 1) {
    const slot = `Period ${index}`;
    const stated = classes.filter((entry) => entry.period === slot);
    if (stated.length) {
      // A stated slot that states no hours still reads the last hours this
      // browser was told for it.
      rows.push(
        ...stated.map((entry) => ({
          ...entry,
          time: entry.time || known[slot] || "",
        }))
      );
    } else {
      rows.push({
        period: slot,
        time: known[slot] ?? "",
        subject: "",
        section: "",
        room: "",
      });
    }
  }
  // A period ECAP named outside 1..7 rides along rather than vanishing. The
  // comparison is by period, not by object: the slots above hold copies, so an
  // identity check would push every stated period a second time.
  const named = new Set(rows.map((row) => row.period));
  for (const entry of classes) {
    if (named.has(entry.period)) continue;
    rows.push({ ...entry, time: entry.time || known[entry.period] || "" });
  }
  return rows;
};
export const HomePanel = ({
  classes,
  busy,
  note,
  date,
}: HomePanelProps): React.JSX.Element => {
  // The highlight must flip when a period starts or ends mid-visit, so the
  // clock ticks rather than being read once on mount.
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const tick = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(tick);
  }, []);
  // ECAP states every slot's hours until it clears the day, and then states
  // none at all — so each read teaches the memory the slot hours it will need
  // once they are gone. The hours are read back on every render rather than
  // captured once, so a read that arrives later in the same session cannot
  // fold into a stale snapshot and erase what an earlier read taught.
  const known = useMemo(
    () => notePeriodTimes(readPeriodTimes(), classes ?? []),
    [classes]
  );
  useEffect(() => {
    if (!classes) return;
    const prev = readPeriodTimes();
    const next = notePeriodTimes(prev, classes);
    if (next !== prev) writePeriodTimes(next);
  }, [classes]);

  return (
    <Stack gap="md">
      <Title order={4}>Today&apos;s Classes{date ? ` · ${date}` : ""}</Title>
      {note ? (
        <Alert color={note.kind === "error" ? "red" : "yellow"}>
          {note.text}
        </Alert>
      ) : null}
      {!classes && busy ? (
        <Stack align="center" mt="xl" gap="sm">
          <Loader size="lg" />
          <Text c="dimmed" size="sm">
            Reading today from ECAP...
          </Text>
        </Stack>
      ) : null}
      {classes && !busy ? (
        <Table striped highlightOnHover withTableBorder withColumnBorders>
          <Table.Thead>
            <Table.Tr>
              <Table.Th>Period</Table.Th>
              <Table.Th>Class</Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {dayRows(classes, known).map((entry, index) => (
              // The grid states no identifiers, so the order it gave is the key.
              // The live period carries the register's critical-row tint in
              // blue: it answers "where am I supposed to be" at a glance. A
              // free period keeps its hours but never tints — there is nowhere
              // to be.
              <Table.Tr
                key={`${entry.period}-${entry.subject}-${index}`}
                bg={
                  hasClass(entry) && isLive(entry.time, now)
                    ? "var(--mantine-color-blue-light)"
                    : undefined
                }
              >
                <Table.Td>
                  <Text fw={700}>{entry.period || "—"}</Text>
                  {entry.time ? (
                    <Text c="dimmed" size="xs">
                      {entry.time}
                    </Text>
                  ) : null}
                </Table.Td>
                <Table.Td>
                  {hasClass(entry) ? (
                    <ClassCell entry={entry} />
                  ) : (
                    <Text c="dimmed" size="sm">
                      No Classes Today
                    </Text>
                  )}
                </Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      ) : null}
    </Stack>
  );
};
