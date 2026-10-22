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
  parseStudentClass,
  parseStudentProfile,
  realOptions,
  registerDates,
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
