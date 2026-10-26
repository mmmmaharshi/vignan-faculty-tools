import type { Dispatch, SetStateAction } from "react";
import { useEffect, useRef, useState } from "react";

import type {
  OptionsReply,
  RegisterReply,
  SemStartRequest,
} from "../shared/api";
import { SEM_START_WALK_MONTHS } from "../shared/api";
import {
  chosenLevels,
  probeSubject,
  selKeyOf,
  semesterTitleOf,
  toInputDate,
  toPortalDate,
  rememberRangeStart,
} from "./cascade";
import type { Range, Sel } from "./cascade";
import { useSemStart } from "./client";
import type { RegisterClick } from "./client";
import {
  noteSemStart,
  readSemStarts,
  semStartKey,
  writeSemStarts,
} from "./sem-starts";
import type { SemStarts } from "./sem-starts";

/**
 * Everything the semester start costs before a register loads, and the start
 * it names after: the post-load probe for the All subjects view, the
 * settle-time probe that opens From at the walked start, the remembered start
 * that answers with no probe at all, and the one writer for every
 * settle-time From snap. One hook, so the probes, the memory, and the snaps
 * cannot drift apart across call sites — App keeps the render, the range it
 * is typed into, and the just-loaded snap that owns a register already on
 * screen.
 */
export function useSemStartSettle(setup: {
  opts: OptionsReply;
  sel: Sel;
  range: Range;
  setRange: Dispatch<SetStateAction<Range>>;
  rangeEdited: { current: boolean };
  result: RegisterReply | null;
  overallMode: boolean;
  click: RegisterClick | null;
}): {
  semStart: ReturnType<typeof useSemStart>;
  preSemStart: ReturnType<typeof useSemStart>;
  semStartShown: string | null;
} {
  const {
    opts,
    sel,
    range,
    setRange,
    rangeEdited,
    result,
    overallMode,
    click,
  } = setup;
  /** The All subjects report states no dates, so its first day is read from one
   *  subject's own register instead: the first subject this session was offered,
   *  over the same range, asked once per register and never revalidated. A probe
   *  that fails changes nothing — the register on screen is complete without
   *  it — except a 401, which still ends the session through the sweep below. */
  const semProbeSubject =
    result && overallMode && click?.request
      ? probeSubject(opts.subject, click.request.subject)
      : null;
  const semStart = useSemStart(
    result && overallMode && semProbeSubject && click?.request
      ? { ...click.request, subject: semProbeSubject, walkBack: 0 }
      : null
  );
  /** The earliest start day ever seen for the class on screen, remembered in
   *  `sem-starts.ts`: the probe (or the register's own grid) only ever sees the
   *  asked window, so without this a later From would move "Sem Start Date"
   *  forward to the window's first day instead of the semester's. Keyed by the
   *  five levels plus the Portal's batch title, so a new year starts a new
   *  memory. Portal data, not personal data: it is not scoped by user id. */
  const [semStarts, setSemStarts] = useState<SemStarts>(() => readSemStarts());
  /** The settle-time semester-start probe: the cascade just completed and this
   *  class has no remembered start, so ECAP is asked — walking back — and From
   *  opens at the answer instead of the first of the month. Gated on a
   *  complete selection with a concrete subject: ALL SUBJECTS stands in its
   *  first subject, the same approximation the probe above makes. A class the
   *  memory already names probes nothing. */
  const settled = chosenLevels(opts, sel);
  const preProbeSubject = settled.ok
    ? probeSubject(opts.subject, settled.levels.subject)
    : null;
  const preKey =
    settled.ok && preProbeSubject
      ? semStartKey(
          { ...sel, subject: preProbeSubject.value },
          semesterTitleOf(opts, sel.semester)
        )
      : null;
  const preProbe: SemStartRequest | null =
    settled.ok &&
    preProbeSubject &&
    preKey &&
    !(semStarts[preKey] ?? null) &&
    range.to
      ? {
          course: settled.levels.course,
          semester: settled.levels.semester,
          branch: settled.levels.branch,
          section: settled.levels.section,
          subject: preProbeSubject,
          // The walk anchors at `to` and shapes its own months, so `from`
          // travels as `to`: the snap must not rebuild the probe's own key,
          // or every answer would ask the walk again.
          from: toPortalDate(range.to),
          to: toPortalDate(range.to),
          walkBack: SEM_START_WALK_MONTHS,
        }
      : null;
  const preSemStart = useSemStart(preProbe);
  /** The remembered start for the settled class, if any load ever taught it:
   *  settling onto a known class snaps From with no ECAP call at all. */
  const rememberedStart = preKey ? (semStarts[preKey] ?? null) : null;
  const semKey =
    result &&
    sel.course &&
    sel.semester &&
    sel.branch &&
    sel.section &&
    (overallMode ? semProbeSubject?.value : sel.subject)
      ? semStartKey(
          overallMode && semProbeSubject
            ? { ...sel, subject: semProbeSubject.value }
            : sel,
          semesterTitleOf(opts, sel.semester)
        )
      : null;
  const semSeen =
    result?.summary.statedFrom ?? semStart.data?.statedFrom ?? null;
  const semStartShown = (semKey && (semStarts[semKey] ?? semSeen)) || null;
  /** One `${source}|${iso}` stamp per applied From snap, plus the selection
   *  mark below: an answer already on screen never asks again. Both guard
   *  effects and must never render. */
  const snapApplied = useRef<string | null>(null);
  /** The selection the memory snap already ran for, as the raw five values:
   *  ALL SUBJECTS and its first subject resolve to one memory key, but they
   *  are different selections — keying here keeps the switch between them a
   *  fresh snap. A load that teaches the memory keeps the selection, so it
   *  never re-snaps the window it loaded. Unlike the answer stamps above,
   *  this one guards a selection, hence the different name. */
  const snappedSelection = useRef<string | null>(null);
  /** One writer for every settle-time From snap, in precedence order: the
   *  remembered start first (no ECAP call), then the walked probe, then the
   *  post-load probe that names the All subjects start the register cannot
   *  state. A manual edit wins over the first two — an explicit date beats a
   *  guessed one. (The just-loaded register snaps in the caller: the figures
   *  begin where it states even over a manual edit.) */
  const selKey = selKeyOf(sel);
  /* oxlint-disable react/set-state-in-effect */
  useEffect(() => {
    const snap = (source: string, stated: string | null): void => {
      const iso = stated ? toInputDate(stated) : "";
      if (!iso || iso === range.from) return;
      const stamp = `${source}|${iso}`;
      if (stamp === snapApplied.current) return;
      snapApplied.current = stamp;
      rememberRangeStart(iso);
      setRange((r) => ({ ...r, from: iso }));
    };
    if (snappedSelection.current !== selKey) {
      snappedSelection.current = selKey;
      if (rememberedStart && !rangeEdited.current) {
        snap(`memory|${selKey}`, rememberedStart);
      }
    }
    if (preSemStart.data?.statedFrom && preKey && !rangeEdited.current) {
      snap(`probe|${preKey}`, preSemStart.data.statedFrom);
    }
    if (semStart.data?.statedFrom) {
      snap("semprobe", semStart.data.statedFrom);
    }
  }, [
    selKey,
    rememberedStart,
    range,
    preSemStart.data,
    preKey,
    semStart.data,
    setRange,
    rangeEdited,
  ]);
  /* oxlint-enable react/set-state-in-effect */
  /** Fold the window's first day into the earliest-start memory: without this a
   *  later From would move "Sem Start Date" forward to the window's first day
   *  instead of the semester's (the memory lives in `sem-starts.ts`). */
  /* oxlint-disable react/set-state-in-effect */
  useEffect(() => {
    if (!semKey || !semSeen) return;
    setSemStarts((prev) => {
      const next = noteSemStart(prev, semKey, semSeen);
      if (next !== prev) writeSemStarts(next);
      return next;
    });
  }, [semKey, semSeen]);
  /* oxlint-enable react/set-state-in-effect */
  return { semStart, preSemStart, semStartShown };
}
