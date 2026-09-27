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
 */
export interface OptionsRequest {
  course?: string;
  semester?: string;
  branch?: string;
  section?: string;
}

/**
 * `POST /api/register` body. Every level is required, because the portal's
 * `ShowAcademicCalendar` needs all of them by value *and* by label.
 */
export interface RegisterRequest {
  course: string;
  semester: string;
  branch: string;
  section: string;
  subject: string;
  /** dd/mm/yyyy, the format the portal expects. */
  from: string;
  to: string;
}
