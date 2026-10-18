import useSWR, { mutate } from "swr";
import useSWRMutation from "swr/mutation";

import type {
  LoginRequest,
  OkReply,
  OptionsReply,
  OptionsRequest,
  RegisterReply,
  RegisterRequest,
  FacultyProfile,
  SessionReply,
  StudentProfile,
  StudentRequest,
} from "../shared/api";
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
 *  works. Not an expiry — the cookie's own `Max-Age` is thirty days of not using
 *  it — but the check that a session ECAP has dropped shows up while someone is
 *  working rather than at their next request. */
export const SESSION_PROBE_MS = 5 * 60_000;
const SESSION_PATH = "/api/session";
const REGISTER_PATH = "/api/register";
const STUDENT_PATH = "/api/student";
const FACULTY_PROFILE_PATH = "/api/faculty-profile";
const OPTIONS_PATH = "/api/options";
/** The option chain is one key, not five: its requests depend on each other, so
 *  the thing worth caching is a run, and a run is named by its seed. */
const OPTIONS_RUN = `${OPTIONS_PATH}#chain`;
const LOGIN_PATH = "/api/login";
const LOGOUT_PATH = "/api/logout";
/** A key this server answers, on its own or as the first half of an array key. */
const isServerKey = (key: unknown): boolean =>
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
/** The server's own sentence for a request it refused, or the status when it
 *  sent no sentence with it. */
async function read<T>(res: Response): Promise<T> {
  const body = (await res.json().catch(() => ({}))) as { error?: string };
  if (!res.ok) {
    throw new ApiError(
      res.status,
      body.error ?? `Request failed (${res.status})`
    );
  }
  return body as T;
}
export const getJson = async <T>(path: string): Promise<T> =>
  read<T>(await fetch(path));
export const postJson = async <T>(path: string, body?: unknown): Promise<T> =>
  read<T>(
    await fetch(
      path,
      body === undefined
        ? { method: "POST" }
        : {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(body),
          }
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
    dedupingInterval: 0,
    /** The interval is the retry; a failed read starts no second one behind it. */
    shouldRetryOnError: false,
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
  return useSWR<RegisterReply, ApiError>(
    click ? [REGISTER_PATH, click.request, click.attempt] : null,
    ([, request]: [string, RegisterRequest]) =>
      postJson<RegisterReply>(REGISTER_PATH, request),
    {
      revalidateOnFocus: false,
      revalidateOnReconnect: false,
      shouldRetryOnError: false,
      dedupingInterval: 0,
    }
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
  return useSWR<StudentProfile, ApiError>(
    asked ? [STUDENT_PATH, asked] : null,
    ([, body]: [string, StudentRequest]) =>
      postJson<StudentProfile>(STUDENT_PATH, body),
    {
      revalidateOnFocus: false,
      revalidateOnReconnect: false,
      shouldRetryOnError: false,
      dedupingInterval: 0,
    }
  );
}
/** The faculty member's own details from ECAP's main.aspx: name, photo URL, and
 *  designation code. Read once when the profile page is opened. */
export function useFacultyProfile(enabled: boolean) {
  return useSWR<FacultyProfile, ApiError>(
    enabled ? FACULTY_PROFILE_PATH : null,
    () => postJson<FacultyProfile>(FACULTY_PROFILE_PATH, {}),
    {
      revalidateOnFocus: false,
      revalidateOnReconnect: false,
      shouldRetryOnError: false,
      dedupingInterval: 0,
    }
  );
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
