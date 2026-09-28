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
 * See docs/adr/0001-port-ui-to-react-and-mantine.md,
 * docs/adr/0005-give-the-cascade-rules-a-module.md, and
 * docs/adr/0009-routes-instead-of-a-mode-switch.md.
 *
 * Structure: this file owns the state and the refresh loop. The cascade's
 * *rules* - which level auto-fills, when to keep looping, what is ready - live
 * in `web/cascade.ts`, where a test can reach them without mounting React. What
 * stays here is the part that is about time rather than data: the
 * `refreshToken` that makes a newer pass win, and the ref pattern that feeds
 * `runRefresh` the current selection. A reader debugging *why a dropdown is
 * empty* should read `cascade.ts`; a reader debugging *why two requests raced*
 * should read this file.
 *
 * Which screen is showing is the URL, not a state variable: `/` is the dashboard
 * and `/login` is the sign-in form. A refresh, a bookmark and the back button
 * therefore agree with what is on screen, and ending a session is a navigation
 * rather than a `setPhase` only this file can observe.
 *
 * The children under `web/components/` are told what to render and report
 * changes upwards; none of them holds state.
 */

import { Button, Container, Group, Text, Title } from "@mantine/core";
import React, { useCallback, useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import { useLocation, useNavigate } from "react-router";

import type {
  LoginRequest,
  OkReply,
  OptionsReply,
  OptionsRequest,
  RegisterReply,
  RegisterRequest,
  SessionReply,
} from "../shared/api";
import {
  applyOptions,
  chosenLevels,
  chosenText,
  defaultRange,
  disabledLevels,
  EMPTY_OPTS,
  EMPTY_SEL,
  LEVEL_KEYS,
  LEVELS,
  shouldContinue,
  statusOf,
  toPortalDate,
} from "./cascade";
import type { Level, Sel } from "./cascade";
import { ClassPicker } from "./components/ClassPicker";
import { RegisterSummary } from "./components/RegisterSummary";
import { RegisterTable } from "./components/RegisterTable";
import { SignInPanel } from "./components/SignInPanel";
import type { Note } from "./types";

// The irregular/critical thresholds belong to the server, which is what applies
// them. They arrive in the summary so the labels below can never drift from the
// flags the server actually set.

/** The two screens. Which one is showing is the URL, not a state variable. */
const LOGIN_PATH = "/login";
const DASHBOARD_PATH = "/";

/**
 * How often to ask whether the session is still alive.
 *
 * Comfortably longer than a round trip to a local server, and short enough that
 * a user who left a register open comes back to the login form rather than to
 * numbers produced by a session that ended hours ago. The server's own TTL is 12
 * hours, so this is not racing it - it is noticing the moment it passes.
 */
const SESSION_PROBE_MS = 30_000;

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

/**
 * One CSV field, quoted.
 *
 * Every cell reaching this is a string: the portal's combined attended/held is
 * one, and the percentage is formatted or blanked before it gets here. Typing it
 * `string` rather than `unknown` is the check - `unknown` would have let anything
 * through and turned `String()` into the thing doing the work.
 */
const csvCell = (v: string): string => `"${v.replaceAll('"', '""')}"`;

/* ------------------------------------------------------------------ app */

const App = (): React.JSX.Element => {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const onLogin = pathname === LOGIN_PATH;

  /**
   * Whether the session has been asked about yet.
   *
   * Not a third screen: until `/api/session` answers, the URL could be either,
   * and rendering the dashboard for someone who is not signed in would flash the
   * whole cascade before bouncing them. So the shell renders and the decision
   * waits one round trip.
   */
  const [booted, setBooted] = useState(false);
  /**
   * Whether we believe there is a session.
   *
   * Separate from `booted` because the two answer different questions: `booted`
   * is "have we asked yet", this is "what did the answer say". The URL is not
   * enough on its own - `/login` can be reached by Back from a signed-in
   * dashboard - and without this the guard below only ever ran at mount.
   */
  const [signedIn, setSignedIn] = useState(false);
  const [userId, setUserId] = useState("");
  const [password, setPassword] = useState("");

  const [loginNote, setLoginNote] = useState<Note | null>(null);
  const [filterNote, setFilterNote] = useState<Note | null>(null);
  const [busy, setBusy] = useState(false);
  const [loadNote, setLoadNote] = useState("");
  // Read by the session probe below, which must not be re-armed on every busy
  // flip - otherwise a user who keeps loading registers is never probed at all.
  // Written during render for the same reason the two refs below are.
  /* oxlint-disable react/refs */
  const busyRef = useRef(busy);
  busyRef.current = busy;
  /* oxlint-enable react/refs */

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

  /**
   * Give up the session: drop everything it produced and show the login form.
   *
   * One function, because three things end a session and the state to clear is a
   * dozen setters. Doing it inline per call site is how the "expired" path came
   * to skip most of it: the screen changed to the login form while the previous
   * session's filter, options and register stayed in state, so signing back in
   * produced a table already narrowed by a choice the user made against a
   * session that no longer existed. Signing out deliberately and being timed
   * out should leave the app in the same state, so they share this.
   */
  const signedOut = useCallback(
    (why: string) => {
      // Invalidate anything in flight. A response that arrived after this would
      // otherwise repopulate the very state being cleared.
      refreshToken.current += 1;
      setUserId("");
      setPassword("");
      setSignedIn(false);
      setLoginNote({ kind: "warning", text: why });
      setFilterNote(null);
      setBusy(false);
      setLoadNote("");
      setSel(EMPTY_SEL);
      setOpts(EMPTY_OPTS);
      setResult(null);
      setOnlyIrregular(false);
      // `replace` so the back button does not walk into the session that just
      // ended and find its state still in the DOM behind it.
      navigate(LOGIN_PATH, { replace: true });
    },
    [navigate]
  );

  /* ---- the cascade ---- */

  const runRefresh = useCallback(
    async (changed: Level | null) => {
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
        draft = {
          ...draft,
          semester: "",
          branch: "",
          section: "",
          subject: "",
        };
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

          // Whether to ask again is a rule, not a race, so it lives in cascade.ts
          // with the other cascade rules and has its own tests. The reasoning -
          // why stopping early dead-ends the chain, and why `gained` is what stops
          // the loop running forever - is documented on `shouldContinue`.
          if (!shouldContinue(draft, before, reply)) return;
        }
      } catch (error) {
        if (error instanceof ApiError && error.status === 401) {
          signedOut("Your session expired. Please sign in again.");
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
    },
    [signedOut]
  );

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
      setSignedIn(true);
      navigate(DASHBOARD_PATH, { replace: true });
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
    signedOut("");
  };

  /**
   * Notice a dead session without waiting for a click.
   *
   * The 401 paths only fire when something asks the server for something. A user
   * who leaves a register open and comes back to it hours later would otherwise
   * be reading numbers produced by a session that no longer exists, with
   * nothing on screen to say so - which is the exact failure the register's own
   * name line exists to prevent.
   *
   * The probe stays quiet about failure. A network blip is not evidence that the
   * session died, and signing the user out over one would be worse than the
   * problem; the next real request answers 401 and settles it.
   */
  useEffect(() => {
    if (onLogin) return;
    let cancelled = false;
    const probe = async () => {
      // A request already in flight reports a dead session itself, and two
      // probes at once would only race each other.
      if (busyRef.current) return;
      try {
        const s = await api<SessionReply>("/api/session");
        if (!cancelled && s && !s.signedIn) {
          signedOut("Your session expired. Please sign in again.");
        }
      } catch {
        /* not evidence of anything; the next request decides */
      }
    };
    const id = setInterval(probe, SESSION_PROBE_MS);
    // Coming back to the tab is when a stale register is most likely to be read
    // as current, so it is worth a probe even between intervals.
    document.addEventListener("visibilitychange", probe);
    return () => {
      cancelled = true;
      clearInterval(id);
      document.removeEventListener("visibilitychange", probe);
    };
  }, [onLogin, signedOut]);

  /**
   * Decide which screen the URL is allowed to show, on first load.
   *
   * Asks `/api/session` once, then leaves the URL in charge: the probe above is
   * what catches it going stale. Deep-linking to `/` while signed out lands on
   * `/login`, and deep-linking to `/login` while signed in lands on `/`.
   */
  useEffect(() => {
    if (booted) return;
    (async () => {
      let alive = false;
      try {
        const s = await api<SessionReply>("/api/session");
        // The endpoint answers 200 with {signedIn:false} when signed out, so the
        // check is on the payload and never on the status.
        alive = !!(s && s.signedIn);
      } catch {
        alive = false;
      }
      if (booted) return;
      setBooted(true);
      setSignedIn(alive);
      if (alive) {
        if (!onLogin) {
          // `replace`, so a dead /login in the history is not what Back returns
          // to after a sign-in.
          navigate(DASHBOARD_PATH, { replace: true });
          await runRefresh(null);
        }
      } else if (!onLogin) {
        navigate(LOGIN_PATH, { replace: true });
      }
    })();
  }, [booted, onLogin, navigate, runRefresh]);

  /**
   * A signed-in user who lands on `/login` belongs on the dashboard.
   *
   * Reached by Back from a signed-in dashboard, by a stale bookmark, or by typing
   * the path. The boot guard cannot catch any of them, because it runs once and
   * by then the answer is known - and without this the login form was offered to
   * someone who already had a session, which is the mirror image of the bug the
   * probe fixes.
   */
  useEffect(() => {
    if (booted && signedIn && onLogin) {
      navigate(DASHBOARD_PATH, { replace: true });
    }
  }, [booted, signedIn, onLogin, navigate]);

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
    // The same counter the refresh loop uses, so a session that ends while this
    // is in flight invalidates the reply rather than letting it land on the
    // login screen - which is how the previous session's register used to
    // survive into the next one.
    const token = ++refreshToken.current;
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
      if (token !== refreshToken.current) return;
      setResult(body);
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        signedOut("Your session expired. Please sign in again.");
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

  // Both of these are rules, not arithmetic, so both live in cascade.ts. The
  // `disabled` map in particular is the same dependency condition the server
  // uses to decide what it may derive, and deriving it in one place keeps the
  // two in step.
  const disabled = disabledLevels(sel);

  const summary = result?.summary;
  const rows = result
    ? result.students
        .filter((s) => !onlyIrregular || s.irregular)
        .toSorted((a, b) => (a.pct ?? 999) - (b.pct ?? 999))
    : [];

  const registerName = chosenText(opts, sel);

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

  const onRangeChange = (part: "from" | "to", value: string) => {
    setRange((r) => ({ ...r, [part]: value }));
  };

  /* ---- render ---- */

  // Two routes, not three modes. Each child is told what to render and reports
  // changes upwards; none of them holds state, so the cascade below stays the
  // single place any of it is decided.
  //
  // Three named screens rather than a nested ternary, because there genuinely
  // are three: `booting` renders the header alone, so a deep link to / while
  // signed out does not flash the whole cascade before the guard sends the user
  // to /login.
  let screen: "booting" | "login" | "app" = "booting";
  if (booted) screen = onLogin ? "login" : "app";

  let body: React.JSX.Element | null = null;
  switch (screen) {
    case "login": {
      body = (
        <SignInPanel
          userId={userId}
          password={password}
          busy={busy}
          note={loginNote}
          onUserId={setUserId}
          onPassword={setPassword}
          onSubmit={signIn}
        />
      );
      break;
    }
    case "app": {
      body = (
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
                chosenText={registerName}
              />
            </>
          ) : null}
        </>
      );
      break;
    }
    default: {
      break;
    }
  }

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
          {screen === "app" && userId.trim() ? (
            <Text c="dimmed" size="sm">
              {userId.trim()}
            </Text>
          ) : null}
          {screen === "app" ? (
            <Button variant="default" onClick={signOut}>
              Sign out
            </Button>
          ) : null}
        </Group>
      </Group>

      {body}
    </Container>
  );
};

export default App;
