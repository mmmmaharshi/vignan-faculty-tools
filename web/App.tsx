/**
 * ECAP Attendance Dashboard - front end
 *
 * React 19 + Mantine 9. There is no custom CSS in this project: not a
 * stylesheet, not a CSS module, not an inline `style` prop. Every visual
 * decision is a Mantine component or a Mantine colour token, read through
 * Mantine's own `bg` and `c` props. The row tint on the register table is
 * Mantine's `Table.Tr bg`, pointed at `--mantine-color-*-light`.
 *
 * The cascade below is a deliberate line-for-line port of the imperative
 * version, not a redesign. It was wrong three separate times before it was
 * right, and the mistakes it is guarding against are structural, not stylistic:
 *
 *   - /api/session answers 200 with {signedIn:false}, not 401. Checking the
 *     status code alone runs the signed-in path while signed out.
 *   - Two refreshes can overlap. refreshToken makes the newer call win, so a
 *     stale response can never repopulate the dropdowns.
 *   - Every level above the subject auto-fills to its first option, so the chain
 *     populates itself and the user overrides whatever they disagree with. The
 *     subject is the one exception and is left for the user, because it decides
 *     which register loads.
 *
 * See docs/adr/0001-port-ui-to-react-and-mantine.md.
 *
 * Structure: this file owns the state and the three modes, and composes four
 * presentational components under `web/components/`. It owns the cascade
 * outright - `runRefresh` and the ref pattern stay here, not in a child, because
 * that logic is load-bearing and a reader debugging the chain should find it in
 * one place. The children are told what to render and report changes upwards;
 * none of them holds state.
 */

import { Button, Container, Group, Text, Title } from "@mantine/core";
import React, { useCallback, useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";

import type {
  CascadeLevel,
  LoginRequest,
  OkReply,
  Option,
  OptionsReply,
  OptionsRequest,
  RegisterReply,
  RegisterRequest,
  SessionReply,
} from "../shared/api";
import { ClassPicker } from "./components/ClassPicker";
import { RegisterSummary } from "./components/RegisterSummary";
import { RegisterTable } from "./components/RegisterTable";
import { statusOf } from "./components/rowStyle";
import { SignInPanel } from "./components/SignInPanel";
import type { Disabled, Note, Range, Sel } from "./types";

// The irregular/critical thresholds belong to the server, which is what applies
// them. They arrive in the summary so the labels below can never drift from the
// flags the server actually set.

/** One position in the cascade, straight from the contract. */
type Level = CascadeLevel;

/** Which screen is showing. */
type Phase = "boot" | "login" | "app";

/** The full chain, in cascade order. */
const LEVELS: readonly (readonly [Level, string])[] = [
  ["course", "Course"],
  ["semester", "Semester"],
  ["branch", "Branch"],
  ["section", "Section"],
  ["subject", "Subject"],
];
const LEVEL_KEYS: readonly Level[] = LEVELS.map(([k]) => k);

// Written out rather than assembled with Object.fromEntries, so adding a level to
// the contract is a compile error here until someone decides what an unset one
// looks like.
const EMPTY_SEL: Sel = {
  course: "",
  semester: "",
  branch: "",
  section: "",
  subject: "",
};
const EMPTY_OPTS: OptionsReply = {
  course: [],
  semester: [],
  branch: [],
  section: [],
  subject: [],
  emptyLevels: [],
};

/* ------------------------------------------------------------------ helpers */

/** An HTTP failure, carrying the status so callers can tell 401 from 400. */
class ApiError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
    this.name = "ApiError";
  }
}

/**
 * Call the server and return the typed reply.
 *
 * `T` is an assertion, not a check, and the reason it is a sound one is that the
 * server is compiled against the same declarations in `shared/api.ts`: a reply
 * that drifts from what this side expects is a build error over there. Before
 * the contract existed, the two halves agreed about these shapes by memory.
 */
async function api<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(path, options);
  let body: { error?: string } = {};
  try {
    body = (await res.json()) as { error?: string };
  } catch {
    /* an empty body is not fatal here */
  }
  if (!res.ok) {
    throw new ApiError(
      res.status,
      body.error ?? `Request failed (${res.status})`
    );
  }
  return body as T;
}

/** The portal wants dd/mm/yyyy. */
function toPortalDate(iso: string): string {
  if (!iso) return "";
  const [y, m, d] = iso.split("-");
  if (!y || !m || !d) return "";
  return `${d}/${m}/${y}`;
}

function defaultRange(): { from: string; to: string } {
  const now = new Date();
  return {
    to: now.toISOString().slice(0, 10),
    from: new Date(now.getFullYear(), 0, 1).toISOString().slice(0, 10),
  };
}

/**
 * Merge a fresh option set into the current selection.
 *
 * This reproduces what a browser did to the old <select> elements: a value that
 * is still a valid option survives, and anything else falls to the first option,
 * because a populated select always has something selected.
 *
 * The subject is the exception. It is the choice that matters, and quietly
 * pre-selecting the first one risks loading the wrong register, so it is left
 * empty for the user to pick.
 */
function applyOptions(sel: Sel, opts: OptionsReply): Sel {
  const next = { ...sel };
  for (const key of LEVEL_KEYS) {
    if (key === "subject") {
      next.subject = "";
      continue;
    }
    const [first] = opts[key];
    if (!first) {
      next[key] = "";
      continue;
    }
    if (!opts[key].some((o) => String(o.value) === String(next[key]))) {
      next[key] = first.value;
    }
  }
  return next;
}

/**
 * One CSV field, quoted.
 *
 * Every cell reaching this is a string: the portal's combined attended/held is
 * one, and the percentage is formatted or blanked before it gets here. Typing it
 * `string` rather than `unknown` is the check - `unknown` would have let anything
 * through and turned `String()` into the thing doing the work.
 */
const csvCell = (v: string): string => `"${v.replaceAll('"', '""')}"`;

/**
 * The full option behind each level's current value, or the label of the first
 * level that has none.
 *
 * `ShowAcademicCalendar` needs every level by identifier *and* by visible text,
 * and returns nothing at all rather than failing when a label is missing - so
 * this is checked once, here, instead of five times at the call site.
 */
function chosenLevels(
  opts: OptionsReply,
  sel: Sel
): { ok: true; levels: Record<Level, Option> } | { ok: false; label: string } {
  // Sound because the loop below assigns every member of Level: LEVELS and
  // OptionsReply have the same five keys, and Level is derived from the latter.
  const levels = {} as Record<Level, Option>;
  for (const [key, label] of LEVELS) {
    const hit = opts[key].find((o) => String(o.value) === String(sel[key]));
    if (!hit) return { ok: false, label };
    levels[key] = hit;
  }
  return { ok: true, levels };
}

/**
 * Whether every level above `key` has a choice, i.e. whether the server could
 * now answer for it.
 */
function isReady(sel: Sel, key: Level): boolean {
  const i = LEVEL_KEYS.indexOf(key);
  return LEVEL_KEYS.slice(0, i).every((k) => !!sel[k]);
}

/* ------------------------------------------------------------------ app */

const App = (): React.JSX.Element => {
  const [phase, setPhase] = useState<Phase>("boot"); // boot | login | app
  const [userId, setUserId] = useState("");
  const [password, setPassword] = useState("");

  const [loginNote, setLoginNote] = useState<Note | null>(null);
  const [filterNote, setFilterNote] = useState<Note | null>(null);
  const [busy, setBusy] = useState(false);
  const [loadNote, setLoadNote] = useState("");

  const [sel, setSel] = useState<Sel>(EMPTY_SEL);
  const [opts, setOpts] = useState<OptionsReply>(EMPTY_OPTS);

  const [range, setRange] = useState<{ from: string; to: string }>(() =>
    defaultRange()
  );
  const [result, setResult] = useState<RegisterReply | null>(null);
  const [onlyIrregular, setOnlyIrregular] = useState(false);

  // The cascade is driven imperatively, not from an effect watching `sel`.
  // A state-driven effect would re-enter itself every time it committed a pass.
  //
  // These two write a ref during render, which react(refs) flags. That is the
  // point: runRefresh is memoised with [] and needs the *current* selection and
  // option lists, and a ref written during render is how it gets them. Reading
  // them from state instead is the stale-closure bug AGENTS.md describes.
  /* oxlint-disable react/refs */
  const selRef = useRef<Sel>(sel);
  selRef.current = sel;
  // runRefresh is memoised with an empty dependency list, so it closes over
  // render 1's `opts` - which is EMPTY_OPTS, permanently. Anything inside it
  // that reads the option lists has to go through a ref like this one. It did
  // not, and the semester's batch number silently arrived as undefined for
  // every course; see AGENTS.md.
  const optsRef = useRef<OptionsReply>(opts);
  optsRef.current = opts;
  /* oxlint-enable react/refs */
  const refreshToken = useRef(0);

  /* ---- the cascade ---- */

  const runRefresh = useCallback(async (changed: Level | null) => {
    const token = ++refreshToken.current;

    // Drop everything below the level that changed *before* asking, so the
    // request only ever carries a valid prefix of the chain. A stale semester
    // left in place would make the server compute a section list for a
    // combination the user can no longer see.
    //
    // `draft` and `reply` are deliberately not named `sel` and `opts`: those are
    // the state above, and shadowing them made `setOpts(opts)` ambiguous about
    // whether it was storing the state or the server's answer.
    let draft = { ...selRef.current };
    if (changed === "course") {
      draft = { ...draft, semester: "", branch: "", section: "", subject: "" };
    } else if (changed === "semester" || changed === "branch") {
      draft = { ...draft, section: "", subject: "" };
    } else if (changed === "section") {
      draft = { ...draft, subject: "" };
    }
    selRef.current = draft;
    setSel(draft);

    setBusy(true);
    setLoadNote("Loading options...");

    try {
      for (const _pass of LEVEL_KEYS) {
        if (token !== refreshToken.current) return;

        // The semester's `title` carries the batch number the portal wants for
        // the section list, and this side is the only one still holding it.
        // Empty for IV Semester, which the server handles by falling back.
        // Read through optsRef, not opts - see the note where it is declared.
        const semesterTitle = draft.semester
          ? optsRef.current.semester.find(
              (o) => String(o.value) === String(draft.semester)
            )?.title
          : undefined;

        const request: OptionsRequest = {
          course: draft.course || undefined,
          semester: draft.semester || undefined,
          semesterTitle,
          branch: draft.branch || undefined,
          section: draft.section || undefined,
        };
        const reply = await api<OptionsReply>("/api/options", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(request),
        });
        if (token !== refreshToken.current) return;

        const before = draft;
        draft = applyOptions(draft, reply);
        selRef.current = draft;
        setSel(draft);
        setOpts(reply);

        // Keep going while this pass settled a level AND some level below it is
        // now ready but still empty.
        //
        // The tempting shortcut - stop as soon as a level has more than one
        // option, because the user ought to choose - dead-ends the chain.
        // Changing a branch clears section and subject, so the request goes out
        // with no section and the server answers with no subjects; applyOptions
        // then fills section to its only option and nothing ever asks again. If
        // that section has just the one option the user cannot change it, so
        // the subject list becomes unreachable.
        //
        // Populating the whole chain and letting the user override any level is
        // both simpler and what a user expects. Requiring `gained` stops this
        // looping when the server genuinely has nothing to give.
        const gained = LEVEL_KEYS.some((k) => draft[k] !== before[k]);
        const pending = LEVEL_KEYS.find(
          (k) => k !== "course" && isReady(draft, k) && reply[k].length === 0
        );
        if (!gained || !pending) return;
      }
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        setPhase("login");
        return;
      }
      setFilterNote({
        kind: "error",
        text: error instanceof Error ? error.message : String(error),
      });
    } finally {
      if (token === refreshToken.current) {
        setBusy(false);
        setLoadNote("");
      }
    }
  }, []);

  /* ---- sign in ---- */

  const signIn = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setLoginNote(null);
    setBusy(true);
    try {
      const body: LoginRequest = { userId: userId.trim(), password };
      await api<OkReply>("/api/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      setPassword(""); // do not keep it in the DOM
      setPhase("app");
      await runRefresh(null);
    } catch (error) {
      setLoginNote({
        kind: "error",
        text: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setBusy(false);
    }
  };

  const signOut = async () => {
    try {
      await api<OkReply>("/api/logout", { method: "POST" });
    } catch {
      /* the cookie is cleared either way */
    }
    setPhase("login");
    setSel(EMPTY_SEL);
    setOpts(EMPTY_OPTS);
    setResult(null);
  };

  // Resume: the endpoint answers 200 with {signedIn:false} when signed out,
  // so the check has to be on the payload, not the status.
  useEffect(() => {
    (async () => {
      try {
        const s = await api<SessionReply>("/api/session");
        if (s && s.signedIn) {
          setPhase("app");
          await runRefresh(null);
        } else {
          setPhase("login");
        }
      } catch {
        setPhase("login");
      }
    })();
  }, [runRefresh]);

  /* ---- register ---- */

  const loadRegister = async () => {
    setFilterNote(null);
    if (!range.from || !range.to) {
      setFilterNote({ kind: "warning", text: "Choose a date range." });
      return;
    }

    const chosen = chosenLevels(opts, sel);
    if (!chosen.ok) {
      setFilterNote({
        kind: "warning",
        text: `Choose a ${chosen.label.toLowerCase()} first.`,
      });
      return;
    }

    setBusy(true);
    setLoadNote("Reading the register from ECAP...");
    try {
      const request: RegisterRequest = {
        ...chosen.levels,
        from: toPortalDate(range.from),
        to: toPortalDate(range.to),
      };
      const body = await api<RegisterReply>("/api/register", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(request),
      });
      setResult(body);
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        setPhase("login");
        return;
      }
      setFilterNote({
        kind: "error",
        text: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setBusy(false);
      setLoadNote("");
    }
  };

  /* ---- export ---- */

  const saveCsv = () => {
    if (!result) return;
    const head = [
      "Roll No",
      "Student Name",
      "Attend/Held",
      "Percent",
      "Status",
    ];
    const lines = [head.map(csvCell).join(",")];
    for (const s of result.students) {
      const status = statusOf(s);
      lines.push(
        [
          s.roll,
          s.name,
          s.attendedOfHeld,
          s.pct == null ? "" : s.pct.toFixed(2),
          status,
        ]
          .map(csvCell)
          .join(",")
      );
    }
    // The BOM is what makes Excel read the file as UTF-8.
    const blob = new Blob([`\uFEFF${lines.join("\r\n")}`], {
      type: "text/csv;charset=utf-8",
    });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "ecap-attendance.csv";
    document.body.append(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(a.href);
  };

  /* ---- derived ---- */

  const has = (k: Level): boolean => !!sel[k];
  const disabled: Disabled = {
    course: false,
    semester: !has("course"),
    branch: !has("course"),
    section: !(has("course") && has("branch") && has("semester")),
    subject: !(
      has("course") &&
      has("branch") &&
      has("semester") &&
      has("section")
    ),
  };

  const summary = result?.summary;
  const rows = result
    ? result.students
        .filter((s) => !onlyIrregular || s.irregular)
        .toSorted((a, b) => (a.pct ?? 999) - (b.pct ?? 999))
    : [];

  // flatMap rather than map().filter(Boolean): one pass and no intermediate
  // array of nulls, which is what the two-step version builds and throws away.
  const chosenText = LEVELS.flatMap(([key, label]) => {
    const hit = opts[key].find((o) => String(o.value) === String(sel[key]));
    return hit ? [`${label}: ${hit.label}`] : [];
  }).join("   ·   ");

  /* ---- what the children call back into ---- */

  /**
   * A level changed. The value is read here and passed on, never inside a
   * `setState` updater: React clears `event.currentTarget` once the handler
   * returns, and an updater runs later, so deferring the read throws "Cannot
   * read properties of null". That shipped once and blanked the whole page.
   */
  const onSelectLevel = (key: Level, value: string) => {
    setSel((s) => ({ ...s, [key]: value }));
    selRef.current = { ...selRef.current, [key]: value };
    // Subject is filled by the server, not by a change handler.
    if (key !== "subject") runRefresh(key);
  };

  const onRangeChange = (part: keyof Range, value: string) => {
    setRange((r) => ({ ...r, [part]: value }));
  };

  /* ---- render ---- */

  // Three modes, composed rather than switched with booleans. Each child is
  // told what to render and reports changes upwards; none of them holds state,
  // so the cascade below stays the single place any of it is decided.
  return (
    <Container size="lg" py="lg">
      <Group justify="space-between" align="baseline" mb="lg">
        <div>
          <Title order={1}>ECAP Attendance Dashboard</Title>
          <Text c="dimmed" size="sm">
            Vignan Institute of Technology
          </Text>
        </div>
        <Group gap="sm">
          {phase === "app" && userId.trim() ? (
            <Text c="dimmed" size="sm">
              {userId.trim()}
            </Text>
          ) : null}
          {phase === "app" ? (
            <Button variant="default" onClick={signOut}>
              Sign out
            </Button>
          ) : null}
        </Group>
      </Group>

      {phase === "app" ? (
        <>
          <ClassPicker
            levels={LEVELS}
            opts={opts}
            sel={sel}
            disabled={disabled}
            range={range}
            busy={busy}
            hasResult={result !== null}
            loadNote={loadNote}
            filterNote={filterNote}
            onSelect={onSelectLevel}
            onRange={onRangeChange}
            onLoad={loadRegister}
            onSaveCsv={saveCsv}
          />

          {summary ? (
            <>
              <RegisterSummary summary={summary} />
              <RegisterTable
                rows={rows}
                total={result?.students.length ?? 0}
                summary={summary}
                onlyIrregular={onlyIrregular}
                onToggleIrregular={setOnlyIrregular}
                chosenText={chosenText}
              />
            </>
          ) : null}
        </>
      ) : (
        <SignInPanel
          userId={userId}
          password={password}
          busy={busy}
          note={loginNote}
          onUserId={setUserId}
          onPassword={setPassword}
          onSubmit={signIn}
        />
      )}
    </Container>
  );
};

export default App;
