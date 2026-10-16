import {
  AppShell,
  Burger,
  Button,
  Container,
  Group,
  Stack,
  Text,
  Title,
} from "@mantine/core";
import { useDisclosure } from "@mantine/hooks";
import {
  FloppyDisk,
  SignOut,
  SquaresFour,
  UserCircle,
} from "@phosphor-icons/react";
import React, { useCallback, useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import { useLocation, useNavigate } from "react-router";

import type {
  LoginRequest,
  OkReply,
  Option,
  OptionsReply,
  OptionsRequest,
  RegisterReply,
  RegisterRequest,
  SessionReply,
  Student,
  StudentProfile,
  StudentRequest,
} from "../shared/api";
import {
  abbreviate,
  applyOptions,
  chosenLevels,
  isAllSubjects,
  chosenText,
  disabledLevels,
  rememberRangeStart,
  resetFor,
  rememberClass,
  savedClasses,
  forgetClass,
  startingRange,
  registerRows,
  EMPTY_OPTS,
  EMPTY_SEL,
  LEVEL_KEYS,
  LEVELS,
  shouldContinue,
  subjectNameKey,
  toPortalDate,
} from "./cascade";
import type { Level, Range, SavedClass, Sel } from "./cascade";
import { ClassPicker } from "./components/ClassPicker";
import { ProfilePanel } from "./components/ProfilePanel";
import { RegisterSummary } from "./components/RegisterSummary";
import { RegisterTable } from "./components/RegisterTable";
import { SavedClasses } from "./components/SavedClasses";
import { SignInPanel } from "./components/SignInPanel";
import { StudentDetails } from "./components/StudentDetails";
import type { Note } from "./types";

const LOGIN_PATH = "/login";
const DASHBOARD_PATH = "/dashboard";
const PROFILE_PATH = "/profile";
const SESSION_PROBE_MS = 5 * 60_000;
class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
    this.name = "ApiError";
  }
}
async function api<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(path, options);
  const body = (await res.json().catch(() => ({}))) as { error?: string };
  if (!res.ok) {
    throw new ApiError(
      res.status,
      body.error ?? `Request failed (${res.status})`
    );
  }
  return body as T;
}
const App = (): React.JSX.Element => {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const onLogin = pathname === LOGIN_PATH;
  const onProfile = pathname === PROFILE_PATH;
  const [booted, setBooted] = useState(false);
  const [signedIn, setSignedIn] = useState(false);
  const [userId, setUserId] = useState("");
  const [password, setPassword] = useState("");
  const [loginNote, setLoginNote] = useState<Note | null>(null);
  const [filterNote, setFilterNote] = useState<Note | null>(null);
  const [busy, setBusy] = useState(false);
  const [loadNote, setLoadNote] = useState("");
  const [navOpen, nav] = useDisclosure();
  const [persisted, setPersisted] = useState(false);
  /* oxlint-disable react/refs */
  const busyRef = useRef(busy);
  busyRef.current = busy;
  /* oxlint-enable react/refs */
  const [sel, setSel] = useState<Sel>(EMPTY_SEL);
  const [opts, setOpts] = useState<OptionsReply>(EMPTY_OPTS);
  const [range, setRange] = useState<Range>(startingRange);
  const [result, setResult] = useState<RegisterReply | null>(null);
  const [onlyIrregular, setOnlyIrregular] = useState(false);
  const [overallMode, setOverallMode] = useState(false);
  /** The row whose panel is open. Held here, not in the table, because the table
   *  is a presentational module with no state of its own. */
  const [detail, setDetail] = useState<Student | null>(null);
  /** The open student's GPA and phone numbers, which the register does not hold
   *  and ECAP answers one roll number at a time. */
  const [profile, setProfile] = useState<StudentProfile | null>(null);
  const [profileBusy, setProfileBusy] = useState(false);
  const [profileNote, setProfileNote] = useState<Note | null>(null);
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
  /* oxlint-disable react/refs */
  const selRef = useRef<Sel>(sel);
  selRef.current = sel;
  const optsRef = useRef<OptionsReply>(opts);
  optsRef.current = opts;
  /* oxlint-enable react/refs */
  const refreshToken = useRef(0);
  /** The same rule for the open student's profile: only the newest open may
   *  write to the panel. */
  const detailToken = useRef(0);
  /** The saved classes, read only for the user who is signed in. Stored values
   *  are the previous session's until the name proves whose they are. */
  const savedList = saved?.userId === userId && userId ? saved.list : null;
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
      refreshToken.current += 1;
      setUserId("");
      setPassword("");
      setSignedIn(false);
      setLoginNote(why ? { kind: "warning", text: why } : null);
      setFilterNote(null);
      setBusy(false);
      setLoadNote("");
      setSel(EMPTY_SEL);
      setOpts(EMPTY_OPTS);
      setResult(null);
      setOnlyIrregular(false);
      detailToken.current += 1;
      setDetail(null);
      setProfile(null);
      setProfileBusy(false);
      setProfileNote(null);
      // The saved section is the previous user's, so it leaves the screen with
      // them. What is in storage is theirs to find again on sign-in.
      setSaved(null);
      setSubjectNames(new Map());
      navigate(LOGIN_PATH, { replace: true });
    },
    [navigate]
  );
  const fetchRegister = useCallback(
    async (levels: Record<Level, Option>, dates: Range) => {
      setBusy(true);
      setLoadNote("Reading the register from ECAP...");
      const token = ++refreshToken.current;
      try {
        const request: RegisterRequest = {
          ...levels,
          from: toPortalDate(dates.from),
          to: toPortalDate(dates.to),
        };
        const body = await api<RegisterReply>("/api/register", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(request),
        });
        if (token !== refreshToken.current) return;
        setResult(body);
        // A panel left open would go on showing the previous register's numbers
        // beside a table that has already been replaced.
        setDetail(null);
        // Only a load that actually succeeded re-scopes the screen.
        setOverallMode(isAllSubjects(levels.subject));
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
  const loadRegister = useCallback(async () => {
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
    await fetchRegister(chosen.levels, range);
    // A range that produced a register is one worth opening at again.
    rememberRangeStart(range.from);
  }, [fetchRegister, opts, range, sel]);
  /** Opening a row shows the panel and reads the one thing the register does not
   *  state: the student's GPA and phone numbers. A reply that arrives after the
   *  panel has been closed or replaced is dropped, the rule `refreshToken`
   *  already follows — a slower read of the previous student must not land under
   *  the next student's name. */
  const showDetails = useCallback(
    async (student: Student) => {
      setDetail(student);
      setProfile(null);
      setProfileNote(null);
      setProfileBusy(true);
      const token = ++detailToken.current;
      try {
        const request: StudentRequest = { roll: student.roll };
        const body = await api<StudentProfile>("/api/student", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(request),
        });
        if (token !== detailToken.current) return;
        setProfile(body);
      } catch (error) {
        if (error instanceof ApiError && error.status === 401) {
          signedOut("Your session expired. Please sign in again.");
          return;
        }
        if (token !== detailToken.current) return;
        setProfileNote({
          kind: "error",
          text: error instanceof Error ? error.message : String(error),
        });
      } finally {
        if (token === detailToken.current) setProfileBusy(false);
      }
    },
    [signedOut]
  );
  const hideDetails = useCallback(() => {
    detailToken.current += 1;
    setDetail(null);
  }, []);
  const runRefresh = useCallback(
    async (changed: Level | null, arriving?: Sel) => {
      const token = ++refreshToken.current;
      let draft = { ...selRef.current };
      // A changed level invalidates the ones below it — unless the change arrived
      // with its own selection, which is what opening a saved class does.
      const cleared = changed ? resetFor(changed, arriving ?? draft) : [];
      if (cleared.length) {
        draft = { ...draft };
        for (const key of cleared) draft[key] = "";
      }
      selRef.current = draft;
      setSel(draft);
      setBusy(true);
      setLoadNote("Loading options...");
      try {
        for (const _pass of LEVEL_KEYS) {
          if (token !== refreshToken.current) return;
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
          const fresh = reply.subject.filter((o) => !isAllSubjects(o));
          if (fresh.length) {
            setSubjectNames((previous) => {
              const merged = new Map(previous);
              for (const o of fresh) {
                merged.set(
                  subjectNameKey(draft.section, String(o.value)),
                  o.label
                );
              }
              return merged;
            });
          }
          draft = applyOptions(draft, reply);
          selRef.current = draft;
          setSel(draft);
          setOpts(reply);
          if (!shouldContinue(draft, before, reply)) break;
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
      setPassword("");
      setSignedIn(true);
      noteUserId(body.userId);
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
    await api<OkReply>("/api/logout", { method: "POST" }).catch(() => null);
    signedOut("");
  };
  useEffect(() => {
    if (onLogin) return;
    let cancelled = false;
    const probe = async () => {
      if (busyRef.current) return;
      const s = await api<SessionReply>("/api/session").catch(() => null);
      if (cancelled || !s) return;
      setPersisted(s.persisted);
      if (!s.signedIn) {
        signedOut("Your session expired. Please sign in again.");
      }
    };
    const id = setInterval(probe, SESSION_PROBE_MS);
    document.addEventListener("visibilitychange", probe);
    return () => {
      cancelled = true;
      clearInterval(id);
      document.removeEventListener("visibilitychange", probe);
    };
  }, [onLogin, signedOut]);
  useEffect(() => {
    if (booted) return;
    (async () => {
      let alive = false;
      let kept = false;
      let name = "";
      try {
        const s = await api<SessionReply>("/api/session");
        alive = !!(s && s.signedIn);
        kept = Boolean(s?.persisted);
        name = s?.userId ?? "";
      } catch {
        alive = false;
      }
      if (booted) return;
      setBooted(true);
      setSignedIn(alive);
      setPersisted(kept);
      if (alive) {
        // A restored session never went through the sign-in form, so this is the
        // only place the name can arrive. Without it the header and the profile
        // panel show a dash for a session that is working.
        if (name) noteUserId(name);
        if (!onLogin && !onProfile) {
          navigate(DASHBOARD_PATH, { replace: true });
        }
        if (!onLogin) await runRefresh(null);
      } else if (!onLogin) {
        navigate(LOGIN_PATH, { replace: true });
      }
    })();
  }, [booted, onLogin, onProfile, navigate, runRefresh, noteUserId]);
  useEffect(() => {
    if (booted && signedIn && onLogin) {
      navigate(DASHBOARD_PATH, { replace: true });
    }
  }, [booted, signedIn, onLogin, navigate]);
  const disabled = disabledLevels(sel);
  const summary = result?.summary;
  // No sort: the rows are the Portal's own roster order, which the Sl.No column
  // carries. Reordering them by attendance made the numbers read as a ranking
  // rather than as a roster. A student needing a check-in is found by the tint,
  // not by being at the top of the list.
  const rows = result
    ? registerRows(result.students, onlyIrregular, overallMode)
    : [];
  const registerName = chosenText(opts, sel, summary?.range);
  const onSelectLevel = (key: Level, value: string) => {
    setSel((s) => ({ ...s, [key]: value }));
    selRef.current = { ...selRef.current, [key]: value };
    if (key !== "subject") runRefresh(key);
  };
  const onRangeChange = (part: "from" | "to", value: string) => {
    setRange((r) => ({ ...r, [part]: value }));
  };
  const classChosen =
    Boolean(sel.course) &&
    Boolean(sel.semester) &&
    Boolean(sel.branch) &&
    Boolean(sel.section) &&
    // ALL SUBJECTS is not a subject, so it cannot be the one a card reopens.
    Boolean(sel.subject) &&
    !isAllSubjects(opts.subject.find((o) => String(o.value) === sel.subject));
  const saveClass = () => {
    rememberClass(
      userId,
      sel,
      opts.subject.find((o) => String(o.value) === sel.subject)?.label ?? ""
    );
    setSaved({ userId, list: savedClasses(userId) });
  };
  const clearSavedClass = (target: Sel) => {
    forgetClass(userId, target);
    setSaved({ userId, list: savedClasses(userId) });
  };
  /** Opening a saved class fills all five levels and nothing else: no register
   *  is fetched, and Load register stays a decision. */
  const applySavedClass = (target: Sel) => {
    const next: Sel = { ...target };
    selRef.current = next;
    setSel(next);
    runRefresh("section", next);
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
      body = onProfile ? (
        <ProfilePanel userId={userId} persisted={persisted} />
      ) : (
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
              onlyIrregular={onlyIrregular}
              onToggleIrregular={setOnlyIrregular}
              onShowDetails={showDetails}
              chosenText={registerName}
              overallMode={overallMode}
            />
          ) : null}
          <StudentDetails
            student={detail}
            onClose={hideDetails}
            chosenText={registerName}
            profile={profile}
            busy={profileBusy}
            note={profileNote}
          />
        </>
      );
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
              onClick={() => navigate(DASHBOARD_PATH)}
              variant={!onLogin && !onProfile ? "filled" : "subtle"}
              aria-current={!onLogin && !onProfile ? "page" : undefined}
              leftSection={<SquaresFour size={18} aria-hidden />}
              fullWidth
              justify="flex-start"
            >
              Dashboard
            </Button>
            <Button
              onClick={() => navigate(PROFILE_PATH)}
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
      <AppShell.Main>
        {screen === "app" ? (
          body
        ) : (
          <Container size="sm" py="xl">
            {body}
          </Container>
        )}
      </AppShell.Main>
    </AppShell>
  );
};
export default App;
