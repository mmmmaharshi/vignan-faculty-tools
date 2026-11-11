import type { Dispatch, SetStateAction } from "react";
import { useEffect, useRef, useState } from "react";

import type {
  OptionsReply,
  RegisterReply,
  SemStartRequest,
} from "../../shared/api";
import { SEM_START_WALK_MONTHS } from "../../shared/api";
import type { RangeEdited } from "../app/load-gate";
import { useSemStart } from "../data/client";
import type { RegisterClick } from "../data/client";
import {
  chosenLevels,
  probeSubject,
  selKeyOf,
  semesterTitleOf,
} from "./cascade";
import type { Sel } from "./cascade";
import { openRangeAt, toInputDate, toPortalDate } from "./range";
import type { Range } from "./range";
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
  rangeEdited: RangeEdited;
  result: RegisterReply | null;
  overallMode: boolean;
  click: RegisterClick | null;
}): {
  semStart: ReturnType<typeof useSemStart>;
  preSemStart: ReturnType<typeof useSemStart>;
  semStartShown: string | null;
  /** The start remembered for the settled class, if any load ever taught it:
   *  the screen snaps to it with no probe, so no load ever waits for it. */
  rememberedStart: string | null;
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
  /** One construction for a class's start-memory key: the five levels, with
   *  the subject the probe actually reads in place of the section-wide one,
   *  plus the Portal's batch title. Every reader and writer of the memory goes
   *  through it, so a probe and the fold that stores its answer cannot name two
   *  different classes. */
  const startKeyFor = (subject: string | undefined): string | null =>
    subject
      ? semStartKey({ ...sel, subject }, semesterTitleOf(opts, sel.semester))
      : null;
  const preKey =
    settled.ok && preProbeSubject ? startKeyFor(preProbeSubject.value) : null;
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
    result && sel.course && sel.semester && sel.branch && sel.section
      ? startKeyFor(
          overallMode ? semProbeSubject?.value : sel.subject || undefined
        )
      : null;
  const semSeen =
    result?.summary.statedFrom ??
    semStart.data?.statedFrom ??
    // The settle walk answered for the same class whenever the two keys agree,
    // and its day is the true start. Folding it in matters because the fold
    // only ever lowers an entry: a first load over a hand-narrowed window would
    // otherwise record that window's first day as the class's start, for good.
    (preKey === semKey ? preSemStart.data?.statedFrom : null) ??
    null;
  const semStartShown = (semKey && (semStarts[semKey] ?? semSeen)) || null;
  /** The stamps that stop an effect asking twice: the last applied From snap
   *  (`source|iso`), and the selection the memory snap already ran for. Both
   *  guard effects and must never render, so they are one ref and one rule
   *  rather than two flags to keep in step. */
  const snapMarks = useRef<{ stamp: string | null; selection: string | null }>({
    stamp: null,
    selection: null,
  });
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
      if (stamp === snapMarks.current.stamp) return;
      snapMarks.current.stamp = stamp;
      openRangeAt(iso, range, setRange);
    };
    if (snapMarks.current.selection !== selKey) {
      snapMarks.current.selection = selKey;
      if (rememberedStart && rangeEdited !== "from") {
        snap(`memory|${selKey}`, rememberedStart);
      }
    }
    if (preSemStart.data?.statedFrom && preKey && rangeEdited !== "from") {
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
  return { semStart, preSemStart, semStartShown, rememberedStart };
}
