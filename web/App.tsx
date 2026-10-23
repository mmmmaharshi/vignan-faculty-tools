import {
  AppShell,
  Burger,
  Button,
  Container,
  Group,
  Loader,
  Stack,
  Text,
  TextInput,
  Title,
} from "@mantine/core";
import { useDisclosure } from "@mantine/hooks";
import {
  FloppyDisk,
  MagnifyingGlass,
  SignOut,
  SquaresFour,
  UserCircle,
} from "@phosphor-icons/react";
import React, { useCallback, useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import { useLocation, useNavigate } from "react-router";

import type {
  OptionsReply,
  RegisterReply,
  RegisterRequest,
  SemStartReply,
  Student,
} from "../shared/api";
import {
  chosenLevels,
  isAllSubjects,
  chosenFacts,
  disabledLevels,
  rememberRangeStart,
  selectionAfter,
  startingRange,
  EMPTY_OPTS,
  EMPTY_SEL,
  LEVELS,
  subjectNameKey,
  toPortalDate,
  toInputDate,
  statedStartDate,
} from "./cascade";
import type { Level, Range, Sel } from "./cascade";
import {
  clearStoredSession,
  forgetServerData,
  isExpired,
  messageOf,
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
  useSemStart,
} from "./client";
import type { RegisterClick, FindClick } from "./client";
import { ClassPicker } from "./components/ClassPicker";
import { ProfilePanel } from "./components/ProfilePanel";
import { RegisterSummary } from "./components/RegisterSummary";
import { RegisterTable } from "./components/RegisterTable";
import { SavedClasses } from "./components/SavedClasses";
import { SignInPanel } from "./components/SignInPanel";
import { StudentDetails } from "./components/StudentDetails";
import {
  abbreviate,
  rememberClass,
  savedClasses,
  forgetClass,
} from "./saved-classes";
import type { SavedClass } from "./saved-classes";
import {
  noteSemStart,
  readSemStarts,
  semStartKey,
  writeSemStarts,
} from "./sem-starts";
import type { SemStarts } from "./sem-starts";
import type { Note } from "./types";
import { NO_FILTER, registerRows } from "./worklist";
import type { RowFilter } from "./worklist";

const LOGIN_PATH = "/login";
const DASHBOARD_PATH = "/dashboard";
const PROFILE_PATH = "/profile";
const SEARCH_PATH = "/search";
const App = (): React.JSX.Element => {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const onLogin = pathname === LOGIN_PATH;
  const onProfile = pathname === PROFILE_PATH;
  const onSearch = pathname === SEARCH_PATH;
  /** The screen the Attendance button stands for: not the two beside it. */
  const onDashboard = !onLogin && !onProfile && !onSearch;
  const [booted, setBooted] = useState(false);
  const [signedIn, setSignedIn] = useState(false);
  const [userId, setUserId] = useState("");
  const [password, setPassword] = useState("");
  const [loginNote, setLoginNote] = useState<Note | null>(null);
  /** The warning the form is owed for what the user has not chosen yet. A request
   *  that failed says so on its own, from the hook that failed. */
  const [formNote, setFormNote] = useState<Note | null>(null);
  const [navOpen, nav] = useDisclosure();
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
  const applyFilter = (patch: Partial<RowFilter>): void => {
    setFilter((f) => ({ ...f, ...patch }));
  };
  /** The row whose panel is open. Held here, not in the table, because the table
   *  is a presentational module with no state of its own. */
  const [detail, setDetail] = useState<Student | null>(null);
  /** Whether that panel is showing. Two facts, not one, because the drawer slides
   *  out for ~200ms after `opened` goes false: `detail` is what it draws with
   *  while it leaves, and it is dropped only when the slide-out ends. Held here
   *  for the same reason as `detail`. */
  const [detailOpen, setDetailOpen] = useState(false);
  const showDetails = (student: Student) => {
    setDetail(student);
    setDetailOpen(true);
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
  /** The probe answer the All subjects snap already ran for (see below). A ref
   *  rather than state: it guards an effect and must never render. */
  const semSnapApplied = useRef<SemStartReply | null>(null);
  /** Every fetch the app makes, through its own key. See `web/client.ts`. */
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
  const profile = useStudentProfile(
    detail
      ? { roll: detail.roll, name: detail.name, register: click?.request }
      : null
  );
  const facultyProfile = useFacultyProfile(Boolean(onProfile));
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
  const rows = result ? registerRows(result.students, filter, overallMode) : [];
  const summary = result?.summary;
  /** The All subjects report states no dates, so its first day is read from one
   *  subject's own register instead: the first subject this session was offered,
   *  over the same range, asked once per register and never revalidated. A probe
   *  that fails changes nothing — the register on screen is complete without
   *  it — except a 401, which still ends the session through the sweep below. */
  const semProbeSubject =
    result && overallMode
      ? (opts.subject.find((o) => !isAllSubjects(o)) ?? null)
      : null;
  const semStart = useSemStart(
    result && overallMode && semProbeSubject && click?.request
      ? { ...click.request, subject: semProbeSubject }
      : null
  );
  /** The earliest start day ever seen for the class on screen, remembered in
   *  `sem-starts.ts`: the probe (or the register's own grid) only ever sees the
   *  asked window, so without this a later From would move "Sem Start Date"
   *  forward to the window's first day instead of the semester's. Keyed by the
   *  five levels plus the Portal's batch title, so a new year starts a new
   *  memory. Portal data, not personal data: it is not scoped by user id. */
  const [semStarts, setSemStarts] = useState<SemStarts>(() => readSemStarts());
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
          opts.semester.find((o) => String(o.value) === sel.semester)?.title ??
            ""
        )
      : null;
  const semSeen = summary?.statedFrom ?? semStart.data?.statedFrom ?? null;
  const semStartShown = (semKey && (semStarts[semKey] ?? semSeen)) || null;
  /** The full-semester absent list for the open panel: the same read that fed
   *  the window's own list, asked again over the remembered start. Gated on the
   *  drawer being open, not just on a student being set: `detail` survives the
   *  ~200ms slide-out by design, and a register loaded in that window must not
   *  read for a panel that is already leaving. Only when the window starts
   *  after the remembered start — when they coincide the list on screen
   *  already is the full semester, and there is no second list to show. */
  const semAbsences = useSemAbsences(
    detailOpen &&
      detail &&
      click?.request &&
      semStartShown &&
      toInputDate(semStartShown) < range.from
      ? {
          roll: detail.roll,
          name: detail.name,
          register: click.request,
          from: semStartShown,
        }
      : null
  );
  const classChosen =
    Boolean(sel.course) &&
    Boolean(sel.semester) &&
    Boolean(sel.branch) &&
    Boolean(sel.section) &&
    // ALL SUBJECTS is not a subject, so it cannot be the one a card reopens.
    Boolean(sel.subject) &&
    !isAllSubjects(opts.subject.find((o) => String(o.value) === sel.subject));
  const rememberCurrentClass = useCallback(() => {
    if (!userId || !classChosen) return;
    rememberClass(
      userId,
      sel,
      opts.subject.find((o) => String(o.value) === sel.subject)?.label ?? ""
    );
    setSaved({ userId, list: savedClasses(userId) });
  }, [userId, classChosen, sel, opts]);
  /** Persist the class only once its register has actually loaded, so a failed
   *  or ambiguous request never saves a card and "Load register stays a decision"
   *  (ADR 0016). rememberClass dedupes, so re-loading the same class just moves
   *  it to the front. */
  const lastSavedRegister = useRef<RegisterReply | null>(null);
  useEffect(() => {
    if (!userId || !classChosen || !register.data) return;
    if (register.data === lastSavedRegister.current) return;
    lastSavedRegister.current = register.data;
    rememberCurrentClass();
  }, [userId, classChosen, register.data, rememberCurrentClass]);
  let loadNote = "";
  if (optionsLoading) {
    loadNote = "Loading options...";
  } else if (register.isLoading) {
    loadNote = "Reading the register from ECAP...";
  }
  const failure =
    optionsError ??
    register.error ??
    profile.error ??
    search.error ??
    facultyProfile.error ??
    semStart.error ??
    semAbsences.error;
  const filterNote: Note | null =
    formNote ??
    (optionsError || register.error
      ? { kind: "error", text: messageOf(optionsError ?? register.error) }
      : null);
  const profileNote: Note | null = profile.error
    ? { kind: "error", text: messageOf(profile.error) }
    : null;
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
  let searchNote: Note | null = null;
  if (search.error && !isExpired(search.error)) {
    searchNote = { kind: "error", text: messageOf(search.error) };
  } else if (found?.note) {
    searchNote = { kind: "warning", text: found.note };
  }
  const savedList = saved?.userId === userId && userId ? saved.list : null;
  /** The class and window a searched figure belongs to, named on the panel: a
   *  percentage with no period under it invites being read as a semester's. An
   *  inferred semester is marked as one, so a guess never prints as a fact. */
  const searchScope = found?.class
    ? `${[
        found.class.course.label,
        found.class.semesterInferred
          ? `${found.class.semester.label} (inferred)`
          : found.class.semester.label,
        found.class.branch.label,
        found.class.section?.label ?? "",
      ]
        .filter(Boolean)
        .join(" · ")} · ${found.window.from} to ${found.window.to}`
    : undefined; /** The name arriving is also the moment the saved classes become readable, so
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
      setUserId("");
      setPassword("");
      setSignedIn(false);
      setLoginNote(why ? { kind: "warning", text: why } : null);
      setFormNote(null);
      setSel(EMPTY_SEL);
      setOpts(EMPTY_OPTS);
      setFilter(NO_FILTER);
      setDetail(null);
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
      setFormNote(null);
      const outcome = await triggerCascade({
        seed,
        known,
        signal: run.signal,
      }).catch(() => null);
      // A run the screen stopped wanting answers null, and a run that was
      // superseded while it settled is dropped here: the newer one is the one on
      // screen.
      if (!outcome || run.signal.aborted) return;
      setSel(outcome.sel);
      setOpts(outcome.opts);
      setSubjectNames((previous) => new Map([...previous, ...outcome.names]));
    },
    [triggerCascade]
  );
  const loadRegister = () => {
    justLoaded.current = true;
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
    const request: RegisterRequest = {
      ...chosen.levels,
      from: toPortalDate(range.from),
      to: toPortalDate(range.to),
    };
    // A new register replaces the table, so a panel opened from the old one goes:
    // it would otherwise show one student's numbers beside a table they need not
    // be in.
    setDetail(null);
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
      setBooted(true);
      setSignedIn(true);
      noteUserId(started.userId || name);
      navigate(DASHBOARD_PATH, { replace: true });
      nav.close();
      await runRefresh(EMPTY_SEL, EMPTY_OPTS);
    } catch (error) {
      setLoginNote({ kind: "error", text: messageOf(error) });
    }
  };
  const signOut = async () => {
    await logout.trigger(undefined).catch(() => null);
    nav.close();
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
  /** When the portal answers "no courses" there is nothing to pick from and
   *  nothing to load: every account has at least one course, so an empty
   *  course list means the session is gone or ECAP is not answering. Either
   *  way there is nothing to do on the dashboard, so go to login instead of
   *  leaving an alert on screen. Other empty levels (branch, semester, section,
   *  subject) are genuine "this combination does not run" cases and keep their
   *  alert. */
  const checkedEmptyLevels = useRef(false);
  useEffect(() => {
    if (!booted || !signedIn) return;
    if (!opts.emptyLevels.includes("course")) {
      checkedEmptyLevels.current = false;
      return;
    }
    if (checkedEmptyLevels.current) return;
    checkedEmptyLevels.current = true;
    signedOut("ECAP returned no courses. Please sign in again.");
  }, [booted, signedIn, opts.emptyLevels, signedOut]);
  /** The boot check: whether there is a session at all, and what it says. */
  useEffect(() => {
    if (booted || session.isLoading) return;
    setBooted(true);
    const alive = Boolean(session.data?.signedIn);
    setSignedIn(alive);
    if (!alive) {
      if (!onLogin) navigate(LOGIN_PATH, { replace: true });
      return;
    }
    // A restored session never went through the sign-in form, so this is the
    // only place the name can arrive. Without it the rail and the profile panel
    // show a dash for a session that is working.
    if (session.data?.userId) noteUserId(session.data.userId);
    if (!onLogin && !onProfile && !onSearch) {
      navigate(DASHBOARD_PATH, { replace: true });
    }
    if (!onLogin) void runRefresh(EMPTY_SEL, EMPTY_OPTS);
  }, [
    booted,
    session.isLoading,
    session.data,
    onLogin,
    onProfile,
    onSearch,
    navigate,
    runRefresh,
    noteUserId,
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
      stated = statedStartDate(register.data.summary.dates, range) ?? "";
    }
    const iso = toInputDate(stated);
    if (!iso || iso === range.from) return;
    rememberRangeStart(iso);
    setRange((r) => ({ ...r, from: iso }));
  }, [register.data, range]);
  /** The All subjects snap: the probe's first day plays the role the register's
   *  own `statedFrom` plays on the subject path, so From, Date Range and Sem
   *  Start Date all name it. Runs once per probe answer, so a manual edit made
   *  afterwards is never snapped back. */
  useEffect(() => {
    const answer = semStart.data;
    if (!answer?.statedFrom || answer === semSnapApplied.current) return;
    semSnapApplied.current = answer;
    const iso = toInputDate(answer.statedFrom);
    if (!iso || iso === range.from) return;
    rememberRangeStart(iso);
    setRange((r) => ({ ...r, from: iso }));
  }, [semStart.data, range]);
  /** Fold the window's first day into the earliest-start memory: without this a
   *  later From would move "Sem Start Date" forward to the window's first day
   *  instead of the semester's (the memory lives in `sem-starts.ts`). */
  useEffect(() => {
    if (!semKey || !semSeen) return;
    setSemStarts((prev) => {
      const next = noteSemStart(prev, semKey, semSeen);
      if (next !== prev) writeSemStarts(next);
      return next;
    });
  }, [semKey, semSeen]);
  /* oxlint-enable react/set-state-in-effect */
  useEffect(() => {
    if (booted && signedIn && onLogin) {
      navigate(DASHBOARD_PATH, { replace: true });
    }
  }, [booted, signedIn, onLogin, navigate]);
  const disabled = disabledLevels(sel);
  // No sort: the rows are the Portal's own roster order, which the Sl.No column
  // carries. Reordering them by attendance made the numbers read as a ranking
  // rather than as a roster. A student needing a check-in is found by the tint,
  // not by being at the top of the list.
  const registerFacts = chosenFacts(opts, sel, {
    range: summary?.range,
    classesHeld: summary?.classesHeld,
    // The Date Range names the window the figures on screen cover: the
    // register's own first day where it stated one, else the window asked for.
    // The probe's day is NOT that — the class report covers the whole window —
    // so it belongs in the Sem Start Date row alone.
    statedFrom: summary?.statedFrom,
    semStart: semStartShown,
  });
  const onSelectLevel = (key: Level, value: string) => {
    const changed = { ...sel, [key]: value };
    // The subject has nothing below it, so it re-reads nothing; every other level
    // invalidates what is under it, and the screen shows that immediately.
    if (key === "subject") {
      setSel(changed);
      return;
    }
    const next = selectionAfter(changed, key);
    setSel(next);
    void runRefresh(next, opts);
  };
  const onRangeChange = (part: "from" | "to", value: string) => {
    justLoaded.current = false;
    setRange((r) => ({ ...r, [part]: value }));
  };
  const saveClass = () => {
    rememberCurrentClass();
  };
  const clearSavedClass = (target: Sel) => {
    forgetClass(userId, target);
    setSaved({ userId, list: savedClasses(userId) });
  };
  /** Opening a saved class fills all five levels and nothing else: no register
   *  is fetched, and Load register stays a decision. */
  const applySavedClass = (target: Sel) => {
    setSel(target);
    void runRefresh(selectionAfter(target, "section", target), opts);
  };
  /** Each card's names come from the cascade wherever this session has offered them,
   *  falling back to the label cached at save time for the cards it has not. The
   *  Subject leads, because that is what tells one saved class from another in the
   *  same section, and the levels above it say which class it belongs to. */
  const savedClassCards =
    savedList?.map((s) => {
      const labelOf = (key: Level): string =>
        opts[key].find((o) => String(o.value) === String(s[key]))?.label ?? "";
      return {
        sel: s,
        subject:
          subjectNames.get(subjectNameKey(s.section, s.subject)) ??
          s.label ??
          "",
        sectionName: labelOf("section") || s.section,
        course: [
          labelOf("course"),
          labelOf("semester"),
          abbreviate(labelOf("branch")),
        ]
          .filter(Boolean)
          .join(" · "),
      };
    }) ?? [];
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
      filterNote={filterNote}
      onSelect={onSelectLevel}
      onRange={onRangeChange}
      onLoad={loadRegister}
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
      if (onProfile) {
        body = (
          <ProfilePanel
            userId={userId}
            faculty={facultyProfile.data ?? null}
            busy={facultyProfile.isLoading}
          />
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
              overallMode
              profile={found?.profile ?? null}
              busy={search.isLoading}
              note={searchNote}
              scope={searchScope}
              absenceRange={
                found?.window
                  ? `${found.window.from} to ${found.window.to}`
                  : null
              }
              fullAbsent={found?.fullAbsent ?? null}
              fullRange={
                found?.fullRange
                  ? `${found.fullRange.from} to ${found.fullRange.to}`
                  : null
              }
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
                onFilterChange={applyFilter}
                onShowDetails={showDetails}
                chosen={registerFacts}
                overallMode={overallMode}
              />
            ) : null}
            <StudentDetails
              student={detail}
              opened={detailOpen}
              onClose={() => setDetailOpen(false)}
              onExitTransitionEnd={() => setDetail(null)}
              overallMode={overallMode}
              profile={profile.data ?? null}
              busy={profile.isLoading}
              note={profileNote ?? semAbsencesNote}
              absenceRange={
                summary?.range
                  ? `${summary.statedFrom || summary.range.from} to ${summary.range.to}`
                  : null
              }
              fullAbsent={semAbsences.data?.absent ?? null}
              fullTitle={
                overallMode
                  ? "Absent — full semester"
                  : "Absent — full semester, this subject"
              }
              fullRange={
                semStartShown && summary
                  ? `${semStartShown} to ${summary.range.to}`
                  : null
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
        collapsed: { mobile: !navOpen, desktop: screen !== "app" },
      }}
      footer={{ height: 64 }}
    >
      <AppShell.Header>
        <Group h="100%" px="md" align="center" gap="sm">
          {screen === "app" ? (
            <Burger
              opened={navOpen}
              onClick={() => nav.toggle()}
              hiddenFrom="sm"
              size="sm"
              aria-label="Show the navigation"
            />
          ) : null}
          <Title order={3}>Vignan Faculty Tools</Title>
        </Group>
      </AppShell.Header>
      <AppShell.Navbar p="md">
        <AppShell.Section grow>
          <Stack gap="xs">
            <Button
              onClick={() => {
                nav.close();
                navigate(DASHBOARD_PATH);
              }}
              variant={onDashboard ? "filled" : "subtle"}
              aria-current={onDashboard ? "page" : undefined}
              leftSection={<SquaresFour size={18} aria-hidden />}
              fullWidth
              justify="flex-start"
            >
              Attendance
            </Button>
            <Button
              onClick={() => {
                nav.close();
                navigate(SEARCH_PATH);
              }}
              variant={onSearch ? "filled" : "subtle"}
              aria-current={onSearch ? "page" : undefined}
              leftSection={<MagnifyingGlass size={18} aria-hidden />}
              fullWidth
              justify="flex-start"
            >
              Student Search
            </Button>
            <Button
              onClick={() => {
                nav.close();
                navigate(PROFILE_PATH);
              }}
              variant={onProfile ? "filled" : "subtle"}
              aria-current={onProfile ? "page" : undefined}
              leftSection={<UserCircle size={18} aria-hidden />}
              fullWidth
              justify="flex-start"
            >
              Profile
            </Button>
          </Stack>
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
      <AppShell.Footer p="xs" hiddenFrom="sm">
        <Group justify="space-around" gap={0}>
          <Button
            onClick={() => navigate(DASHBOARD_PATH)}
            variant={onDashboard ? "filled" : "subtle"}
            aria-current={onDashboard ? "page" : undefined}
            leftSection={<SquaresFour size={18} aria-hidden />}
            fullWidth
            justify="center"
          >
            Attendance
          </Button>
          <Button
            onClick={() => navigate(SEARCH_PATH)}
            variant={onSearch ? "filled" : "subtle"}
            aria-current={onSearch ? "page" : undefined}
            leftSection={<MagnifyingGlass size={18} aria-hidden />}
            fullWidth
            justify="center"
          >
            Student Search
          </Button>
          <Button
            onClick={() => navigate(PROFILE_PATH)}
            variant={onProfile ? "filled" : "subtle"}
            aria-current={onProfile ? "page" : undefined}
            leftSection={<UserCircle size={18} aria-hidden />}
            fullWidth
            justify="center"
          >
            Profile
          </Button>
        </Group>
      </AppShell.Footer>
    </AppShell>
  );
};
export default App;
