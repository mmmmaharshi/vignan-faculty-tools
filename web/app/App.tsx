import {
  ActionIcon,
  AppShell,
  Button,
  Container,
  Group,
  Loader,
  Stack,
  Text,
  TextInput,
  Title,
} from "@mantine/core";
import { ArrowClockwise, FloppyDisk, SignOut } from "@phosphor-icons/react";
import React, { useCallback, useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import { useLocation, useNavigate } from "react-router";

import type { OptionsReply, RegisterRequest, Student } from "../../shared/api";
import { messageOf, todayIST } from "../../shared/api";
import {
  clearStoredSession,
  forgetServerData,
  revalidateServerData,
  isExpired,
  reloadSession,
  useOptionsChain,
  useRegisterLoad,
  useSession,
  useSignIn,
  useSignOut,
  useStudentProfile,
  useStudentSearch,
  useFacultyProfile,
  useSemAbsences,
  useUnposted,
} from "../data/client";
import type { RegisterClick, FindClick, ApiError } from "../data/client";
import { useTodayTable } from "../home/today-memory";
import { fullAbsenceList, windowAbsenceList } from "../register/absence-list";
import {
  chosenLevels,
  isAllSubjects,
  chosenFacts,
  disabledLevels,
  selectionAfter,
  EMPTY_OPTS,
  EMPTY_SEL,
  LEVELS,
} from "../register/cascade";
import type { Level, Sel } from "../register/cascade";
import { partialOf } from "../register/cascade-run";
import {
  rememberRangeStart,
  startingRange,
  statedStartIso,
  toPortalDate,
  toInputDate,
} from "../register/range";
import type { Range } from "../register/range";
import { savedClasses } from "../register/saved-classes";
import type { SavedClass } from "../register/saved-classes";
import { searchScope } from "../register/search-scope";
import { useSemStartSettle } from "../register/sem-start-settle";
import { useSavedClasses } from "../register/use-saved-classes";
import {
  NO_FILTER,
  barCounts,
  pruneSubjectBars,
  registerRows,
} from "../register/worklist";
import type { RowFilter } from "../register/worklist";
import { ClassPicker } from "../ui/ClassPicker";
import { HomePanel } from "../ui/HomePanel";
import {
  BarNav,
  DASHBOARD_PATH,
  HOME_PATH,
  LOGIN_PATH,
  PROFILE_PATH,
  RailNav,
  SEARCH_PATH,
  activeTab,
} from "../ui/NavTabs";
import { ProfilePanel } from "../ui/ProfilePanel";
import { RegisterSummary } from "../ui/RegisterSummary";
import { RegisterTable } from "../ui/RegisterTable";
import { SavedClasses } from "../ui/SavedClasses";
import { SignInPanel } from "../ui/SignInPanel";
import { StudentDetails } from "../ui/StudentDetails";
import { UnpostedPanel } from "../ui/UnpostedPanel";
import { loadGate, loadNote as gateNote } from "./load-gate";
import {
  CLOSED_PANEL,
  closePanel,
  finishClose,
  isPanelOpen,
  openPanel,
} from "./panel-state";
import type { PanelState } from "./panel-state";
import { isScreen } from "./paths";
import { nextRoute } from "./route-guard";
import { isBooted, isSignedIn } from "./session-view";
import type { SessionView } from "./session-view";
import type { Note } from "./types";

/** A request the server refused, in words — unless it refused the session,
 *  which the shared failure sweep already ended. One helper, so the fifth
 *  screen does not bring a fifth copy of the same three lines. */
const refusalNote = (error: ApiError | undefined): Note | null =>
  error && !isExpired(error) ? { kind: "error", text: messageOf(error) } : null;
const App = (): React.JSX.Element => {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const onLogin = pathname === LOGIN_PATH;
  const onHome = pathname === HOME_PATH;
  const onProfile = pathname === PROFILE_PATH;
  const onSearch = pathname === SEARCH_PATH;
  /** The dashboard is the default tab: any path no tab names renders its
   *  body, so the default lives once in `activeTab`, not in a second
   *  negation of the named paths here. */
  const onDashboard = activeTab(pathname) === DASHBOARD_PATH;
  const [view, setView] = useState<SessionView>("booting");
  /** The two facts the rest of the file reads, derived from the one state so
   *  they cannot disagree or be set out of order. */
  const booted = isBooted(view);
  const signedIn = isSignedIn(view);
  const [userId, setUserId] = useState("");
  const [password, setPassword] = useState("");
  const [loginNote, setLoginNote] = useState<Note | null>(null);
  /** The warning the form is owed for what the user has not chosen yet. A request
   *  that failed says so on its own, from the hook that failed. */
  const [formNote, setFormNote] = useState<Note | null>(null);
  const [sel, setSel] = useState<Sel>(EMPTY_SEL);
  const [opts, setOpts] = useState<OptionsReply>(EMPTY_OPTS);
  const [range, setRange] = useState<Range>(startingRange);
  /** The click on `Load register` that the table is showing, or null when nobody
   *  has asked for one. The click number is what makes a second click a load. */
  const [click, setClick] = useState<RegisterClick | null>(null);
  /** Which worklist filters are ticked. Ticked bars intersect, so the table
   *  shows the students under every bar set. Held here for the same reason as
   *  the cascade's own state: the table is presentational and keeps none. */
  const [filter, setFilter] = useState<RowFilter>(NO_FILTER);
  /** A header refresh in flight. Held here, not in the header, because the
   *  header is presentational and keeps none. */
  const [refreshing, setRefreshing] = useState(false);
  /** The row whose panel is open, as one state: open, closing (the ~200ms
   *  slide-out that still draws the student), or closed. Two facts before —
   *  `detail` plus `detailOpen` — and a read gated on one but not the other
   *  fired for a panel already leaving. */
  const [panel, setPanel] = useState<PanelState>(CLOSED_PANEL);
  const showDetails = (student: Student) => {
    setPanel(openPanel(student));
  };
  /** Every subject name this session has been offered, by section and value.
   *
   *  The Portal answers subjects one section at a time, so on a cold load a card
   *  naming another section has no label in `opts`. Names are recorded where the
   *  cascade receives them — the only place they arrive — and what is read here
   *  wins over the label stored at save time, so a subject ECAP renames corrects
   *  itself the moment its card is opened. The stored label covers only the cards
   *  this session has not opened.
   *
   *  Keyed by section as well as value: a subject code is short and repeats across
   *  branches, so a card keyed on the value alone could be handed the name of the
   *  same code in a different section.
   *
   *  State rather than a ref, because a card renders these; and set from the reply
   *  rather than from an effect, because an effect that mirrors props into state
   *  starts a render for a value the cascade already computed. */
  const [subjectNames, setSubjectNames] = useState<ReadonlyMap<string, string>>(
    () => new Map()
  );
  /** The saved classes, read when the name becomes known and on the events that
   *  change them. An effect would mirror them into state on every render for
   *  values the browser already has. */
  const [saved, setSaved] = useState<{
    userId: string;
    list: SavedClass[];
  } | null>(null);
  /** The cascade run in flight, as the flag that says the screen has stopped
   *  wanting it: a newer change aborts the one before. */
  const cascadeRun = useRef<AbortController | null>(null);
  /** Set true when a register load is initiated, consumed by the snap effect so
   *  a manual range edit cannot be overridden by a stale register. */
  const justLoaded = useRef(false);
  /** Which end of the range on screen was typed by hand, if either: a typed
   *  range wins over the settle-time snaps and needs no semester-start probe
   *  to load. State, not a ref, because the Load gate reads it while
   *  rendering. Only a typed From lifts the gate — a typed To alone still
   *  leaves From on the unproven month start. */
  const [rangeEdited, setRangeEdited] = useState<"" | "from" | "to">("");
  /** Every fetch the app makes, through its own key. See `web/data/client.ts`. */
  const register = useRegisterLoad(click);
  /* The two callbacks are stable and the state is not, so they are taken apart:
     a callback in a dependency list that changes every render would re-run every
     effect that names it. */
  const {
    trigger: triggerCascade,
    reset: resetCascade,
    isMutating: optionsLoading,
    error: optionsError,
  } = useOptionsChain();
  const login = useSignIn();
  const logout = useSignOut();
  const facultyProfile = useFacultyProfile(Boolean(onProfile));
  /** Home's timetable with its own memory: read when Home is opened, refreshed
   *  behind the cached answer on return, and the cleared evening shows the
   *  day's own table until midnight. ECAP clears the day after ~4pm, so the
   *  read is never older than the visit. */
  const { today, todayShown } = useTodayTable(Boolean(onHome));
  /** Periods across the branch with no posted attendance today: read with the
   *  timetable when Home opens, and a refusal stays in its own section. */
  const unposted = useUnposted(Boolean(onHome));
  const [unpostedBranch, setUnpostedBranch] = useState<string | null>(null);
  /** Student Search: the roll being typed and the ask the panel below the form
   *  is showing. The ask carries a click number for the register's reason — a
   *  search is deliberate, so asking again reads again. */
  const [searchRoll, setSearchRoll] = useState("");
  const [searchClick, setSearchClick] = useState<FindClick | null>(null);
  const search = useStudentSearch(searchClick);
  const found = search.data ?? null;
  /** A request the user is waiting on is already proving the session works, and
   *  the read that would probe it is one more thing competing with it. */
  const busy =
    register.isLoading ||
    optionsLoading ||
    login.isMutating ||
    search.isLoading;
  const session = useSession(busy || onLogin);
  const result = register.data ?? null;
  /* Only a load that actually succeeded re-scopes the screen: `overallMode` is
     the All-subjects path, and the reply carries no subject figure at all. */
  const overallMode = Boolean(result) && isAllSubjects(click?.request.subject);
  const rows = result
    ? registerRows(
        result.students,
        filter,
        overallMode,
        result.summary.subjectColumns
      )
    : [];
  const summary = result?.summary;
  /** How many rows each ticked bar alone would keep: shown beside its
   *  checkbox, so the reader sees what a tick is worth before ticking it. */
  const counts = result
    ? barCounts(result.students, filter.search, overallMode)
    : null;
  /** The semester's probes, its remembered start, and every settle-time From
   *  snap — one hook, so the probes, the memory, and the snaps cannot drift
   *  apart. App keeps the range they snap, the register they follow, and the
   *  just-loaded snap that owns a register already on screen. */
  const { semStart, preSemStart, semStartShown, rememberedStart } =
    useSemStartSettle({
      opts,
      sel,
      range,
      setRange,
      // A typed From is the user's own Till Now and needs no probe; a typed
      // To still leaves From for the snaps to settle.
      rangeEdited,
      result,
      overallMode,
      click,
    });
  /** The student panel's read: profile, absences and semester totals. It needs
   *  the settled semester start, which is why it sits below the settle hook. */
  const profile = useStudentProfile(
    panel.student
      ? {
          roll: panel.student.roll,
          name: panel.student.name,
          register: click?.request,
          // Totals are asked from the semester start to today, the window
          // ECAP's own Cumulative screen uses. Unknown start means no totals:
          // a guessed window would count a period nobody chose.
          semStart: semStartShown ?? undefined,
        }
      : null
  );
  /** Whether the window starts after the remembered start: only then is the
   *  wider read worth asking for. When they coincide the window's own list
   *  already is the full semester's, so the panel shows it as the one list. */
  const startBeforeWindow = Boolean(
    semStartShown && toInputDate(semStartShown) < range.from
  );
  /** The full-semester absent list for the open panel: the same read that fed
   *  the window's own list, asked again over the remembered start. Gated on the
   *  panel being open, not just on a student being set: `closing` survives the
   *  ~200ms slide-out by design, and a register loaded in that window must not
   *  read for a panel that is already leaving. */
  const semAbsences = useSemAbsences(
    isPanelOpen(panel) &&
      panel.student &&
      click?.request &&
      startBeforeWindow &&
      semStartShown
      ? {
          roll: panel.student.roll,
          name: panel.student.name,
          register: click.request,
          from: semStartShown,
        }
      : null
  );
  /** The panel's one absent list: the wider read where the window starts after
   *  the remembered start, else the window's own list — the register row's
   *  cells where it has them, otherwise the Student Wise report the panel
   *  reads for this student. Null where neither has anything to show. */
  const windowAbsences = windowAbsenceList(panel.student, profile.data?.absent);
  const fullAbsencesShown = fullAbsenceList({
    wider: semAbsences.data?.absent,
    semesterStart: semStartShown,
    windowStartsAfterStart: startBeforeWindow,
    window: windowAbsences,
  });
  /** Till Now is the standing window: one gate decides whether Load register
   *  may fire, and the note names the same state. See `web/app/load-gate.ts`. */
  const gateInput = {
    optionsLoading,
    registerLoading: register.isLoading,
    preLoading: preSemStart.isLoading,
    rememberedStart,
    rangeEdited,
  };
  const gate = loadGate(gateInput);
  const loadNote = gateNote(gateInput);
  const failure =
    optionsError ??
    register.error ??
    profile.error ??
    search.error ??
    facultyProfile.error ??
    today.error ??
    unposted.error ??
    semStart.error ??
    preSemStart.error ??
    semAbsences.error;
  const filterNote: Note | null =
    formNote ?? refusalNote(optionsError ?? register.error);
  const profileNote: Note | null = refusalNote(profile.error);
  /** A wider read ECAP would not give is said so, not left silent: no second
   *  list with no reason reads as "no absences in the semester". A 401 has
   *  already ended the session through the sweep above, so it says nothing
   *  here. */
  const semAbsencesNote: Note | null =
    semAbsences.error && !isExpired(semAbsences.error)
      ? {
          kind: "warning",
          text: "ECAP would not give this student's full-semester absences.",
        }
      : null;
  /** Student Search's own sentence: what the server refused, or why there is no
   *  class or no row for that roll. A 401 has already ended the session through
   *  the sweep above, so it says nothing here. */
  const searchNote: Note | null =
    refusalNote(search.error) ??
    (found?.note ? { kind: "warning", text: found.note } : null);
  /** Home's own sentence: what the server refused. An empty day is not this —
   *  it is the skeleton table with blank classes. */
  const todayNote: Note | null = refusalNote(today.error);
  /** The unposted section's own sentence. A 401 has already ended the session
   *  through the sweep above, so it says nothing here. */
  const unpostedNote: Note | null = refusalNote(unposted.error);
  const savedList = saved?.userId === userId && userId ? saved.list : null;
  /** The class and window a searched figure belongs to, named on the panel: a
   *  percentage with no period under it invites being read as a semester's. An
   *  inferred semester is marked as one, so a guess never prints as a fact. */
  const scopeRows = searchScope(found);
  /** The name arriving is also the moment the saved classes become readable, so
   *  both are set together: a restore never went through the sign-in form. The
   *  stored values are not applied to the cascade here — filling the form is the
   *  saved class being opened, and nothing else. */
  const noteUserId = useCallback((name: string): void => {
    setUserId(name);
    setSaved(name ? { userId: name, list: savedClasses(name) } : null);
  }, []);
  const signedOut = useCallback(
    (why: string) => {
      cascadeRun.current?.abort();
      // The Portal's answers belong to the session that read them, so they leave
      // with it rather than waiting on the next person's screen. The cache sweep
      // is not enough on its own: a mutation's failure is the hook's own state,
      // so a 401 left there would sit in the next session's class picker.
      resetCascade();
      void forgetServerData();
      // The session is the browser's to drop: the server keeps nothing.
      clearStoredSession();
      setClick(null);
      // A find ask left armed outlives the session: its key carries the epoch,
      // so signing out changes the key and the ask is re-sent for a session that
      // no longer exists. The roll is also the previous user's, so it leaves with
      // them rather than opening the next person's Search screen on it.
      setSearchClick(null);
      setSearchRoll("");
      setUserId("");
      setPassword("");
      setView("signedOut");
      setLoginNote(why ? { kind: "warning", text: why } : null);
      setFormNote(null);
      setSel(EMPTY_SEL);
      setOpts(EMPTY_OPTS);
      setFilter(NO_FILTER);
      setPanel(CLOSED_PANEL);
      setUnpostedBranch(null);
      // The saved section is the previous user's, so it leaves the screen with
      // them. What is in storage is theirs to find again on sign-in.
      setSaved(null);
      setSubjectNames(new Map());
      navigate(LOGIN_PATH, { replace: true });
    },
    [navigate, resetCascade]
  );
  /** Settles the cascade for a selection. Both arguments are values rather than
   *  state read inside: a pass is built before React has committed the render that
   *  produced it, so a version closing over `sel` or `opts` would ask the Portal
   *  about the selection before last. */
  const runRefresh = useCallback(
    async (seed: Sel, known: OptionsReply) => {
      cascadeRun.current?.abort();
      const run = new AbortController();
      cascadeRun.current = run;
      // A new settle is a new class context: a range typed for the last one
      // no longer guards From against the settle-time snap.
      setRangeEdited("");
      setFormNote(null);
      const outcome = await triggerCascade({
        seed,
        known,
        signal: run.signal,
      }).catch((error: unknown) => {
        // A run that failed after settling keeps what arrived on screen
        // beside the failure, so fetched courses are not discarded with the
        // failed pass. The error itself still reaches the alert and the
        // sign-out sweep unchanged.
        const partial = partialOf(error);
        if (partial && !run.signal.aborted) {
          setSel(partial.sel);
          setOpts(partial.opts);
          setSubjectNames(
            (previous) => new Map([...previous, ...partial.names])
          );
        }
        return null;
      });
      // A run the screen stopped wanting answers null, and a run that was
      // superseded while it settled is dropped here: the newer one is the one on
      // screen.
      if (!outcome || run.signal.aborted) return;
      setSel(outcome.sel);
      setOpts(outcome.opts);
      setSubjectNames((previous) => new Map([...previous, ...outcome.names]));
      // A new settle is a new class context for the ticked subject bars too:
      // a bar naming a subject this class does not offer would narrow a
      // roster with no column on screen saying so.
      setFilter((f) => {
        if (!f.subjectBars.length) return f;
        const offered = outcome.opts.subject
          .filter((o) => !isAllSubjects(o))
          .map((o) => o.label);
        const kept = pruneSubjectBars(f.subjectBars, offered);
        return kept.length === f.subjectBars.length
          ? f
          : { ...f, subjectBars: kept };
      });
    },
    [triggerCascade]
  );
  /** The failed options read, asked again from the selection on screen: with
   *  no course there is no level to change, so without this the picker sits
   *  in its error until a reload. A run that then succeeds settles the same
   *  way a fresh one does, keeping whatever the new options still offer. */
  const retryOptions = useCallback(() => {
    void runRefresh(sel, opts);
  }, [runRefresh, sel, opts]);
  /** The saved classes: the cards above the class form, and the three actions
   *  on them. App keeps the list itself, because signing out clears it. */
  const savedClassesView = useSavedClasses({
    userId,
    sel,
    opts,
    savedList,
    subjectNames,
    registerData: register.data ?? null,
    setSaved,
    setSel,
    runRefresh,
  });
  const { classChosen, cards: savedClassCards } = savedClassesView;
  /** Re-reads the screen in place: server data revalidates, and the dashboard
   *  re-settles its cascade too — the selection stays, so unlike a reload
   *  nothing the picker holds is lost. The register is never re-read here:
   *  the click stays its only fetch. */
  const refreshScreen = async (): Promise<void> => {
    if (refreshing || busy) return;
    setRefreshing(true);
    try {
      // Independent re-reads, asked together: neither waits on the other,
      // and neither rejection survives — each hook surfaces its own error.
      await Promise.allSettled([
        onDashboard ? runRefresh(sel, opts) : Promise.resolve(),
        revalidateServerData(),
      ]);
    } finally {
      setRefreshing(false);
    }
  };
  const loadRegister = () => {
    // The button is busy while the gate holds, so this is unreachable through
    // it; it stays as the rule's second half for any other caller.
    if (gate === "finding-start") return;
    setFormNote(null);
    if (!range.from || !range.to) {
      setFormNote({ kind: "warning", text: "Choose a date range." });
      return;
    }
    const chosen = chosenLevels(opts, sel);
    if (!chosen.ok) {
      setFormNote({
        kind: "warning",
        text: `Choose a ${chosen.label.toLowerCase()} first.`,
      });
      return;
    }
    // Armed only once the ask is real: a refused load that left it set would be
    // overridden by the previous register's first day on the next settle.
    justLoaded.current = true;
    const request: RegisterRequest = {
      ...chosen.levels,
      from: toPortalDate(range.from),
      to: toPortalDate(range.to),
    };
    // A new register replaces the table, so a panel opened from the old one goes:
    // it would otherwise show one student's numbers beside a table they need not
    // be in.
    setPanel(CLOSED_PANEL);
    // A name or roll typed for the last class does not belong to this one: it
    // would hide every row of the new register behind a search nobody typed for
    // it. The ticked bars stay — they are a standing intent about attendance.
    setFilter((f) => (f.search === "" ? f : { ...f, search: "" }));
    setClick((previous) => ({
      request,
      attempt: (previous?.attempt ?? 0) + 1,
    }));
    // The range someone asked for is the one worth opening at again.
    rememberRangeStart(range.from);
  };
  /** A roll number is the whole ask: the class comes from the student's own ECAP
   *  page, and the window from where the app opens at. Nothing is fetched per
   *  keystroke — the form submits, and one search is one read. */
  const findStudent = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const roll = searchRoll.trim();
    if (!roll) return;
    const window = startingRange();
    setSearchClick((previous) => ({
      request: {
        roll,
        from: toPortalDate(window.from),
        to: toPortalDate(window.to),
      },
      attempt: (previous?.attempt ?? 0) + 1,
    }));
  };
  const signIn = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setLoginNote(null);
    const name = userId.trim();
    try {
      await login.trigger({ userId: name, password });
      setPassword("");
      // The session the server has just made is the truth about itself, so ask
      // it rather than assert it here.
      const started = await reloadSession();
      if (!started?.signedIn) {
        throw new Error("The session did not start. Sign in again.");
      }
      setView("signedIn");
      noteUserId(started.userId || name);
      navigate(HOME_PATH, { replace: true });
      await runRefresh(EMPTY_SEL, EMPTY_OPTS);
    } catch (error) {
      setLoginNote({ kind: "error", text: messageOf(error) });
    }
  };
  const signOut = async () => {
    await logout.trigger(undefined).catch(() => null);
    signedOut("");
  };
  /*
   * The three effects below are where the app's own view of the session meets
   * what the server has just said: the boot check, the expiry, and which route a
   * session puts you on. Each answers an external read with app state, which is
   * what they are for, and each is guarded so it runs once per change.
   */
  /* oxlint-disable react/set-state-in-effect */
  /** The probe: a session that was working and now is not says so, and why. A
   *  session that was never there is the boot check's business, which says
   *  nothing. */
  useEffect(() => {
    if (!booted || !signedIn) return;
    if (session.data && !session.data.signedIn) {
      signedOut("Your session expired. Please sign in again.");
    }
  }, [booted, signedIn, session.data, signedOut]);
  /**
   * The boot check: whether there is a session at all, and what it says.
   *
   * A probe that failed is not an answer. ECAP not answering is a transport
   * failure, and treating it as "signed out" sends someone whose stored session
   * is perfectly good to the sign-in form, where the hook is paused and nothing
   * asks again. So a first failure is retried once, and a second one falls back
   * to the form with the reason on it rather than a silent one.
   */
  const [bootRetried, setBootRetried] = useState(false);
  useEffect(() => {
    if (booted || session.isLoading) return;
    if (!session.data) {
      if (!bootRetried) {
        setBootRetried(true);
        void reloadSession();
        return;
      }
      setLoginNote({
        kind: "warning",
        text: "ECAP did not answer. Sign in again if this screen does not go away.",
      });
      setView("signedOut");
      if (!onLogin) navigate(LOGIN_PATH, { replace: true });
      return;
    }
    const alive = session.data.signedIn;
    setView(alive ? "signedIn" : "signedOut");
    if (!alive) {
      if (!onLogin) navigate(LOGIN_PATH, { replace: true });
      return;
    }
    // A restored session never went through the sign-in form, so this is the
    // only place the name can arrive. Without it the rail and the profile panel
    // show a dash for a session that is working.
    if (session.data.userId) noteUserId(session.data.userId);
    if (!onLogin && !isScreen(pathname)) {
      navigate(HOME_PATH, { replace: true });
    }
    if (!onLogin) void runRefresh(EMPTY_SEL, EMPTY_OPTS);
  }, [
    booted,
    session.isLoading,
    session.data,
    bootRetried,
    onLogin,
    pathname,
    navigate,
    runRefresh,
    noteUserId,
    setLoginNote,
  ]);
  /** A 401 is ECAP refusing the session, from whichever request met it: the app
   *  signs out through the one path, so nothing goes on showing the numbers of a
   *  session that no longer exists. A 502 evicts nothing — it is ambiguous, and
   *  ADR 0002 and ADR 0013 both refuse to treat it as an expiry. */
  useEffect(() => {
    if (isExpired(failure)) {
      signedOut("Your session expired. Please sign in again.");
    }
  }, [failure, signedOut]);
  /** After a load, the From input names where the register itself starts: the
   *  Portal keeps nothing before the semester began, so the figures on screen
   *  begin there even when an older date was asked for, and the input should
   *  say the same thing the table does. The clicked request lives in the SWR
   *  key, so this state change cannot trigger a refetch. */
  useEffect(() => {
    if (!justLoaded.current) return;
    justLoaded.current = false;
    let stated = register.data?.summary.statedFrom ?? "";
    if (!stated && register.data?.summary.dates?.length) {
      stated = statedStartIso(register.data.summary.dates, range) ?? "";
    }
    const iso = toInputDate(stated);
    if (!iso || iso === range.from) return;
    rememberRangeStart(iso);
    setRange((r) => ({ ...r, from: iso }));
  }, [register.data, range]);
  /* oxlint-enable react/set-state-in-effect */
  useEffect(() => {
    // A signed-in user lands on /login only via Back: the first effect runs
    // once, so this is the writer that sends them back to the landing screen.
    const target = nextRoute(pathname, { booted, signedIn });
    if (target && pathname === LOGIN_PATH) {
      navigate(target, { replace: true });
    }
  }, [booted, signedIn, pathname, navigate]);
  const disabled = disabledLevels(sel);
  // No sort: the rows are the Portal's own roster order, which the Sl.No column
  // carries. Reordering them by attendance made the numbers read as a ranking
  // rather than as a roster. A student needing a check-in is found by the tint,
  // not by being at the top of the list.
  const registerFacts = click
    ? chosenFacts(click.request, opts, {
        range: summary?.range,
        classesHeld: summary?.classesHeld,
        // The Date Range names the window the figures on screen cover: the
        // register's own first day where it stated one, else the window asked
        // for. The probe's day is NOT that — the class report covers the whole
        // window — so it belongs in the Sem Start Date row alone.
        statedFrom: summary?.statedFrom,
        semStart: semStartShown,
      })
    : [];
  const onSelectLevel = (key: Level, value: string) => {
    const changed = { ...sel, [key]: value };
    // The subject has nothing below it, so it re-reads nothing; every other level
    // invalidates what is under it, and the screen shows that immediately.
    // Either way the selection moved on, so a range typed for the last one no
    // longer guards From against the settle-time snaps.
    if (key === "subject") {
      setRangeEdited("");
      setSel(changed);
      return;
    }
    const next = selectionAfter(changed, key);
    setSel(next);
    void runRefresh(next, opts);
  };
  const onRangeChange = (part: "from" | "to", value: string) => {
    justLoaded.current = false;
    setRangeEdited(part);
    setRange((r) => ({ ...r, [part]: value }));
  };
  const saveClass = () => {
    savedClassesView.save();
  };
  const clearSavedClass = (target: Sel) => {
    savedClassesView.clear(target);
  };
  /** Opening a saved class fills all five levels and nothing else: no register
   *  is fetched, and Load register stays a decision. */
  const applySavedClass = (target: Sel) => {
    savedClassesView.apply(target);
  };
  let screen: "booting" | "login" | "app" = "booting";
  if (booted) screen = onLogin ? "login" : "app";
  const picker = (
    <ClassPicker
      levels={LEVELS}
      opts={opts}
      sel={sel}
      disabled={disabled}
      range={range}
      busy={busy}
      loadNote={loadNote}
      loadWaiting={gate === "finding-start"}
      filterNote={filterNote}
      onSelect={onSelectLevel}
      onRange={onRangeChange}
      onLoad={loadRegister}
      onRetryOptions={
        optionsError && !optionsLoading ? retryOptions : undefined
      }
      trailing={
        <Button
          onClick={saveClass}
          disabled={!classChosen || !userId.trim()}
          leftSection={<FloppyDisk size={18} aria-hidden />}
        >
          Save this class
        </Button>
      }
    />
  );
  let body: React.JSX.Element | null = null;
  switch (screen) {
    case "booting": {
      body = (
        <Stack align="center" mt="xl" gap="sm">
          <Loader size="lg" />
          <Text c="dimmed" size="sm">
            Loading...
          </Text>
        </Stack>
      );
      break;
    }
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
      if (onHome) {
        body = (
          <>
            <HomePanel
              classes={todayShown}
              busy={today.isLoading}
              note={todayNote}
              date={todayIST()}
            />
            <UnpostedPanel
              sections={unposted.data?.sections ?? null}
              busy={unposted.isLoading}
              note={unpostedNote}
              branch={unpostedBranch}
              onBranchChange={setUnpostedBranch}
            />
          </>
        );
      } else if (onProfile) {
        body = (
          <>
            <ProfilePanel
              userId={userId}
              faculty={facultyProfile.data ?? null}
              busy={facultyProfile.isLoading}
            />
            {/* The rail holds Sign out on desktop. There is no drawer on a
                phone, so the screen about the signed-in user carries it. */}
            <Group hiddenFrom="sm" justify="flex-end" mt="lg">
              <Button
                onClick={signOut}
                variant="default"
                leftSection={<SignOut size={18} aria-hidden />}
              >
                Sign out
              </Button>
            </Group>
          </>
        );
      } else if (onSearch) {
        body = (
          <>
            <form onSubmit={findStudent}>
              <Group align="flex-end" gap="sm">
                <TextInput
                  label="Roll number"
                  placeholder="21CS001"
                  value={searchRoll}
                  onChange={(e) => setSearchRoll(e.currentTarget.value)}
                  flex={1}
                />
                <Button type="submit" loading={search.isLoading}>
                  Search
                </Button>
              </Group>
            </form>
            <StudentDetails
              student={found?.student ?? null}
              inline
              profile={found?.profile ?? null}
              busy={search.isLoading}
              note={searchNote}
              scope={scopeRows}
              fullAbsent={found?.fullAbsent ?? null}
              fullTitle="Absent — full semester"
            />
          </>
        );
      } else {
        body = (
          <>
            {savedClassCards.length ? (
              <SavedClasses
                classes={savedClassCards}
                onOpen={applySavedClass}
                onForget={clearSavedClass}
              />
            ) : null}
            {picker}
            {summary ? (
              <RegisterSummary
                summary={summary}
                scope={overallMode ? "overall" : "subject"}
              />
            ) : null}
            {summary ? (
              <RegisterTable
                rows={rows}
                total={result?.students.length ?? 0}
                summary={summary}
                filter={filter}
                counts={counts}
                onFilterChange={setFilter}
                onShowDetails={showDetails}
                chosen={registerFacts}
                overallMode={overallMode}
              />
            ) : null}
            <StudentDetails
              student={panel.student}
              opened={isPanelOpen(panel)}
              onClose={() => setPanel(closePanel(panel))}
              onExitTransitionEnd={() => setPanel(finishClose(panel))}
              profile={profile.data ?? null}
              busy={profile.isLoading}
              note={profileNote ?? semAbsencesNote}
              fullAbsent={fullAbsencesShown}
              fullTitle={
                overallMode
                  ? "Absent — full semester"
                  : "Absent — full semester, this subject"
              }
            />
          </>
        );
      }
      break;
    }
    default: {
      break;
    }
  }
  return (
    <AppShell
      header={{ height: 60 }}
      padding="lg"
      navbar={{
        width: 300,
        breakpoint: "sm",
        collapsed: { mobile: true, desktop: screen !== "app" },
      }}
      footer={{
        height: { base: "calc(64px + env(safe-area-inset-bottom))", sm: 0 },
      }}
    >
      <AppShell.Header>
        <Group h="100%" px="md" align="center" gap="sm" justify="space-between">
          <Title order={3}>Vignan Faculty Tools</Title>
          {screen === "app" ? (
            <ActionIcon
              onClick={refreshScreen}
              loading={refreshing}
              disabled={busy}
              variant="default"
              size="lg"
              aria-label="Refresh"
            >
              <ArrowClockwise size={18} aria-hidden />
            </ActionIcon>
          ) : null}
        </Group>
      </AppShell.Header>
      <AppShell.Navbar p="md" pb="xs" visibleFrom="sm">
        <AppShell.Section grow>
          <RailNav active={activeTab(pathname)} onNavigate={navigate} />
        </AppShell.Section>
        <AppShell.Section>
          <Stack gap="xs">
            {screen === "app" && userId.trim() ? (
              <Text c="dimmed" size="sm">
                {userId.trim()}
              </Text>
            ) : null}
            {screen === "app" ? (
              <Button
                onClick={signOut}
                variant="default"
                leftSection={<SignOut size={18} aria-hidden />}
                fullWidth
                justify="flex-start"
              >
                Sign out
              </Button>
            ) : null}
          </Stack>
        </AppShell.Section>
      </AppShell.Navbar>
      <AppShell.Main
        pb={{ base: "calc(64px + env(safe-area-inset-bottom))", sm: "lg" }}
      >
        {screen === "app" ? (
          body
        ) : (
          <Container size="sm" py="xl">
            {body}
          </Container>
        )}
      </AppShell.Main>
      {/* Tabs, not buttons: icon over label, no fill, colour says which screen.
          An UnstyledButton is the one Mantine component that carries no button
          chrome. The footer grows by the safe-area inset and pads it away, so
          the home indicator sits below the tabs rather than over them. Its own
          background is what the phone shows in that gesture area, so it is
          white on purpose rather than the theme default. */}
      <AppShell.Footer
        hiddenFrom="sm"
        pb="env(safe-area-inset-bottom)"
        bg="white"
      >
        {screen === "app" ? (
          <BarNav active={activeTab(pathname)} onNavigate={navigate} />
        ) : null}
      </AppShell.Footer>
    </AppShell>
  );
};
export default App;
