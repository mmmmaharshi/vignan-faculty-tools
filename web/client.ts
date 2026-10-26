import useSWR, { mutate } from "swr";
import useSWRImmutable from "swr/immutable";
import useSWRMutation from "swr/mutation";

import type {
  LoginRequest,
  OkReply,
  OptionsReply,
  OptionsRequest,
  RegisterReply,
  RegisterRequest,
  FacultyProfile,
  FindReply,
  FindRequest,
  SemAbsencesReply,
  SemAbsencesRequest,
  SemStartReply,
  SemStartRequest,
  SessionReply,
  StudentProfile,
  StudentRequest,
  TodayClassesReply,
  UnpostedReply,
} from "../shared/api";
import { SESSION_HEADER, SESSION_STORE_KEY } from "../shared/api";
import { runCascade } from "./cascade";
import type { CascadeOutcome, CascadeSetup } from "./cascade";
/**
 * The app's whole way of talking to its own server: one JSON wrapper, and the
 * SWR hooks every screen reads through. Nothing else in `web/` calls `fetch`.
 *
 * Two rules decide the shape of every key here. A key is a cache entry, so
 * **anything the user must ask for again on purpose gets a key that changes per
 * ask** — the register, whose click number is part of its key. And a key is a
 * promise about *whose* data it is, so **nothing keyed on the server survives a
 * session** — `forgetServerData` sweeps them all on the way out.
 */
/** How often a session that is just sitting there is asked whether it still
 *  works. Not an expiry — the stored session's own `at` is thirty days of not
 *  using it — but the check that a session ECAP has dropped shows up while
 *  someone is working rather than at their next request. */
export const SESSION_PROBE_MS = 5 * 60_000;
const SESSION_PATH = "/api/session";
const REGISTER_PATH = "/api/register";
const STUDENT_PATH = "/api/student";
const FIND_PATH = "/api/find";
const SEM_START_PATH = "/api/sem-start";
const SEM_ABSENCES_PATH = "/api/sem-absences";
const FACULTY_PROFILE_PATH = "/api/faculty-profile";
const TODAY_PATH = "/api/today";
const UNPOSTED_PATH = "/api/unposted";
const OPTIONS_PATH = "/api/options";
/** The option chain is one key, not five: its requests depend on each other, so
 *  the thing worth caching is a run, and a run is named by its seed. */
const OPTIONS_RUN = `${OPTIONS_PATH}#chain`;
const LOGIN_PATH = "/api/login";
const LOGOUT_PATH = "/api/logout";
/** A key this server answers, on its own or as the first half of an array key. */
const isServerKey = (key: unknown): key is string | [string, ...unknown[]] =>
  (typeof key === "string" && key.startsWith("/api/")) ||
  (Array.isArray(key) &&
    typeof key[0] === "string" &&
    key[0].startsWith("/api/"));
export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
    this.name = "ApiError";
  }
}
/** Whether a failure is the session being refused, rather than the request. */
export const isExpired = (error: unknown): boolean =>
  error instanceof ApiError && error.status === 401;
export const messageOf = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);
/**
 * The session lives in localStorage and travels on every request: the server
 * keeps nothing per user, so the browser is the session's only home. The
 * ECAP password sits in it in the clear — anyone holding this browser's
 * storage holds the ECAP account with it.
 */
export const loadStoredSession = (): string | null => {
  try {
    return localStorage.getItem(SESSION_STORE_KEY);
  } catch {
    return null;
  }
};
const saveStoredSession = (encoded: string): void => {
  try {
    localStorage.setItem(SESSION_STORE_KEY, encoded);
  } catch {
    // A storage that refuses writes leaves the session memory-only: this
    // request still works, the next visit signs in again.
  }
};
/** Drops the stored session. Signing out is this and the cache sweep. */
export const clearStoredSession = (): void => {
  try {
    localStorage.removeItem(SESSION_STORE_KEY);
  } catch {
    // Already gone, or storage was never readable.
  }
};
/** The server's own sentence for a request it refused, or the status when it
 *  sent no sentence with it. */
async function read<T>(res: Response): Promise<T> {
  const slid = res.headers.get(SESSION_HEADER);
  if (slid) saveStoredSession(slid);
  if (res.status === 204) return {} as T;
  const body = (await res.json().catch(() => ({}))) as { error?: string };
  if (!res.ok) {
    throw new ApiError(
      res.status,
      body.error ?? `Request failed (${res.status})`
    );
  }
  return body as T;
}
const withSession = (init: RequestInit): RequestInit => {
  const stored = loadStoredSession();
  if (!stored) return init;
  return {
    ...init,
    headers: { ...init.headers, [SESSION_HEADER]: stored },
  };
};
export const getJson = async <T>(path: string): Promise<T> =>
  read<T>(await fetch(path, withSession({})));
export const postJson = async <T>(path: string, body?: unknown): Promise<T> =>
  read<T>(
    await fetch(
      path,
      withSession(
        body === undefined
          ? { method: "POST" }
          : {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify(body),
            }
      )
    )
  );
/**
 * The session, which is both "is anyone signed in" and "do they still work".
 *
 * `paused` is how the app says not to ask: a request the user is waiting on is
 * already proving the session works, and the sign-in screen has nothing to
 * probe. The boot read is not paused — the sign-in screen is exactly where the
 * answer decides whether to show a form or a dashboard.
 */
export function useSession(paused: boolean) {
  return useSWR<SessionReply, ApiError>(SESSION_PATH, getJson, {
    refreshInterval: paused ? 0 : SESSION_PROBE_MS,
    revalidateOnFocus: !paused,
    revalidateOnReconnect: !paused,
    /* SWR measures its focus window from when the *key* last changed, and this
       key never does — so the window would be measured from the mount. A deep
       link to /dashboard mounts the hook signed out, with focus revalidation
       already on, and would then swallow the first five seconds of probes. */
    focusThrottleInterval: 0,
    /** The interval is the retry; a failed read starts no second one behind it. */
  });
}
/** However the server has just described the session, this is what it said. Used
 *  after a sign-in, so the app never has to write the session down itself. */
export const reloadSession = (): Promise<SessionReply | undefined> =>
  mutate<SessionReply>(SESSION_PATH);
/** One click on `Load register`: the request, and which click it was. */
export type RegisterClick = { request: RegisterRequest; attempt: number };
/**
 * The register: fetched when a click says so, and never otherwise.
 *
 * The click number is part of the key, and that is what makes the rule hold
 * rather than a promise to be careful. A key SWR has not seen is a load, so a
 * second click on the same selection is a fresh load rather than a cache hit;
 * and a load that lands after a newer one answers to a key nothing is showing,
 * so the newer register is the one on screen. Both revalidations are off because
 * a register is a decision every time (ADR 0015).
 */
export function useRegisterLoad(click: RegisterClick | null) {
  return useSWRImmutable<RegisterReply, ApiError>(
    click ? [REGISTER_PATH, click.request, click.attempt] : null,
    ([, request]: [string, RegisterRequest]) =>
      postJson<RegisterReply>(REGISTER_PATH, request)
  );
}
/**
 * One student's GPA and phone numbers, keyed by their roll number: the register
 * states none of them, and ECAP answers for one student at a time, when their
 * panel is opened (ADR 0018). The key is the roll number and the register it was
 * read from, so a reply read for one student cannot land under another's name,
 * and one read from another register is its own entry.
 *
 * `register` also carries the dates on the All subjects path, where the report
 * on screen states none — the server asks for them, over this same range, only
 * when the subject in it is the section-wide one.
 */
export function useStudentProfile(asked: StudentRequest | null) {
  // Plain useSWR, not immutable: reopening a panel refreshes its answer
  // behind the cached one. The globals already silence focus, reconnect and
  // retries, so only the dedupe window is local.
  return useSWR<StudentProfile, ApiError>(
    asked ? [STUDENT_PATH, asked] : null,
    ([, body]: [string, StudentRequest]) =>
      postJson<StudentProfile>(STUDENT_PATH, body)
  );
}
/**
 * One roll number looked up from the Student Search tab: the class ECAP says the
 * student is in, their profile, and their row out of that class's own report.
 *
 * The click number is part of the key, for the register's reason: a search is a
 * deliberate ask, so asking again is a new read rather than a cache hit — and a
 * failed search is not cached under the key the next attempt will use.
 */
export interface FindClick {
  request: FindRequest;
  attempt: number;
}
export function useStudentSearch(click: FindClick | null) {
  return useSWRImmutable<FindReply, ApiError>(
    click ? [FIND_PATH, click.request, click.attempt] : null,
    ([, body]: [string, FindRequest]) => postJson<FindReply>(FIND_PATH, body)
  );
}
/**
 * One subject's earliest held day inside the asked window, for the All subjects
 * path whose own report states no dates (ADR 0022). Keyed by the full request
 * so another range is another entry; read once per register, never revalidated.
 * A failure stays where it happened — the register on screen is complete
 * without it — except a 401, which still ends the session through the shared
 * failure sweep.
 */
export function useSemStart(request: SemStartRequest | null) {
  return useSWRImmutable<SemStartReply, ApiError>(
    request ? [SEM_START_PATH, request] : null,
    ([, body]: [string, SemStartRequest]) =>
      postJson<SemStartReply>(SEM_START_PATH, body)
  );
}
/**
 * One student's absent days over a wider window than the register on screen:
 * the same register read twice (subject path) or the same Student Wise read
 * twice (All subjects path), over the remembered semester start. Asked only
 * when the window starts after that start — when they coincide the list on
 * screen already is the full semester. A failure stays where it happened,
 * except a 401, which still ends the session through the shared failure sweep.
 */
export function useSemAbsences(asked: SemAbsencesRequest | null) {
  return useSWRImmutable<SemAbsencesReply, ApiError>(
    asked ? [SEM_ABSENCES_PATH, asked] : null,
    ([, body]: [string, SemAbsencesRequest]) =>
      postJson<SemAbsencesReply>(SEM_ABSENCES_PATH, body)
  );
}
/** A screen-opened read with no parameters: the key is the path, so sign-out
 *  sweeps it, and reopening refreshes it behind the cached answer. */
function usePostOnOpen<T>(path: string, enabled: boolean) {
  return useSWR<T, ApiError>(enabled ? path : null, () =>
    postJson<T>(path, {})
  );
}
/** The faculty member's own details from ECAP's main.aspx: name, photo URL, and
 *  designation code. Read once when the profile page is opened. */
export function useFacultyProfile(enabled: boolean) {
  // Same remount-refresh contract as the student panel above.
  return usePostOnOpen<FacultyProfile>(FACULTY_PROFILE_PATH, enabled);
}
/**
 * Today's timetable, from the faculty dashboard's own schedule grid. Read when
 * Home is opened and refreshed behind the cached answer on return — a period
 * read yesterday is not today's, and ECAP clears the day after ~4pm, so a
 * stale read is the wrong kind of right. Keyed on `/api/`, so sign-out sweeps
 * it with everything else the Portal said.
 */
export function useTodayClasses(enabled: boolean) {
  return usePostOnOpen<TodayClassesReply>(TODAY_PATH, enabled);
}
/**
 * Whether the day's periods got their attendance, from the day-class-work
 * report. Same read contract as the timetable above: read when Home opens,
 * refreshed behind the cached answer on return, swept on sign-out. A refusal
 * stays in its own section — it never fails the table above it.
 */
export function useUnposted(enabled: boolean) {
  return usePostOnOpen<UnpostedReply>(UNPOSTED_PATH, enabled);
}
/**
 * One pass of the option chain. Cached under the request it answered, so the
 * same chain run twice — the same saved class opened again — costs no Portal
 * calls. `revalidate: false` because the chain, not the cache, decides what to
 * ask for next.
 */
const optionsFor = async (request: OptionsRequest): Promise<OptionsReply> => {
  const reply = await mutate(
    [OPTIONS_PATH, request],
    () => postJson<OptionsReply>(OPTIONS_PATH, request),
    { revalidate: false }
  );
  // A reply that is not options is a failure, the same way a register reply
  // without its roster is: the caller's next pass cannot be built from nothing.
  if (!reply) throw new ApiError(502, "ECAP sent no options for that class.");
  return reply;
};
/** The cascade, as one run: `trigger` settles a selection and answers what the
 *  Portal said, or null when the run was superseded before it settled. */
export function useOptionsChain() {
  return useSWRMutation<CascadeOutcome | null, ApiError, string, CascadeSetup>(
    OPTIONS_RUN,
    (_key, { arg }) => runCascade(arg, optionsFor)
  );
}
export function useSignIn() {
  return useSWRMutation<OkReply, ApiError, string, LoginRequest>(
    LOGIN_PATH,
    (_key, { arg }) => postJson<OkReply>(LOGIN_PATH, arg)
  );
}
export function useSignOut() {
  return useSWRMutation<OkReply, ApiError, string, undefined>(LOGOUT_PATH, () =>
    postJson<OkReply>(LOGOUT_PATH)
  );
}
/**
 * Nothing one user read from the Portal outlives their session. What is swept is
 * every `/api/` key: options and subject names belong to one faculty member's
 * sections, and the next person's screen must not open with a register or a
 * student's phone numbers already in it.
 */
export const forgetServerData = (): Promise<unknown> =>
  mutate(isServerKey, undefined, { revalidate: false });
/** Every screen read a refresh may re-read: each read hook's path, named
 *  once here so a new endpoint joins the refresh by joining this list. The
 *  register is deliberately absent — the click stays its only fetch
 *  (ADR 0015) — and so are the login, logout, and options-chain mutation
 *  keys, which hold no screen read to revalidate. */
const REFRESHABLE_PATHS: ReadonlySet<string> = new Set([
  SESSION_PATH,
  STUDENT_PATH,
  FIND_PATH,
  SEM_START_PATH,
  SEM_ABSENCES_PATH,
  FACULTY_PROFILE_PATH,
  TODAY_PATH,
  UNPOSTED_PATH,
  OPTIONS_PATH,
]);
const isRefreshableKey = (
  key: unknown
): key is string | [string, ...unknown[]] =>
  isServerKey(key) &&
  REFRESHABLE_PATHS.has(typeof key === "string" ? key : key[0]);
/**
 * Re-reads what the screens show, in place: every path in
 * `REFRESHABLE_PATHS` revalidates. A register stays a decision (ADR 0015),
 * so the click is still the only way one is ever fetched. The cascade
 * re-runs from its own caller beside this, where a picker is on screen to
 * settle it.
 */
export const revalidateServerData = (): Promise<unknown> =>
  mutate(isRefreshableKey, undefined, { revalidate: true });
