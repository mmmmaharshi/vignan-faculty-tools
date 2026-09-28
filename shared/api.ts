export interface Option {
  value: string;
  label: string;
  title: string;
}
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
