import { expect } from "@playwright/test";

import { HttpError } from "../../server/http-error";
import type { DayWorkRequest } from "../../server/portal-conventions";
import type { PortalReader } from "../../server/portal-reader";
import type {
  Option,
  RegisterRequest,
  SemAbsencesRequest,
  SemStartRequest,
} from "../../shared/api";

export const opt = (
  value: string,
  label = `L${value}`,
  title = ""
): Option => ({
  value,
  label,
  title,
});
export const resolved = <T>(value: T): Promise<T> => Promise.resolve(value);
export const nth = <T>(list: readonly T[], n: number): T => {
  const hit = list[n];
  if (hit === undefined) {
    throw new Error(`expected at least ${n + 1} call(s), got ${list.length}`);
  }
  return hit;
};
/**
 * Holds every wrapped read at a gate until the test releases it. A handler
 * that asks two reads together starts both before either answers; one that
 * asks in sequence never starts the second, so the started pair below fails
 * the test without waiting on timing.
 */
export const startedPair = (
  reader: PortalReader,
  run: (reader: PortalReader) => Promise<unknown>
): { started: string[]; loaded: Promise<unknown>; release: () => void } => {
  const started: string[] = [];
  const gate = Promise.withResolvers<undefined>();
  const held: PortalReader = {
    ...reader,
    register: (...args: Parameters<PortalReader["register"]>) => {
      started.push("register");
      return gate.promise.then(() => reader.register(...args));
    },
    classAttendance: (...args: Parameters<PortalReader["classAttendance"]>) => {
      started.push("class");
      return gate.promise.then(() => reader.classAttendance(...args));
    },
    subjectOptions: (...args: Parameters<PortalReader["subjectOptions"]>) => {
      started.push("offered");
      return gate.promise.then(() => reader.subjectOptions(...args));
    },
    studentProfile: (...args: Parameters<PortalReader["studentProfile"]>) => {
      started.push("profile");
      return gate.promise.then(() => reader.studentProfile(...args));
    },
    studentWise: (...args: Parameters<PortalReader["studentWise"]>) => {
      started.push("wise");
      return gate.promise.then(() => reader.studentWise(...args));
    },
  };
  return { started, loaded: run(held), release: () => gate.resolve(undefined) };
};
export const bothStarted = (
  started: string[],
  first: string,
  second: string
): void => {
  expect(started.toSorted()).toEqual([first, second].toSorted());
};
export type Calls = {
  courses: number;
  branches: number;
  sections: [string, string, string, string | undefined][];
  subjects: [string, string, string][];
  register: (RegisterRequest & Record<string, unknown>)[];
  classAttendance: (RegisterRequest & Record<string, unknown>)[];
  studentProfile: string[];
  studentWise: [string, string][];
  /** The window each Student Wise read was asked over. */
  studentWiseWindows: { from: string; to: string }[];
  /** What each day-class-work read was asked for. */
  dayWork: DayWorkRequest[];
  /** The subject ids each subject report was asked for. */
  subjectReports: string[];
  /** Each Cumulative read: roll, name, and the window asked. */
  studentCumulative: [string, string, string, string][];
};
export const oneRow = `<table><tr><th>Sl.No</th><th>Roll No</th><th>Name</th><th>Attend / Held</th><th>%</th></tr>
<tr><td>1</td><td>21CS001</td><td>A Student</td><td>38/45</td><td>84.44</td></tr></table>`;
export const twoRows = `<table><tr><th>Sl.No</th><th>Roll No</th><th>Name</th><th>Attend / Held</th><th>%</th></tr>
<tr><td>1</td><td>21CS001</td><td>A Student</td><td>38/45</td><td>84.44</td></tr>
<tr><td>2</td><td>21CS002</td><td>B Student</td><td>20/45</td><td>44.44</td></tr></table>`;
export const classGrid = (rows: [string, string, string][]): string =>
  `<table>
    <tr><td>ATTENDANCE REPORT FOR THE PERIOD OF</td></tr>
    <tr><th>Sl.No</th><th>Roll.No</th><th>Student Name</th><th>AI</th><th>Total</th><th>Percent</th></tr>
    <tr><td>Batch-1</td><td>50</td><td>0</td><td>49</td><td></td><td></td></tr>
    ${rows
      .map(
        ([roll, total, pct], i) =>
          `<tr><td>${i + 1}</td><td>${roll}</td><td>Name ${i + 1}</td><td>37</td><td>${total}</td><td>${pct}</td></tr>`
      )
      .join("")}
  </table>`;
export const subjectGrid = (
  subject: string,
  rows: [string, string][]
): string =>
  `<table>
    <tr><th>Sl.No</th><th>Roll.No</th><th>Student Name</th><th>${subject}</th><th>Percent</th></tr>
    ${rows
      .map(
        ([roll, pct], i) =>
          `<tr><td>${i + 1}</td><td>${roll}</td><td>Name ${i + 1}</td><td>1</td><td>${pct}</td></tr>`
      )
      .join("")}
  </table>`;
export const ONE_CLASS_ROW = classGrid([["21CS001", "381\\481", "79.21"]]);
/** The Cumulative student-wise register, shaped as ECAP sends it: the reply's
 *  own legend (colour -> words), then one row per day with a period per cell.
 *  Green is a holiday and carries no text; a cell with a subject and no colour
 *  was attended. Three days of seven periods is 21 held, 21 attended — the
 *  figure the screen prints for a clean window. */
export const CUMULATIVE_GRID = `<table><tr><td>
<div style='width:30px;height:15px;background-color:Green;float:left'></div><div class='reportData2'>&nbsp;Holiday</div>
<div style='width:30px;height:15px;background-color:Yellow;float:left'></div><div class='reportData2'>&nbsp;Absent</div>
<div style='width:30px;height:15px;background-color:Red;float:left'></div><div class='reportData2'>&nbsp;Not Entered</div>
<div style='width:30px;height:15px;background-color:Purple;float:left'></div><div class='reportData2'>&nbsp;No Class Work</div>
</td></tr></table>
<table>
<tr><td>Date</td><td>1 Hour</td><td>2 Hour</td><td>3 Hour</td><td>4 Hour</td><td>5 Hour</td><td>6 Hour</td><td>7 Hour</td></tr>
<tr><td align='center' class='cellBorder'>01/11/2026</td><td class='cellBorder' style='background-color:Green'></td><td class='cellBorder' style='background-color:Green'></td><td class='cellBorder' style='background-color:Green'></td><td class='cellBorder' style='background-color:Green'></td><td class='cellBorder' style='background-color:Green'></td><td class='cellBorder' style='background-color:Green'></td><td class='cellBorder' style='background-color:Green'></td></tr>
<tr><td align='center' class='cellBorder'>02/11/2026</td><td class='cellBorder' style='background-color:'>JP</td><td class='cellBorder' style='background-color:'>MFCS</td><td class='cellBorder' style='background-color:'>SE</td><td class='cellBorder' style='background-color:'>DL&amp;CO</td><td class='cellBorder' style='background-color:'>SE</td><td class='cellBorder' style='background-color:'>LCS</td><td class='cellBorder' style='background-color:'>LCS</td></tr>
<tr><td align='center' class='cellBorder'>03/11/2026</td><td class='cellBorder' style='background-color:'>MFCS</td><td class='cellBorder' style='background-color:'>DL&amp;CO</td><td class='cellBorder' style='background-color:'>SE</td><td class='cellBorder' style='background-color:'>SE</td><td class='cellBorder' style='background-color:'>UHV</td><td class='cellBorder' style='background-color:'>PP Lab</td><td class='cellBorder' style='background-color:'>PP Lab</td></tr>
<tr><td align='center' class='cellBorder'>04/11/2026</td><td class='cellBorder' style='background-color:'>WT TEST</td><td class='cellBorder' style='background-color:'>WT TEST</td><td class='cellBorder' style='background-color:'>DL&amp;CO</td><td class='cellBorder' style='background-color:'>MFCS</td><td class='cellBorder' style='background-color:'>SE</td><td class='cellBorder' style='background-color:'>DTI</td><td class='cellBorder' style='background-color:'>DTI</td></tr>
</table>`;
/** Enough of the StudentProfile page for the handler: parsing is covered where
 *  the parser is, over the real page. */ export const PROFILE_PAGE = `<div id='divProfile_BioData'><table>
<tr><td>Mobile.No</td><td>:</td><td>7661864881</td></tr></table>
<center><span>CGPA:&nbsp;5.61&nbsp;&nbsp;&nbsp;Credits:16/19&nbsp;&nbsp;&nbsp;&nbsp;48.55&nbsp;%</span></center></div>`;
/** A Student Wise report: one row per subject, one column per day the section
 *  met, and one mark per period inside a cell. MFCS says `A` on 05/08 and SE on
 *  06/08, so the student missed both dates, each once. */
export const STUDENT_GRID = `<table>
<tr><th>Sl.No</th><th>Subject</th><th>05/08</th><th>06/08</th><th>07/08</th><th>Atted/Held</th><th>%</th></tr>
<tr><td>1</td><td>MFCS</td><td>P&nbsp;P</td><td>A&nbsp;A</td><td>-</td><td>12/14</td><td>85.71</td></tr>
<tr><td>2</td><td>SE</td><td>A</td><td>P</td><td>P</td><td>10/14</td><td>71.43</td></tr>
</table>`;
export const fake = (
  answers: {
    course?: Option[];
    branch?: Option[];
    semester?: Option[];
    section?: Option[];
    subject?: Option[];
    register?: string;
    classAttendance?: string;
    classFails?: boolean;
    studentProfile?: string;
    studentWise?: string;
    /** The Cumulative register's reply, whose grid the totals are counted from. */
    studentCumulative?: string;
    /** The subjects the SUBJECT ATTENDANCE page offers for the class. */
    offeredSubjects?: Option[];
    /** When true the offered-subject listing itself fails with a 502. */
    offeredFails?: boolean;
    /** One subject report grid per offered subject value. A missing subject
     *  answers an empty grid. Listed here by value because the class report
     *  only states labels. */
    subjectReports?: Record<string, string>;
    /** Subject values whose report ECAP refuses with a 502. */
    subjectFails?: string[];
    /** The dashboard's schedule fragment for today. */
    today?: string;
    /** The day-class-work report's fragment for the branch and date. */
    dayWork?: string;
    /** A Student Wise grid per month-step start, so the walk can be driven
     *  month by month. A month missing from the map answers empty, which is
     *  what stops the walk. */
    studentWiseMonths?: Record<string, string>;
    studentFails?: boolean;
  } = {}
): { reader: PortalReader; calls: Calls } => {
  const calls: Calls = {
    courses: 0,
    branches: 0,
    sections: [],
    subjects: [],
    register: [],
    classAttendance: [],
    studentProfile: [],
    studentWise: [],
    studentWiseWindows: [],
    dayWork: [],
    subjectReports: [],
    studentCumulative: [],
  };
  const reader: PortalReader = {
    courses: () => {
      calls.courses += 1;
      return resolved(answers.course ?? [opt("1", "B.Tech")]);
    },
    branchesAndSemesters: () => {
      calls.branches += 1;
      return resolved([
        answers.branch ?? [opt("6", "IT")],
        answers.semester ?? [opt("3", "III")],
      ]);
    },
    sections: (c, b, s, title) => {
      calls.sections.push([c, b, s, title]);
      return resolved(answers.section ?? [opt("1", "Section-1")]);
    },
    subjects: (c, b, s) => {
      calls.subjects.push([c, b, s]);
      return resolved(answers.subject ?? [opt("57", "MFCS")]);
    },
    subjectOptions: () => {
      if (answers.offeredFails) {
        return Promise.reject(new HttpError(502, "subject list unavailable"));
      }
      return resolved(answers.offeredSubjects ?? [opt("9", "AI")]);
    },
    subjectReport: (p, subject) => {
      calls.subjectReports.push(String(subject.value));
      if (answers.subjectFails?.includes(String(subject.value))) {
        return Promise.reject(new HttpError(502, "subject report unavailable"));
      }
      const html = answers.subjectReports?.[String(subject.value)];
      return resolved(html ?? subjectGrid(String(subject.label), []));
    },
    register: (p) => {
      calls.register.push(p as RegisterRequest & Record<string, unknown>);
      return resolved(answers.register ?? oneRow);
    },
    classAttendance: (p) => {
      calls.classAttendance.push(
        p as RegisterRequest & Record<string, unknown>
      );
      if (answers.classFails) {
        return Promise.reject(new HttpError(502, "class report unavailable"));
      }
      return resolved(answers.classAttendance ?? ONE_CLASS_ROW);
    },
    studentProfile: (roll) => {
      calls.studentProfile.push(roll);
      return resolved(answers.studentProfile ?? PROFILE_PAGE);
    },
    studentWise: (roll, name, p) => {
      calls.studentWise.push([roll, name]);
      calls.studentWiseWindows.push({ from: p.from, to: p.to });
      if (answers.studentFails) {
        return Promise.reject(new HttpError(502, "student report unavailable"));
      }
      return resolved(
        answers.studentWiseMonths?.[p.from] ??
          answers.studentWise ??
          STUDENT_GRID
      );
    },
    studentCumulative: (roll, name, p) => {
      calls.studentCumulative.push([roll, name, p.from, p.to]);
      if (answers.studentFails) {
        return Promise.reject(new HttpError(502, "student report unavailable"));
      }
      return resolved(answers.studentCumulative ?? CUMULATIVE_GRID);
    },
    facultyProfile: () =>
      resolved({
        name: "Test Faculty",
        photo: "",
        designation: "0",
        leaveStatus: [],
      }),
    todayClasses: () => resolved(answers.today ?? ""),
    dayClassWork: (p) => {
      calls.dayWork.push(p);
      return resolved(answers.dayWork ?? "");
    },
  };
  return { reader, calls };
};
export const levels = (
  partial: Partial<RegisterRequest> = {}
): RegisterRequest => ({
  course: opt("1", "B.Tech"),
  semester: opt("3", "III Semester", "2025"),
  branch: opt("6", "Information Technology"),
  section: opt("1", "Section-1"),
  subject: opt("57", "MFCS", "Theory"),
  from: "01/01/2026",
  to: "28/09/2026",
  ...partial,
});
export const semAbsencesAsked = (
  roll = "21CS001",
  partial: Partial<RegisterRequest> = {}
): SemAbsencesRequest => ({
  roll,
  name: "A",
  register: levels(partial),
  from: "05/08/2026",
});
export const deadSession = () =>
  Promise.reject(new HttpError(401, "Your ECAP session expired."));
export const walkDated = (date: string): string => `<table>
    <tr><th>Sl.No</th><th>Roll.No</th><th>Name</th><th>${date}</th><th>Attend/Held</th><th>%</th></tr>
    <tr><td>1</td><td>21CS001</td><td>A</td><td>P</td><td>1/1</td><td>100</td></tr>
  </table>`;
export const walked = (
  extra: Record<string, unknown> = {}
): SemStartRequest => ({
  ...levels({ from: "01/10/2026", to: "18/10/2026" }),
  walkBack: 2,
  ...extra,
});

/** A profile page that states the class, which the real one is expected to: the
 *  search has nothing to resolve without it. */
export const CLASS_PAGE = `<div id='divProfile_BioData'><table>
<tr><td>Course</td><td>:</td><td>B.Tech</td></tr>
<tr><td>Branch</td><td>:</td><td>IT</td></tr>
<tr><td>Semester</td><td>:</td><td>III</td></tr>
<tr><td>Section</td><td>:</td><td>Section-1</td></tr>
<tr><td>Mobile.No</td><td>:</td><td>7661864881</td></tr></table>
<center><span>CGPA:&nbsp;5.61&nbsp;&nbsp;&nbsp;Credits:16/19&nbsp;&nbsp;&nbsp;&nbsp;48.55&nbsp;%</span></center></div>`;
export const ask = { from: "01/10/2025", to: "22/10/2025" };
/** A Student Wise month: one meeting day, missed, so the walk keeps going. */
export const monthGrid = (date: string): string => `<table>
<tr><th>Sl.No</th><th>Subject</th><th>${date}</th><th>Atted/Held</th><th>%</th></tr>
<tr><td>1</td><td>MFCS</td><td>A</td><td>0/1</td><td>0</td></tr></table>`;

export const CLASS_PAGE_NO_SEM = `<div id='divProfile_BioData'><table>
<tr><td>Course</td><td>:</td><td>B.Tech</td></tr>
<tr><td>Branch</td><td>:</td><td>IT</td></tr>
<tr><td>Section</td><td>:</td><td>Section-1</td></tr>
<tr><td>Mobile.No</td><td>:</td><td>7661864881</td></tr></table>
<center><span>CGPA:&nbsp;8.05&nbsp;&nbsp;&nbsp;Credits:40/40&nbsp;&nbsp;&nbsp;&nbsp;73.00&nbsp;%</span></center>
<span>II Semester</span><table><tr><th>X</th><th>SGPA</th></tr><tr><td>Grade</td><td>7.66</td></tr></table></div>`;
export const CLASS_PAGE_NO_SGPA = `<div id='divProfile_BioData'><table>
<tr><td>Course</td><td>:</td><td>B.Tech</td></tr>
<tr><td>Branch</td><td>:</td><td>IT</td></tr>
<tr><td>Section</td><td>:</td><td>Section-1</td></tr>
<tr><td>Mobile.No</td><td>:</td><td>7661864881</td></tr></table>
<center><span>CGPA:&nbsp;8.05&nbsp;&nbsp;&nbsp;Credits:40/40&nbsp;&nbsp;&nbsp;&nbsp;73.00&nbsp;%</span></center></div>`;
/** One section block with the report's own geometry: a posted period with
 *  both counts, and a held period with neither. */
export const DAYWORK = `<b>Course:</b>&nbsp;B.Tech<div><b>Branch:</b>&nbsp;Information Technology</div><div><b>Semester:</b>&nbsp;III Semester</div><div><b>Section:</b>&nbsp;B</div>
<table><tr><td>Period</td><td>Subject</td><td>Name of the staff</td><td>Unit.No</td><td>Topics Covered</td><td>Present</td><td>Absent</td><td>Rolls</td></tr>
<tr><td>1</td><td>MFCS</td><td>Some One</td><td>-</td><td>-</td><td>30</td><td>5</td><td>21B</td></tr>
<tr><td>2</td><td>SE</td><td>Other Two</td><td>-</td><td>-</td><td></td><td></td><td></td></tr></table>`;
export const itBranch = [
  opt("0", "-Branch-"),
  opt("6", "Information Technology", "IT"),
];
export const cseBranch = opt("11", "CSE (AI)", "CSE (AI)");
export const titledSemesters = [
  opt("2", "III Semester", "2025"),
  opt("4", "V Semester", "2024"),
];
/**
 * Independent portal reads go out together, never one after another. Each
 * test holds every read in the pair at a gate: a handler that asks one
 * after the other never starts the second, so the assertion on the started
 * pair fails without waiting on timing.
 */
