import { test, expect } from "@playwright/test";

import {
  level,
  looksLikeHtml,
  matchOption,
  options,
  parseClassAttendance,
  parseLeaveStatus,
  parseRegister,
  parseStudentAbsences,
  parseStudentBacklogs,
  parseDayClassWork,
  parseStudentClass,
  parseStudentProfile,
  parseTodayClasses,
  realOptions,
  registerDates,
  studentWiseDates,
  unquoteJs,
} from "../server/portal-replies";

const SELECT = `<select id="ddlcourse">
  <option value="-Select-">-Select-</option>
  <option value="1" title="2024">B.Tech</option>
  <option value="2" title="">M.Tech</option>
  <option title="3">No identifier here</option>
  <option value="4">   </option>
</select>`;
const LOGIN_PAGE = `<!DOCTYPE html><html><head><title>ECAP</title></head><body>Sign in</body></html>`;
const SELECT_ONLY_PLACEHOLDER = `<select><option value="-Select-">-Select-</option></select>`;
/** The Student Wise report's grid: one row per subject, one mark per period inside
 *  a cell. Deliberately not `routes.spec.ts`'s fixture — it carries a third
 *  subject, because the union across rows is what this test reads. */
const STUDENT_WISE_GRID = `<table>
  <tr><th>Sl.No</th><th>Subject</th><th>05/08</th><th>06/08</th><th>07/08</th><th>Atted/Held</th><th>%</th></tr>
  <tr><td>1</td><td>MFCS</td><td>P&nbsp;P</td><td>A&nbsp;A</td><td>-</td><td>12/14</td><td>85.71</td></tr>
  <tr><td>2</td><td>SE</td><td>A</td><td>P</td><td>P</td><td>10/14</td><td>71.43</td></tr>
  <tr><td>3</td><td>UHV</td><td>P</td><td>P</td><td>A</td><td>12/14</td><td>85.71</td></tr>
</table>`;
/** The dashboard's GetToDayClasses fragment, read live 2026-10-24: the shape
 *  every teaching-day assertion is pinned against. */
const TODAY_GRID = `<table width='100%' cellspacing='0' cellpadding='2' class='table'><tr class='card-header bg-info text-white'><td align='left' colspan='2'>TODAY CLASS WORK</td></tr><tr><td valign='top'><table width='100%' cellpadding='2' cellspacing='0' id='tblschedule'><tr><td align='left' >Period-1<br/>08:45 AM- 09:35 AM</td><td align='center' >FLUTER LAB (CSE (AI))<br/>B.Tech V Semester, Sec-B</td></tr><tr><td align='left' >Period-2<br/>09:35 AM- 10:25 AM</td><td align='center' >FLUTER LAB (CSE (AI))<br/>B.Tech V Semester, Sec-B</td></tr><tr><td align='left' >Period-3<br/>10:50 AM- 11:40 AM</td><td align='center' >FLUTER LAB (CSE (AI))<br/>B.Tech V Semester, Sec-B</td></tr><tr><td align='left' >Period-4<br/>11:40 AM- 12:30 PM</td><td align='center' >AI (IT)<br/>B.Tech V Semester, Sec-C</td></tr><tr><td align='left' >Period-5<br/>12:30 PM- 01:20 PM</td><td align='center' ></td></tr><tr><td align='left' >Period-6<br/>02:20 PM- 03:10 PM</td><td align='center' >JAVA PROGR (CSE (AI))<br/>B.Tech III Semester, Sec-D</td></tr><tr><td align='left' >Period-7<br/>03:10 PM- 04:00 PM</td><td align='center' >LIB/SPORTS (CSE (AI))<br/>B.Tech III Semester, Sec-D<hr/>ADDON (CSE (AI))<br/>B.Tech III Semester, Sec-B</td></tr></table></td></tr><tr><td>&nbsp;</td></tr></table>`;
test.describe("portal replies", () => {
  test("a dead session's markup is told apart from real data", () => {
    expect(looksLikeHtml(LOGIN_PAGE)).toBe(true);
    expect(looksLikeHtml('  <html lang="en">')).toBe(true);
    expect(
      looksLikeHtml("'<select><option value=\"1\">B.Tech</option></select>'")
    ).toBe(false);
    expect(looksLikeHtml('{"value":"<table></table>"}')).toBe(false);
    expect(looksLikeHtml("<option value='1'>B.Tech</option>")).toBe(false);
  });
  test("unquoteJs always hands back a string", () => {
    expect(unquoteJs("'<b>hi</b>'")).toBe("<b>hi</b>");
    expect(unquoteJs('{"value":"<table></table>"}')).toBe("<table></table>");
    expect(unquoteJs('{"d":"<table></table>"}')).toBe("<table></table>");
    expect(unquoteJs("{value:'<table></table>'}")).toBe(
      "{value:'<table></table>'}"
    );
    expect(typeof unquoteJs('{"value":42}')).toBe("string");
    expect(unquoteJs('{"value":42}')).toBe('{"value":42}');
    expect(typeof unquoteJs('{"error":"nope"}')).toBe("string");
    expect(unquoteJs("")).toBe("");
    expect(unquoteJs("'a\\'b'")).toBe("a'b");
  });
  test("options drops placeholders and entries with no identifier", () => {
    const all = options(SELECT);
    expect(all.map((o) => o.value)).toEqual(["-Select-", "1", "2"]);
    expect(realOptions(all).map((o) => o.value)).toEqual(["1", "2"]);
    expect(realOptions(all).map((o) => o.label)).toEqual(["B.Tech", "M.Tech"]);
    expect(all[1]?.title).toBe("2024");
    expect(all[2]?.title).toBe("");
    expect(options(undefined)).toEqual([]);
    expect(options(null)).toEqual([]);
    expect(options("<p>no selects here</p>")).toEqual([]);
  });
  test("level reports an empty list instead of blocking on it", () => {
    const real = realOptions(options(SELECT));
    const ok = level(real);
    expect(ok.empty).toBe(false);
    expect(ok.choices).toBe(real);
    const empty = level([]);
    expect(empty.empty).toBe(true);
    expect(empty.choices).toEqual([]);
    expect(level(realOptions(options(SELECT_ONLY_PLACEHOLDER))).empty).toBe(
      true
    );
  });
  test("parseRegister keeps a student whose percentage will not parse", () => {
    const html = `<table>
      <tr><th>Sl.No</th><th>Roll No</th><th>Student Name</th><th>Attend/Held</th><th>%</th></tr>
      <tr><td>1</td><td>21CS001</td><td>Asha Rao</td><td>38/45</td><td>84.44</td></tr>
      <tr><td>2</td><td>21CS002</td><td>Bimal Shah</td><td>20/45</td><td>n/a</td></tr>
      <tr><td>3</td><td>21CS003</td><td>Chitra Iyer</td><td>45/45</td><td>100.00</td></tr>
    </table>`;
    const rows = parseRegister(html);
    expect(rows).toHaveLength(3);
    expect(rows[0]).toMatchObject({
      roll: "21CS001",
      name: "Asha Rao",
      attendedOfHeld: "38/45",
      pct: 84.44,
    });
    expect(rows[1]?.pct).toBeNull();
    expect(rows[2]?.pct).toBe(100);
    expect(rows[0]?.attendedOfHeld).toBe("38/45");
    expect(parseRegister(LOGIN_PAGE)).toEqual([]);
    expect(
      parseRegister("<table><tr><th>Something else</th></tr></table>")
    ).toEqual([]);
  });
  test("the register's date columns are read as its class days", () => {
    // A real Academic Register lays one column per day the subject met —
    // 10/10 to 16/10 here, with Sunday 11/10 simply absent — and the count is
    // the official working-days figure, never calendar arithmetic.
    const html = `<table>
      <tr><th>Sl.No</th><th>Roll No</th><th>Student Name</th><th>10/10</th><th>12/10</th><th>13/10</th><th>Attend/Held</th><th>%</th></tr>
      <tr><td>1</td><td>21CS001</td><td>Asha Rao</td><td>P</td><td>A</td><td>P</td><td>2/3</td><td>66.67</td></tr>
    </table>`;
    expect(registerDates(html)).toEqual(["10/10", "12/10", "13/10"]);
    const rows = parseRegister(html);
    expect(
      rows[0]?.absent,
      "the A cells are read under their own date headers"
    ).toEqual(["12/10"]);
    expect(
      parseRegister(
        `<table><tr><th>Sl.No</th><th>Roll No</th><th>Name</th><th>Attend / Held</th><th>%</th></tr>
        <tr><td>1</td><td>21CS001</td><td>A</td><td>38/45</td><td>84.44</td></tr></table>`
      )[0]?.absent
    ).toEqual([]);
    expect(
      registerDates(
        `<table><tr><th>Sl.No</th><th>Roll No</th><th>Name</th><th>Attend / Held</th><th>%</th></tr>
        <tr><td>1</td><td>21CS001</td><td>A</td><td>38/45</td><td>84.44</td></tr></table>`
      )
    ).toEqual([]);
    expect(registerDates(LOGIN_PAGE)).toEqual([]);
    // An empty range heads its one column "0/0"; that is a placeholder, not a
    // day the subject met, so it is not a class day.
    expect(
      registerDates(
        `<table><tr><th>Sl.No</th><th>Roll No</th><th>Student Name</th><th>0/0</th><th>Attend/Held</th><th>%</th></tr></table>`
      )
    ).toEqual([]);
  });
  test("the class report is read from the portal's own last two cells", () => {
    const html = `<center><div id='tblReport'><table width='95%'>
      <tr><td>Course</td><td>:</td><td>B.Tech</td></tr>
      <tr><td>ATTENDANCE REPORT FOR THE PERIOD OF 01/06/2026 - 29/09/2026</td></tr>
      <tr><th>Sl.No</th><th>Roll.No</th><th>Student Name</th><th>AI</th><th>DWDM</th><th>Total</th><th>Percent</th></tr>
      <tr><td>Batch-1</td><td>50</td><td>0</td><td>49</td><td>-</td><td></td><td></td></tr>
      <tr><td>1</td><td>24L31A1201</td><td>ADARI LASYA SHREE</td><td>37</td><td>-</td><td>381\\481</td><td>79.21</td></tr>
      <tr><td>2</td><td>24L31A1202</td><td>ANOTHER STUDENT</td><td>35</td><td>10</td><td>356\\481</td><td>74.01</td></tr>
      <tr><td>3</td><td>24L31A1203</td><td>NO PERCENTAGE</td><td>10</td><td>10</td><td>20\\30</td><td></td></tr>
    </table></div></center>`;
    const rows = parseClassAttendance(html);
    expect(rows).toHaveLength(3);
    expect(rows[0]).toEqual({
      sl: "1",
      roll: "24L31A1201",
      name: "ADARI LASYA SHREE",
      attendedOfHeld: "381\\481",
      pct: 79.21,
    });
    expect(rows[1]).toMatchObject({ roll: "24L31A1202", pct: 74.01 });
    expect(rows[2]?.pct).toBeNull();
    expect(rows[2]?.attendedOfHeld).toBe("20\\30");
  });
  test("the class report's held band and title block are not students", () => {
    const html = `<table>
      <tr><th>Sl.No</th><th>Roll.No</th><th>Student Name</th><th>Total</th><th>Percent</th></tr>
      <tr><td>Batch-1</td><td>50</td><td>0</td><td></td><td></td></tr>
      <tr><td>1</td><td>24L31A1201</td><td>ONLY STUDENT</td><td>381\\481</td><td>79.21</td></tr>
      <tr><td>Total</td><td>69</td><td>count</td><td></td><td></td></tr>
    </table>`;
    const rows = parseClassAttendance(html);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.roll).toBe("24L31A1201");
  });
  test("markup with no roll-number header yields no students at all", () => {
    expect(parseClassAttendance(LOGIN_PAGE)).toEqual([]);
    expect(
      parseClassAttendance("<table><tr><th>Subject</th></tr></table>")
    ).toEqual([]);
    expect(parseClassAttendance("")).toEqual([]);
  });
  test("a student's own grid states their absences across every subject", () => {
    // One row per subject, one mark per period inside a cell, so a date is
    // missed if any subject's cell for it carries an A — the union, in the
    // grid's own date order.
    expect(parseStudentAbsences(STUDENT_WISE_GRID)).toEqual([
      "05/08",
      "06/08",
      "07/08",
    ]);
    // A student with no A anywhere is an empty list, which is a real answer.
    expect(
      parseStudentAbsences(
        `<table><tr><th>Sl.No</th><th>Subject</th><th>05/08</th><th>Atted/Held</th><th>%</th></tr>
        <tr><td>1</td><td>MFCS</td><td>P</td><td>14/14</td><td>100.00</td></tr></table>`
      )
    ).toEqual([]);
    // Not that report at all: null, so nothing is claimed about the student.
    expect(parseStudentAbsences(LOGIN_PAGE)).toBeNull();
    expect(
      parseStudentAbsences(
        `<table><tr><th>Sl.No</th><th>Roll No</th><th>Name</th><th>Attend/Held</th><th>%</th></tr>
        <tr><td>1</td><td>21CS001</td><td>Asha Rao</td><td>38/45</td><td>84.44</td></tr></table>`
      )
    ).toBeNull();
  });
  test("a student's own grid states the section's meeting days in order", () => {
    // Every date column, whether anyone missed it or not: a clean month still
    // counts as met, which is what keeps the semester walk going past it.
    expect(studentWiseDates(STUDENT_WISE_GRID)).toEqual([
      "05/08",
      "06/08",
      "07/08",
    ]);
    // No date columns is no meeting days, which is what stops the walk.
    expect(
      studentWiseDates(
        `<table><tr><th>Sl.No</th><th>Subject</th><th>Atted/Held</th><th>%</th></tr>
        <tr><td>1</td><td>MFCS</td><td>14/14</td><td>100.00</td></tr></table>`
      )
    ).toEqual([]);
    expect(studentWiseDates(LOGIN_PAGE)).toEqual([]);
  });
});
/** The per-semester grid, copied from the same response, **unclosed `Grade` row
 *  and all**: the Portal writes `<tr>Grade…<tr>Credits…</tr></tr>`, so the row a
 *  reader finds as "Grade" carries the Credit row's cells too, and its last cell
 *  is 16/19 rather than the SGPA. */
const SEMESTER_I = `<span class='reportHeading2' align='left'>I Semester</span><table width='100%' cellspacing='0' cellpadding='2' border='0'><tr class='reportHeading2WithBackground'><td>&nbsp;</td><td align='center'>LAC</td><td align='center'>EP</td><td align='center'>Com.Eng</td><td align='center'>BCME</td><td align='center'>EG</td><td align='center'>NNSCCS</td><td align='center'>EPL</td><td align='center'>CEL</td><td align='center'>EWS</td><td align='center'>ITWS</td><td align='center'>SGPA</td></tr><tr><td class='cellBorder' align='center'><b>Grade</b></td><td class='cellBorder' align='center' style='color:Blue '>E</td><td class='cellBorder' align='center' style='color:Red '>F</td><td class='cellBorder' align='center' style='color:Blue '>C</td><td class='cellBorder' align='center' style='color:Blue '>C</td><td class='cellBorder' align='center' style='color:Blue '>E</td><td class='cellBorder' align='center' style='color:Blue '>A</td><td class='cellBorder' style='color:Blue' align='center'>B</td><td class='cellBorder' style='color:Blue' align='center'>B</td><td class='cellBorder' style='color:Blue' align='center'>B</td><td class='cellBorder' style='color:Blue' align='center'>A</td><td class='cellBorder' align='center' >5.61</td><tr><td class='cellBorder' align='center'><b>Credits</b></td><td class='cellBorder'  align='center' >3.0</td><td class='cellBorder' style='color:Red' align='center' ></td><td class='cellBorder'  align='center' >2.0</td><td class='cellBorder'  align='center' >3.0</td><td class='cellBorder'  align='center' >3.0</td><td class='cellBorder'  align='center' >0.5</td><td class='cellBorder'  align='center'>1.0</td><td class='cellBorder'  align='center'>1.0</td><td class='cellBorder'  align='center'>1.5</td><td class='cellBorder'  align='center'>1.0</td><td class='cellBorder' align='center'>16/19</td></tr></tr></table>`;
/** ECAP's StudentProfile page, trimmed to the rows this app reads, with the two
 *  numbers it filled and the four it left blank kept as they are. */
const BIO_DATA = `<div id='tblReport'><h1 >BIO-DATA</h1><div id='divProfile_BioData'><table width='100%' cellspacing='0' cellpadding='2'>
<tr><td colspan='6' align='left' class='reportHeading2WithBackground'>Personal Details</td></tr>
<tr><td align='right' class='cellBorder'>RollNo</td><td class='cellBorder'>:</td><td align='left' colspan='3' class='cellBorder'>24L31A0393</td><td valign='top' rowspan='4' class='cellBorder'><img src='http://webprosindia.com/vignanit/images/imgna.gif' height='100' width='100'/></td></tr>
<tr><td align='right' class='cellBorder'>Name</td><td class='cellBorder'>:</td><td align='left' colspan='3' class='cellBorder'>MALLADI DHEERAJ</td></tr>
<tr><td align='right' class='cellBorder'>Phone.No</td><td class='cellBorder'>:</td><td align='left' class='cellBorder'></td><td align='right' class='cellBorder'>Mobile.No</td><td class='cellBorder'>:</td><td align='left' class='cellBorder'>7661864881</td></tr>
<tr><td colspan='6' align='left' class='reportHeading2WithBackground'>Parent Details</td></tr>
<tr><td align='right' class='cellBorder'>Phone.No</td><td class='cellBorder'>:</td><td align='left' class='cellBorder'></td><td align='right' class='cellBorder'>Father Mobile.No</td><td class='cellBorder'>:</td><td align='left' class='cellBorder'>8790011786</td></tr>
<tr><td align='right' class='cellBorder'>Mother Mobile.No</td><td class='cellBorder'>:</td><td align='left' class='cellBorder'></td><td align='right' class='cellBorder'>Annual Income</td><td class='cellBorder'>:</td><td align='left' class='cellBorder'>60000</td></tr>
<tr><td colspan='6' align='left' class='reportHeading2WithBackground'>Guardian Details</td></tr>
<tr><td align='right' class='cellBorder'>Phone</td><td class='cellBorder'>:</td><td align='left' class='cellBorder'></td><td align='right' class='cellBorder'>Mobile</td><td class='cellBorder'>:</td><td align='left' class='cellBorder'></td></tr>
</table></div><h1>PERFORMANCE (Past)</h1>${SEMESTER_I}<center><span style='text-align:center;width:100%' class='reportHeading2'>CGPA:&nbsp;5.61&nbsp;&nbsp;&nbsp;Credits:16/19&nbsp;&nbsp;&nbsp;&nbsp;48.55&nbsp;%</span></center></div>`;
test.describe("the student profile page", () => {
  test("reads the GPA line it states, and every number it filled", () => {
    expect(parseStudentProfile(BIO_DATA)).toEqual({
      cgpa: "5.61",
      credits: "16/19",
      cgpaPercent: "48.55",
      sgpa: [{ semester: "I Semester", value: "5.61" }],
      phones: [
        { label: "Mobile.No", number: "7661864881" },
        { label: "Father Mobile.No", number: "8790011786" },
      ],
      backlogs: { rows: [], total: null, note: "" },
    });
  });
  test("the SGPA is its column's, not the row's last cell", () => {
    // The trap the fixture keeps: on the real page the Grade row is unclosed, so
    // its last cell is the Credit total. Reading by column index is the only
    // reason 5.61 comes back instead of 16/19.
    const html = `<div id='divProfile_BioData'></div>${SEMESTER_I.replaceAll(
      ">5.61<",
      ">7.77<"
    ).replaceAll(">16/19<", ">99/99<")}`;
    expect(parseStudentProfile(html)?.sgpa).toEqual([
      { semester: "I Semester", value: "7.77" },
    ]);
  });
  test("one entry per semester, named by the span above its own table", () => {
    const second = SEMESTER_I.replace("I Semester", "II Semester").replace(
      ">5.61<",
      ">6.20<"
    );
    const html = `<div id='divProfile_BioData'></div>${SEMESTER_I}${second}`;
    expect(parseStudentProfile(html)?.sgpa).toEqual([
      { semester: "I Semester", value: "5.61" },
      { semester: "II Semester", value: "6.20" },
    ]);
  });
  test("a blank number is left out rather than printed empty", () => {
    // Guardian's Phone and Mobile are both blank on the real page, and the real
    // Personal Phone.No is blank too: neither becomes an entry.
    const labels = (parseStudentProfile(BIO_DATA)?.phones ?? []).map(
      (p) => p.label
    );
    expect(labels).not.toContain("Phone");
    expect(labels).not.toContain("Mobile");
    expect(labels).not.toContain("Mother Mobile.No");
  });
  test("one number under two labels is one number, not two lines", () => {
    const html = `<div id='divProfile_BioData'><table><tr>
<td>Phone.No</td><td>:</td><td>6300113013</td>
<td>Mobile.No</td><td>:</td><td>6300113013</td></tr></table>CGPA: 8.34 Credits:20.5/20.5 75.91 %</div>`;
    expect(parseStudentProfile(html)).toEqual({
      cgpa: "8.34",
      credits: "20.5/20.5",
      cgpaPercent: "75.91",
      sgpa: [],
      phones: [{ label: "Phone.No", number: "6300113013" }],
      backlogs: { rows: [], total: null, note: "" },
    });
  });
  test("a student with no past semesters keeps the page's own NA, and no percentage", () => {
    const html = `<div id='divProfile_BioData'><table><tr><td>Mobile.No</td><td>:</td><td>9182979977</td></tr></table>CGPA:&nbsp;NA&nbsp;&nbsp;Credits:0/0</div>`;
    expect(parseStudentProfile(html)).toEqual({
      cgpa: "NA",
      credits: "0/0",
      cgpaPercent: "",
      sgpa: [],
      phones: [{ label: "Mobile.No", number: "9182979977" }],
      backlogs: { rows: [], total: null, note: "" },
    });
  });
  test("a reply that is not that page is told apart from one with nothing in it", () => {
    expect(parseStudentProfile(LOGIN_PAGE)).toBeNull();
    expect(parseStudentProfile("<p>nothing here</p>")).toBeNull();
    expect(parseStudentProfile("")).toBeNull();
  });
  test("the backlogs it lists, by semester, with the page's own total", () => {
    // Copied from a captured page, including the table after it: the data row is
    // never closed, so it and the total row arrive as one, and only the first
    // table in the section is the backlogs one.
    const html = `<div id='divProfile_Backlogs'><table width='100%' cellspacing='0' cellpadding='2'><tr class='reportHeading2WithBackground'><td style='width:30%' class='cellBorder' align='left'>Semester</td><td align='left' class='cellBorder'>Backlogs</td><td class='cellBorder'></td></tr><tr><td align='left' valign='top' class='cellBorder'>I Semester</td><td align='left' class='cellBorder'><font color='red'>*&nbsp;</font>EP<br/></td><td class='cellBorder' align='center'>1</td><tr><td colspan='3' align='center' class='cellBorder'><b>Total backlogs:&nbsp;1</b></td></tr></table><br/><span class='reportHeading2WithBackground'>SUPPLEMENTARY DETAILS</span><table><tr><td>I Semester</td></tr></table></div>`;
    expect(parseStudentBacklogs(html)).toEqual({
      rows: [
        { semester: "I Semester", subjects: [{ code: "EP", marked: true }] },
      ],
      total: 1,
      note: "",
    });
  });
  test("a second semester is its own row, and the cells after it still line up", () => {
    // Modelled on that same unclosed shape: no capture lists two semesters, and
    // the row after the first must not inherit its subjects.
    const html = `<div id='divProfile_Backlogs'><table>
<tr><td>Semester</td><td>Backlogs</td><td></td></tr>
<tr><td>I Semester</td><td>EP<br/>ASAP</td><td>2</td>
<tr><td>II Semester</td><td>MFCS</td><td>1</td>
<tr><td colspan='3'>Total backlogs: 3</td></tr></table></div>`;
    expect(parseStudentBacklogs(html)).toEqual({
      rows: [
        {
          semester: "I Semester",
          subjects: [
            { code: "EP", marked: false },
            { code: "ASAP", marked: false },
          ],
        },
        {
          semester: "II Semester",
          subjects: [{ code: "MFCS", marked: false }],
        },
      ],
      total: 3,
      note: "",
    });
  });
  test("a page that states there are no backlogs says so in its own words", () => {
    expect(
      parseStudentBacklogs(
        "<div id='divProfile_Backlogs'><span class='style24'>Student have no backlogs</span></div>"
      )
    ).toEqual({
      rows: [],
      total: null,
      note: "Student have no backlogs",
    });
    // Another build leaves the section empty: no rows and nothing said, which is
    // not the same answer as the page stating there are none.
    expect(
      parseStudentBacklogs("<div id='divProfile_Backlogs'></div>")
    ).toEqual({ rows: [], total: null, note: "" });
    expect(parseStudentBacklogs("<p>nothing here</p>")).toEqual({
      rows: [],
      total: null,
      note: "",
    });
  });
  test("a profile carries the backlogs section as the page states it", () => {
    const html = `<div id='divProfile_BioData'><table><tr><td>Mobile.No</td><td>:</td><td>7661864881</td></tr></table>
CGPA:&nbsp;5.61&nbsp;&nbsp;&nbsp;Credits:16/19&nbsp;&nbsp;&nbsp;48.55&nbsp;%</div>`;
    expect(
      parseStudentProfile(
        `${html}<div id='divProfile_Backlogs'><span class='style24'>Student have no backlogs</span></div>`
      )?.backlogs
    ).toEqual({
      rows: [],
      total: null,
      note: "Student have no backlogs",
    });
    // A page with no backlogs section at all says nothing about them.
    expect(parseStudentProfile(BIO_DATA)?.backlogs).toEqual({
      rows: [],
      total: null,
      note: "",
    });
  });
  test("today's cleared evening is an empty day, not a failure", () => {
    // ECAP's own answer after ~4pm, read live 2026-10-23: the fragment is a
    // bare closing tag, with no grid in it at all.
    expect(parseTodayClasses("</table>")).toEqual([]);
    expect(parseTodayClasses("")).toEqual([]);
  });
  test("today's grid reads periods, keeps the free one's hours, splits the stacked one", () => {
    // Pinned against the live GetToDayClasses fragment (TODAY_GRID,
    // 2026-10-24), but asserting one rule each — never a copy of the whole
    // answer, which would red on any timetable change without saying why.
    const classes = parseTodayClasses(TODAY_GRID);
    expect(
      classes.find(({ period }) => period === "Period 5"),
      "the free period keeps the hours the grid states for it"
    ).toEqual({
      period: "Period 5",
      time: "12:30 PM- 01:20 PM",
      subject: "",
      section: "",
      room: "",
    });
    expect(
      classes.filter(({ time }) => time === "03:10 PM- 04:00 PM"),
      "the <hr/> stacks a second period onto the same time"
    ).toMatchObject([
      { period: "Period 7", subject: "LIB/SPORTS (CSE (AI))" },
      { period: "Period 7", subject: "ADDON (CSE (AI))" },
    ]);
    expect(
      classes.every(({ room }) => room === ""),
      "the grid states no room anywhere"
    ).toBe(true);
    expect(classes[0]).toMatchObject({
      period: "Period 1",
      time: "08:45 AM- 09:35 AM",
      subject: "FLUTER LAB (CSE (AI))",
      section: "B.Tech V Semester, Sec-B",
    });
  });
  const DAYWORK_BLOCK = `<b>Course:</b>&nbsp;B.Tech</div><div style='float:left;width:15px'>&nbsp;</div><div style='float:left'><b>Branch:</b>&nbsp;Information Technology</div><div style='float:left;width:15px'>&nbsp;</div><div style='float:left'><b>Semester:</b>&nbsp;III Semester</div><div style='float:left;width:15px'>&nbsp;</div><div style='float:left'><b>Section:</b>&nbsp;A</div><div style='float:left;width:15px'>&nbsp;</div><div style='float:left'><b>Total No of Students:</b>&nbsp;63</div></td></tr><tr><td valign='top' colspan='2'><table width='100%' cellpadding='2' cellspacing='0'><tr class='reportHeading2WithBackground'><td align='center'>Period</td><td align='left'>Subject</td><td align='left'>Name of the staff</td><td align='left'>Unit.No</td><td align='left'>Topics Covered</td><td align='center'>No.Of students</br>Present</td><td align='center'>No.Of students</br>Absent</td><td align='center'>Roll.No's</br>Absent Students</td></tr><tr><td class='cellBorder'>1</td><td class='cellBorder' align='left'>Digital Logic And Computer Organization</td><td class='cellBorder' align='left'>MRS.G.MANI</td><td class='cellBorder' align='left'>-</td><td class='cellBorder' align='left'>-</td><td class='cellBorder' align='center'>32</td><td class='cellBorder' align='center'>31</td><td class='cellBorder' align='left'>25L31A1201, 25L31A1202, 25L31A1208, 25L31A1209, 25L31A1211, 25L31A1213, 25L31A1215, 25L31A1216, 25L31A1217, 25L31A1219, 25L31A1222, 25L31A1223, 25L31A1226, 25L31A1229, 25L31A1233, 25L31A1235, 25L31A1236, 25L31A1238, 25L31A1239, 25L31A1241, 25L31A1246, 25L31A1247, 25L31A1248, 25L31A1249, 25L31A1250, 25L31A1251, 25L31A1255, 25L31A1257, 25L31A1259, 26L35A1203, 26L35A1206&nbsp;</td></tr><tr><td class='cellBorder'>2</td><td class='cellBorder' align='left'>Design Thinking And Innovation</td><td class='cellBorder' align='left'>MR.AMPOLU CHAKRADHAR</td><td class='cellBorder' align='left'>-</td><td class='cellBorder' align='left'>-</td><td class='cellBorder' align='center'>35</td><td class='cellBorder' align='center'>28</td><td class='cellBorder' align='left'>25L31A1201, 25L31A1202, 25L31A1208, 25L31A1209, 25L31A1211, 25L31A1213, 25L31A1215, 25L31A1216, 25L31A1217, 25L31A1219, 25L31A1222, 25L31A1223, 25L31A1226, 25L31A1229, 25L31A1233, 25L31A1235, 25L31A1236, 25L31A1238, 25L31A1239, 25L31A1241, 25L31A1246, 25L31A1247, 25L31A1248, 25L31A1249, 25L31A1250, 25L31A1251, 26L35A1203, 26L35A1206&nbsp;</td></tr><tr><td class='cellBorder'>3</td><td class='cellBorder' align='left'>Universal Human Values Understanding Harmony</td><td class='cellBorder' align='left'>MRS.P.RAMYA RAJESWARI</td><td class='cellBorder' align='left'>-</td><td class='cellBorder' align='left'>-</td><td class='cellBorder' align='center'>28</td><td class='cellBorder' align='center'>35</td><td class='cellBorder' align='left'>25L31A1201, 25L31A1202, 25L31A1208, 25L31A1209, 25L31A1210, 25L31A1211, 25L31A1213, 25L31A1215, 25L31A1216, 25L31A1217, 25L31A1219, 25L31A1222, 25L31A1223, 25L31A1224, 25L31A1226, 25L31A1229, 25L31A1231, 25L31A1233, 25L31A1235, 25L31A1236, 25L31A1238, 25L31A1239, 25L31A1241, 25L31A1244, 25L31A1246, 25L31A1247, 25L31A1248, 25L31A1249, 25L31A1250, 25L31A1251, 25L31A1255, 25L31A1256, 25L31A1257, 25L31A1259, 26L35A1203&nbsp;</td></tr><tr><td class='cellBorder'>4</td><td class='cellBorder' align='left'>CASE Tools Lab (Batch-1)</td><td class='cellBorder' align='left'>MS.P.PAVITHRA,MRUNA DUBEY </td><td class='cellBorder' align='left'>-</td><td class='cellBorder' align='left'>-</td><td class='cellBorder' align='center'>28</td><td class='cellBorder' align='center'>35</td><td class='cellBorder' align='left'>25L31A1201, 25L31A1202, 25L31A1208, 25L31A1209, 25L31A1210, 25L31A1211, 25L31A1213, 25L31A1215, 25L31A1216, 25L31A1217, 25L31A1219, 25L31A1222, 25L31A1223, 25L31A1224, 25L31A1226, 25L31A1229, 25L31A1231, 25L31A1233, 25L31A1235, 25L31A1236, 25L31A1238, 25L31A1239, 25L31A1241, 25L31A1244, 25L31A1246, 25L31A1247, 25L31A1248, 25L31A1249, 25L31A1250, 25L31A1251, 25L31A1255, 25L31A1256, 25L31A1257, 25L31A1259, 26L35A1203&nbsp;</td></tr><tr><td class='cellBorder'>5</td><td class='cellBorder' align='left'>CASE Tools Lab (Batch-1)</td><td class='cellBorder' align='left'>MS.P.PAVITHRA,MRUNA DUBEY </td><td class='cellBorder' align='left'>-</td><td class='cellBorder' align='left'>-</td><td class='cellBorder' align='center'>28</td><td class='cellBorder' align='center'>35</td><td class='cellBorder' align='left'>25L31A1201, 25L31A1202, 25L31A1208, 25L31A1209, 25L31A1210, 25L31A1211, 25L31A1213, 25L31A1215, 25L31A1216, 25L31A1217, 25L31A1219, 25L31A1222, 25L31A1223, 25L31A1224, 25L31A1226, 25L31A1229, 25L31A1231, 25L31A1233, 25L31A1235, 25L31A1236, 25L31A1238, 25L31A1239, 25L31A1241, 25L31A1244, 25L31A1246, 25L31A1247, 25L31A1248, 25L31A1249, 25L31A1250, 25L31A1251, 25L31A1255, 25L31A1256, 25L31A1257, 25L31A1259, 26L35A1203&nbsp;</td></tr><tr><td class='cellBorder'>6</td><td class='cellBorder' align='left'>CASE Tools Lab (Batch-1)</td><td class='cellBorder' align='left'>MS.P.PAVITHRA,MRUNA DUBEY </td><td class='cellBorder' align='left'>-</td><td class='cellBorder' align='left'>-</td><td class='cellBorder' align='center'>28</td><td class='cellBorder' align='center'>35</td><td class='cellBorder' align='left'>25L31A1201, 25L31A1202, 25L31A1208, 25L31A1209, 25L31A1210, 25L31A1211, 25L31A1213, 25L31A1215, 25L31A1216, 25L31A1217, 25L31A1219, 25L31A1222, 25L31A1223, 25L31A1224, 25L31A1226, 25L31A1229, 25L31A1231, 25L31A1233, 25L31A1235, 25L31A1236, 25L31A1238, 25L31A1239, 25L31A1241, 25L31A1244, 25L31A1246, 25L31A1247, 25L31A1248, 25L31A1249, 25L31A1250, 25L31A1251, 25L31A1255, 25L31A1256, 25L31A1257, 25L31A1259, 26L35A1203&nbsp;</td></tr><tr><td class='cellBorder'>7</td><td class='cellBorder' align='left'>Mathematical Foundations Of Computer Science</td><td class='cellBorder' align='left'>NARAVA JAYA LALITHA</td><td class='cellBorder' align='left'>-</td><td class='cellBorder' align='left'>-</td><td class='cellBorder' align='center'>26</td><td class='cellBorder' align='center'>37</td><td class='cellBorder' align='left'>25L31A1201, 25L31A1202, 25L31A1208, 25L31A1209, 25L31A1210, 25L31A1211, 25L31A1213, 25L31A1215, 25L31A1216, 25L31A1217, 25L31A1219, 25L31A1222, 25L31A1223, 25L31A1224, 25L31A1226, 25L31A1229, 25L31A1231, 25L31A1233, 25L31A1235, 25L31A1236, 25L31A1238, 25L31A1239, 25L31A1241, 25L31A1244, 25L31A1246, 25L31A1247, 25L31A1248, 25L31A1249, 25L31A1250, 25L31A1251, 25L31A1254, 25L31A1255, 25L31A1256, 25L31A1257, 25L31A1259, 26L35A1203, 26L35A1204&nbsp;</td></tr></table></td></tr><tr><td style='height:30px' colspan='2'>&nbsp;</td></tr><tr class='reportData1'><td style='width:40%' align='center'><b>Signature of HOD</b></td><td  align='center'><b>Principal</b></td></tr><tr><td colspan='2'>&nbsp;</td></tr><tr><td  class='reportData1' colspan='2'><div style='float:left'>`;
  test("the day-class-work report reads posted flags per section", () => {
    // One live section block (III-A, 23/10/2026): every period posted, with
    // both counts as written — a posted period always states both.
    const sections = parseDayClassWork(DAYWORK_BLOCK, {
      "Information Technology": "IT",
    });
    expect(sections).toHaveLength(1);
    expect(sections[0]).toMatchObject({
      branch: "Information Technology",
      branchShort: "IT",
      semester: "III Semester",
      section: "A",
    });
    expect(
      sections[0]?.cells.map((cell) => [cell.period, cell.posted])[0],
      "the first period posted, as its counts say"
    ).toEqual(["1", true]);
    expect(
      sections[0]?.cells.every((cell) => cell.posted),
      "every period of the live block posted"
    ).toBe(true);
    // The same block with its first period's counts blanked reads unposted,
    // and the short name falls back to the label it came with.
    const blanked = parseDayClassWork(
      DAYWORK_BLOCK.replace(
        "<td class='cellBorder' align='center'>32</td><td class='cellBorder' align='center'>31</td>",
        "<td class='cellBorder' align='center'></td><td class='cellBorder' align='center'></td>"
      )
    );
    expect(blanked[0]?.branchShort).toBe("Information Technology");
    expect(
      blanked[0]?.cells.filter((cell) => !cell.posted),
      "only the blanked period reads unposted, keeping who was to take it"
    ).toEqual([
      {
        period: "1",
        subject: "Digital Logic And Computer Organization",
        posted: false,
        staff: "MRS.G.MANI",
      },
    ]);
    // A row with exactly one count still reads posted: every posted period
    // states both, so half-blank is malformed, not unposted.
    const halfBlank = parseDayClassWork(
      DAYWORK_BLOCK.replace(
        "<td class='cellBorder' align='center'>32</td><td class='cellBorder' align='center'>31</td>",
        "<td class='cellBorder' align='center'></td><td class='cellBorder' align='center'>31</td>"
      )
    );
    expect(
      halfBlank[0]?.cells.every((cell) => cell.posted),
      "half-blank is malformed, not unposted"
    ).toBe(true);
    // ECAP writes "-" where a period has not been posted: that is not a count
    // of zero, so it reads unposted rather than posted.
    const dashed = parseDayClassWork(
      DAYWORK_BLOCK.replace(
        "<td class='cellBorder' align='center'>32</td><td class='cellBorder' align='center'>31</td>",
        "<td class='cellBorder' align='center'>-</td><td class='cellBorder' align='center'>-</td>"
      )
    );
    expect(
      dashed[0]?.cells.some((cell) => !cell.posted),
      "a dash is not a count, so the period reads unposted"
    ).toBe(true);
    // No section blocks at all is no classes that day, not all posted.
    expect(parseDayClassWork("<div>holiday</div>")).toEqual([]);
  });
  test("leave status comes from the application grid, per stage", () => {
    // Copied from the APPLY-SELF page's `showLeaves` reply: the counts sit
    // inside clickable divs, and the Portal never closes the Approved one, so
    // its cell reads `5</div` after the tags are stripped. The reader takes
    // the number at the front rather than the cell as it stands.
    const html = `<table id='tblstaffleaves'><tr><td colspan='8'><b>Leave History(JANUARY to DECEMBER)-2026</b></td></tr>
<tr><td colspan='2'></td><td colspan='6'>Leave History</td></tr>
<tr><td></td><td>Leave Type</td><td>Eligible</td><td>Applied</td><td>Approved</td><td>Pending</td><td>Declined</td><td>Available</td></tr>
<tr><td><input type='radio' name='rbleave' value='1'/></td><td>Eligible Casual Leave</td><td>10</td><td><div class='spanLink' onclick="showLeaveDetails(1,'a','x')">6</div></td><td><div class='spanLink' onclick="showLeaveDetails(1,'g','x')">5</div</td><td><div class='spanLink' onclick="showLeaveDetails(1,'p','x')">1</div></td><td>0</td><td>4</td></tr>
<tr><td><input type='radio' name='rbleave' value='5'/></td><td>Medical Leave</td><td>5</td><td>0</td><td>0</td><td>0</td><td>0</td><td>5</td></tr>
<tr><td colspan='8'><input type='button' value='Request Leave'/></td></tr></table>`;
    expect(parseLeaveStatus(html)).toEqual([
      {
        type: "Eligible Casual Leave",
        eligible: "10",
        applied: "6",
        approved: "5",
        pending: "1",
        declined: "0",
        available: "4",
      },
      {
        type: "Medical Leave",
        eligible: "5",
        applied: "0",
        approved: "0",
        pending: "0",
        declined: "0",
        available: "5",
      },
    ]);
    // A reply without that header is not the grid: no status is not all zeros.
    expect(parseLeaveStatus(LOGIN_PAGE)).toEqual([]);
  });
});

const QUOTED_OPTION = (value: string, label: string) => ({
  value,
  label,
  title: "",
});
test.describe("the class a profile page states", () => {
  const PAGE = `<div id='divProfile_BioData'><table>
<tr><td>Course</td><td>:</td><td>B.Tech</td></tr>
<tr><td>Branch</td><td>:</td><td>IT</td></tr>
<tr><td>Semester</td><td>:</td><td>III</td></tr>
<tr><td>Section</td><td>:</td><td>Section-1</td></tr>
<tr><td>Mobile.No</td><td>:</td><td>7661864881</td></tr></table></div>`;
  test("reads the four levels the page names, and leaves the phone row alone", () => {
    expect(parseStudentClass(PAGE)).toEqual({
      course: "B.Tech",
      branch: "IT",
      semester: "III",
      section: "Section-1",
    });
  });
  test("a level the page omits stays empty rather than becoming a guess", () => {
    expect(
      parseStudentClass(
        `<table><tr><td>Course</td><td>:</td><td>B.Tech</td></tr></table>`
      )
    ).toEqual({ course: "B.Tech", branch: "", semester: "", section: "" });
  });
});
test.describe("matching a page's words to the Portal's options", () => {
  const semesters = [
    QUOTED_OPTION("1", "I Semester"),
    QUOTED_OPTION("2", "II Semester"),
    QUOTED_OPTION("3", "III Semester"),
  ];
  test("a value wins, then the label, then the label without its kind word", () => {
    expect(matchOption("3", semesters)?.label).toBe("III Semester");
    expect(matchOption("III Semester", semesters)?.label).toBe("III Semester");
    expect(matchOption("III", semesters)?.label).toBe("III Semester");
  });
  test("a word that names two options names neither of them", () => {
    const twins = [QUOTED_OPTION("1", "Section-1"), QUOTED_OPTION("2", "1")];
    expect(matchOption("Section-1", twins)).toBeNull();
  });
  test("a word the options do not offer names nothing", () => {
    expect(matchOption("IV", semesters)).toBeNull();
    expect(matchOption("", semesters)).toBeNull();
  });
});
