export interface Option {
  value: string;
  label: string;
  title: string;
}
/**
 * The subject level's extra entry: not a Portal subject, but a way of asking for
 * every subject in the section at once. Its identifier cannot collide with a
 * real one, which is always numeric. It leads the list and is upper-cased so it
 * cannot be mistaken for one of the Portal's own short codes.
 */
export const ALL_SUBJECTS: Option = {
  value: "__all__",
  label: "ALL SUBJECTS",
  title: "",
};
export const isAllSubjects = (subject: Option | undefined): boolean =>
  subject?.value === ALL_SUBJECTS.value;
export interface SessionReply {
  signedIn: boolean;
  userId: string;
}
/**
 * The session, as the browser keeps it in localStorage and sends it back on
 * every request. The server holds nothing per user, so any instance — a
 * long-running Bun process or a serverless function — answers any request
 * from this alone: the credential re-establishes the portal session when ECAP
 * drops it, and `at` bounds the session's own life.
 */
export interface ClientSession {
  userId: string;
  /** The ECAP password, in the clear: this site trades vault storage for a
   *  server with no per-user state. Anyone holding the browser's storage
   *  holds the ECAP account with it. */
  password: string;
  cookies: [string, string][];
  /** When the server last saw this session. Requests older than thirty days
   *  of not using it are refused. */
  at: number;
}
/** Where the browser keeps its session, and the header that carries it. */
export const SESSION_STORE_KEY = "ecap-session";
export const SESSION_HEADER = "x-ecap-session";
export interface OkReply {
  ok: true;
}
export interface LoginRequest {
  userId: string;
  password: string;
}
export type CascadeLevel =
  | "course"
  | "semester"
  | "branch"
  | "section"
  | "subject";
export interface OptionsReply {
  course: Option[];
  semester: Option[];
  branch: Option[];
  section: Option[];
  subject: Option[];
  emptyLevels: CascadeLevel[];
}
export interface Student {
  sl: string;
  roll: string;
  name: string;
  attendedOfHeld: string;
  pct: number | null;
  irregular: boolean;
  critical: boolean;
  overallPct: number | null;
  overallAttendedOfHeld: string;
  overallIrregular: boolean;
  overallCritical: boolean;
  /** Dates (dd/mm) the register states "A" for this student. Read from the
   *  register's own grid — no extra Portal call. */
  absent: string[];
}
export interface RegisterReply {
  students: Student[];
  summary: {
    total: number;
    irregular: number;
    critical: number;
    irregularBelow: number;
    criticalBelow: number;
    average: number | null;
    overallAverage: number | null;
    overallIrregular: number;
    overallCritical: number;
    range: { from: string; to: string };
    /** Days the subject met in the range, read from the register's own date
     *  columns — the Portal's count, holidays absent by construction. Null on
     *  the All subjects path, whose report aggregates by subject and states
     *  no dates, and wherever the grid states none. */
    classesHeld: number | null;
    /** The first date the register's own grid states, as a full dd/mm/yyyy
     *  date. The Portal keeps no data before the semester started, so this is
     *  where the figures actually begin; the client snaps its From input here
     *  after a load. Null where the register states no dates. */
    statedFrom: string | null;
    /** The register's own date columns (dd/mm), for client-side fallback when
     *  statedFrom could not be resolved server-side. Empty on the All subjects
     *  path and wherever the grid states no dates. */
    dates: string[];
  };
}
export interface ErrorReply {
  error: string;
}
/** One of the numbers ECAP's StudentProfile page states, under ECAP's own label
 *  ("Mobile.No", "Father Mobile.No"). */
export interface StudentPhone {
  label: string;
  number: string;
}
/** One semester the Portal states an SGPA for, under the Portal's own label
 *  ("I Semester"). */
export interface StudentSgpa {
  semester: string;
  value: string;
}
/** One subject ECAP lists under a student's backlogs. The page marks some of
 *  them in red with a leading asterisk and does not say what the mark means, so
 *  it is kept as written and not explained. */
export interface StudentBacklogSubject {
  code: string;
  marked: boolean;
}
/** One semester's backlogs, as ECAP's own backlogs table states them. */
export interface StudentBacklog {
  /** The semester the page names the row under ("I Semester"). */
  semester: string;
  subjects: StudentBacklogSubject[];
}
/** The backlogs the StudentProfile page states, as that page's section states
 *  them. A page with none says so in words on one build and leaves the section
 *  empty on another, so its words are carried rather than lost. */
export interface StudentBacklogs {
  /** One entry per semester the page lists. */
  rows: StudentBacklog[];
  /** The page's own total, where it states one ("Total backlogs: 1"). */
  total: number | null;
  /** The page's own words where it states there are none ("Student have no
   *  backlogs") — an answer, not an empty table. Empty where it said nothing. */
  note: string;
}
/**
 * What ECAP's StudentProfile page states about one student. Read, never
 * computed: `cgpaPercent` is the figure the page prints beside the CGPA, and a
 * student with no past semesters has the page's own "NA" for a CGPA. Anything
 * the page left blank is an empty string, which the panel renders as nothing.
 */
export interface StudentProfile {
  cgpa: string;
  credits: string;
  cgpaPercent: string;
  sgpa: StudentSgpa[];
  phones: StudentPhone[];
  /** The backlogs the page's own backlogs section states. */
  backlogs: StudentBacklogs;
  /** The dates this student missed, unioned over every subject, out of the
   *  Student Wise report — read only when the register on screen is the All
   *  subjects view, whose own report aggregates by subject and states no dates.
   *  Left out when ECAP would not give it, which is not a clean sheet. */
  absent?: string[];
}
/** One student's absent days over a wider window than the register on screen —
 *  asked with the remembered semester start so the panel can name a full-sem
 *  list beside the window's own. The window is the same register read twice
 *  (subject grid) or the same Student Wise read twice (All subjects), never a
 *  new kind of Portal call. */
export interface SemAbsencesRequest {
  roll: string;
  name: string;
  register: RegisterRequest;
  /** dd/mm/yyyy start of the wider window. */
  from: string;
}
export interface SemAbsencesReply {
  /** Absent when ECAP would not give the wider read — not a clean sheet. */
  absent?: string[];
}
/** The earliest day ECAP holds for one subject inside the asked window: the
 *  register's own first date column, resolved to a full dd/mm/yyyy date. Null
 *  where the register states no dates. Read by `handleSemStart`, which asks
 *  the subject register the All subjects report cannot be. */
export interface SemStartReply {
  statedFrom: string | null;
}
/** One leave type's per-stage counts, as the APPLY-SELF page's `showLeaves`
 *  reply states them. */
export interface LeaveStatus {
  /** The leave type as the grid names it ("Eligible Casual Leave"). */
  type: string;
  eligible: string;
  applied: string;
  approved: string;
  pending: string;
  declined: string;
  available: string;
}
/** What ECAP states about the signed-in faculty member: the name from the
 *  `lblUser` span, the photo URL (GetPhotoPath), the designation code
 *  (CheckEmployeeDesignation: 0 = faculty), and the leave counts from the
 *  APPLY-SELF page. Read once when the profile page is opened. */
export interface FacultyProfile {
  name: string;
  photo: string;
  designation: string;
  /** One entry per leave type in the `showLeaves` grid. Empty when ECAP did
   *  not state any, which is not the same as all zeros. */
  leaveStatus: LeaveStatus[];
}
export interface StudentRequest {
  roll: string;
  /** The student's name, which the Student Wise report is asked for by. */
  name?: string;
  /** The register this student's row was read from, so the panel can ask for
   *  that one student's own grid over the same range. The subject path needs no
   *  such call: its register rows already state the dates. */
  register?: RegisterRequest;
}
export interface OptionsRequest {
  course?: string;
  semester?: string;
  semesterTitle?: string;
  branch?: string;
  section?: string;
}
export interface RegisterRequest {
  course: Option;
  semester: Option;
  branch: Option;
  section: Option;
  subject: Option;
  from: string;
  to: string;
}
