export interface Option {
  value: string;
  label: string;
  title: string;
}
/**
 * The subject level's extra entry: not a Portal subject, but a way of asking for
 * every subject in the section at once. Its identifier cannot collide with a
 * real one, which is always numeric.
 */
export const ALL_SUBJECTS: Option = {
  value: "__all__",
  label: "All subjects",
  title: "",
};
export const isAllSubjects = (subject: Option | undefined): boolean =>
  subject?.value === ALL_SUBJECTS.value;
export interface SessionReply {
  signedIn: boolean;
  persisted: boolean;
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
  };
}
export interface ErrorReply {
  error: string;
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
