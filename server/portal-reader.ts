import type { CascadeLevel, FacultyProfile, Option } from "../shared/api.js";
import type { DayWorkRequest } from "./portal-conventions.js";

export type Level = CascadeLevel;
/**
 * Everything a route handler needs from ECAP, one method per Portal screen it
 * reads. The handlers depend on this and nothing else, so a test drives them
 * over a fake portal and the real one is an implementation of the same shape.
 */
export type PortalReader = {
  courses: () => Promise<Option[]>;
  branchesAndSemesters: (courseId: string) => Promise<[Option[], Option[]]>;
  sections: (
    courseId: string,
    branchId: string,
    semester: string,
    semesterTitle?: string
  ) => Promise<Option[]>;
  subjects: (
    courseId: string,
    branchId: string,
    semesterId: string
  ) => Promise<Option[]>;
  register: (
    p: Record<Level, Option> & { from: string; to: string }
  ) => Promise<string>;
  classAttendance: (
    p: Record<Level, Option> & { from: string; to: string }
  ) => Promise<string>;
  /** The subjects the SUBJECT ATTENDANCE page offers for one class. */
  subjectOptions: (
    courseId: string | number,
    branchId: string | number,
    semesterId: string | number
  ) => Promise<Option[]>;
  /** One subject's attendance report for the whole section. */
  subjectReport: (
    p: Record<Level, Option> & { from: string; to: string },
    subject: Option
  ) => Promise<string>;
  /** The StudentProfile page's markup for one roll number. */
  studentProfile: (roll: string) => Promise<string>;
  facultyProfile: () => Promise<FacultyProfile>;
  /** The Student Wise report: one student's grid, every subject, one column per
   *  day the section met. */
  studentWise: (
    roll: string,
    name: string,
    p: Record<Level, Option> & { from: string; to: string }
  ) => Promise<string>;
  /** The Cumulative student-wise register, whose day grid carries the held /
   *  attended / absent marks the panel's totals are counted from. */
  studentCumulative: (
    roll: string,
    name: string,
    p: Record<Level, Option> & { from: string; to: string }
  ) => Promise<string>;
  /** The faculty dashboard's schedule fragment for today. */
  todayClasses: () => Promise<string>;
  /** The day-class-work report's fragment for the asked branches and date. */
  dayClassWork: (p: DayWorkRequest) => Promise<string>;
};
