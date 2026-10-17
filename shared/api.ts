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
  persisted: boolean;
  userId: string;
}
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
}
export interface StudentRequest {
  roll: string;
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
