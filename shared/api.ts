/**
 * The contract between the server and the front end.
 *
 * Both sides import this module, and the server checks what it emits against
 * it with `satisfies` on every reply, so a field renamed in one place without
 * the other is a compile error in both projects rather than an `undefined`
 * rendered into a table cell. That is the whole reason it exists: the shapes
 * below are the one thing the two halves of this app must never disagree about.
 *
 * Environment-neutral by necessity. This file compiles in the web project (DOM
 * available) and the server project (DOM deliberately absent), so it may not
 * reference either world's globals. Keep it declarations only.
 */

/** One entry in a cascade level's dropdown, as the portal's own markup gives it. */
export interface Option {
  /** The identifier sent back to the portal. */
  value: string;
  /** The visible text. `ShowAcademicCalendar` needs this as well as the value. */
  label: string;
  /** The portal puts the batch number here for semesters, and nothing elsewhere. */
  title: string;
}

/** `POST /api/session`. Answers 200 with `signedIn: false` when signed out. */
export interface SessionReply {
  signedIn: boolean;
}

/** `POST /api/login` and `POST /api/logout`. */
export interface OkReply {
  ok: true;
}

/**
 * `POST /api/login` body. The password is used once, to encrypt the login
 * payload, and is never stored, logged or returned.
 */
export interface LoginRequest {
  userId: string;
  password: string;
}

/**
 * One position in the cascade.
 *
 * Spelled out rather than derived from `OptionsReply`, because that interface
 * also carries `emptyLevels` - a report *about* the levels, not one of them.
 */
export type CascadeLevel =
  | "course"
  | "semester"
  | "branch"
  | "section"
  | "subject";

/**
 * `POST /api/options`.
 *
 * All five levels come back on every call. Levels below the deepest one chosen
 * are empty arrays rather than absent, so the front end can tell "not yet
 * derivable" from "chosen, and genuinely empty".
 */
export interface OptionsReply {
  course: Option[];
  semester: Option[];
  branch: Option[];
  section: Option[];
  subject: Option[];
  /**
   * Levels that were asked for and came back empty, which should not happen.
   *
   * The server reports rather than refuses. Every combination the portal offers
   * has been checked and none is empty, but that survey only covers the courses
   * this account can see - which is one. So this field exists for the case the
   * survey could not reach: the list comes back empty, the user is told which
   * level and why it might have happened, and the rest of the app keeps working.
   *
   * A 502 would have been the other option and was worse. It turns a level that
   * is merely empty into a blocked screen, on the strength of an assumption
   * about a course nobody here has seen.
   */
  emptyLevels: CascadeLevel[];
}

/** One student in a register. */
export interface Student {
  sl: string;
  roll: string;
  name: string;
  /**
   * The portal's combined attended/held cell, e.g. `"38/45"`, kept whole.
   * It is never split into its two numbers, so nothing may treat it as a count
   * of held classes. See CONTEXT.md, "Attended of held".
   */
  attendedOfHeld: string;
  /** Percentage, or null when the cell would not parse. Never dropped. */
  pct: number | null;
  irregular: boolean;
  critical: boolean;
}

/** `POST /api/register`. */
export interface RegisterReply {
  students: Student[];
  summary: {
    total: number;
    irregular: number;
    critical: number;
    /**
     * The thresholds, sent rather than hardcoded in the client, so the stat
     * cards and the row flags are labelled from the numbers that produced them.
     */
    irregularBelow: number;
    criticalBelow: number;
    average: number | null;
    range: { from: string; to: string };
  };
}

/** Every non-2xx reply carries this. */
export interface ErrorReply {
  error: string;
}

/**
 * `POST /api/options` body. A level is absent when it has not been chosen yet;
 * the server derives everything it can from the deepest one present.
 *
 * The levels travel as values, because that is all the dropdown queries need.
 * The one exception is the semester's `title`, which carries the batch number
 * the portal wants for the section list - so the client sends it rather than
 * making the server remember it.
 */
export interface OptionsRequest {
  course?: string;
  semester?: string;
  /** Empty for IV Semester, which is why the server falls back to the value. */
  semesterTitle?: string;
  branch?: string;
  section?: string;
}

/**
 * `POST /api/register` body.
 *
 * Every level is sent whole rather than as a bare value, because
 * `ShowAcademicCalendar` needs each one twice - by identifier and by visible
 * text - and only the client still holds the labels. Passing values alone
 * returns nothing at all rather than failing, which is what the per-session
 * label cache used to solve.
 */
export interface RegisterRequest {
  course: Option;
  semester: Option;
  branch: Option;
  section: Option;
  subject: Option;
  /** dd/mm/yyyy, the format the portal expects. */
  from: string;
  to: string;
}
