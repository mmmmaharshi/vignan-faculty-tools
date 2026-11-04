import { expect, test } from "@playwright/test";

import { ALL_SUBJECTS } from "../shared/api";
import {
  applyOptions,
  chosenFacts,
  chosenLevels,
  disabledLevels,
  isReady,
  resetFor,
  shouldContinue,
} from "../web/cascade";
import { notePeriodTimes } from "../web/period-times";
import { noteSemStart, semStartKey } from "../web/sem-starts";
import {
  CLASS_A,
  dateRangeTail,
  nothing,
  reply,
  sel,
  slot,
  statedTail,
} from "./support/cascade-harness";

test.describe("the cascade's selection rules", () => {
  test("every level auto-fills, so the chain populates itself", () => {
    const next = applyOptions(
      sel(),
      reply({
        course: ["1", "2"],
        semester: ["3"],
        branch: ["4"],
        section: ["5"],
        subject: ["6", "7"],
      })
    );
    expect(next.course).toBe("1");
    expect(next.semester).toBe("3");
    expect(next.branch).toBe("4");
    expect(next.section).toBe("5");
    expect(next.subject).toBe("6");
  });
  test("the subject auto-fills too, and lands on ALL SUBJECTS", () => {
    const next = applyOptions(
      sel({ course: "1", branch: "4", semester: "3", section: "5" }),
      reply({
        course: ["1"],
        semester: ["3"],
        branch: ["4"],
        section: ["5"],
        subject: [ALL_SUBJECTS.value, "6", "7"],
      })
    );
    expect(next.subject).toBe(ALL_SUBJECTS.value);
  });
  test("a section with no subjects at all leaves the subject empty", () => {
    const next = applyOptions(
      sel({ course: "1", branch: "4", semester: "3", section: "5" }),
      reply({
        course: ["1"],
        semester: ["3"],
        branch: ["4"],
        section: ["5"],
        subject: [],
      })
    );
    expect(next.subject).toBe("");
  });
  test("a choice the server still offers survives a refresh", () => {
    const next = applyOptions(
      sel({ course: "2", branch: "4" }),
      reply({
        course: ["1", "2"],
        semester: ["3"],
        branch: ["4"],
        section: ["5"],
        subject: [],
      })
    );
    expect(next.course).toBe("2");
  });
  test("a choice the server no longer offers falls to the first option", () => {
    const next = applyOptions(
      sel({ course: "99" }),
      reply({
        course: ["1", "2"],
        semester: ["3"],
        branch: ["4"],
        section: ["5"],
        subject: [],
      })
    );
    expect(next.course).toBe("1");
  });
  test("a level with no options is cleared, not left holding a dead value", () => {
    const next = applyOptions(
      sel({ course: "1", branch: "4" }),
      reply({
        course: ["1"],
        semester: ["3"],
        branch: [],
        section: ["5"],
        subject: [],
      })
    );
    expect(next.branch).toBe("");
  });
  test("a level is ready only when every level above it is chosen", () => {
    const full = sel({ course: "1", semester: "3", branch: "4", section: "5" });
    expect(isReady(full, "course")).toBe(true);
    expect(isReady(sel({ course: "1" }), "semester")).toBe(true);
    expect(isReady(sel(), "semester")).toBe(false);
    expect(isReady(sel({ course: "1", branch: "4" }), "branch")).toBe(false);
    expect(isReady(sel({ course: "1", semester: "3" }), "branch")).toBe(true);
    expect(isReady(sel({ course: "1", branch: "4" }), "section")).toBe(false);
    expect(isReady(full, "section")).toBe(true);
    expect(isReady(full, "subject")).toBe(true);
  });
  test("a dropdown is enabled exactly when the server could answer for it", () => {
    expect(disabledLevels(sel())).toEqual({
      course: false,
      semester: true,
      branch: true,
      section: true,
      subject: true,
    });
    const full = sel({ course: "1", semester: "3", branch: "4", section: "5" });
    expect(disabledLevels(full)).toEqual({
      course: false,
      semester: false,
      branch: false,
      section: false,
      subject: false,
    });
  });
});

test.describe("the loop's decision", () => {
  test("asks again when a pass settled a level and something below is now ready", () => {
    const before = sel({ course: "1" });
    const after = sel({ course: "1", semester: "3", branch: "4" });
    expect(shouldContinue(after, before, nothing)).toBe(true);
  });
  test("stops when a pass settled nothing, however ready the levels look", () => {
    const unchanged = sel({ course: "1", semester: "3" });
    expect(shouldContinue(unchanged, unchanged, nothing)).toBe(false);
  });
  test("stops when a pass gained something but every level below is filled", () => {
    const before = sel();
    const after = sel({ course: "1" });
    const full = reply({
      course: ["1"],
      semester: ["3"],
      branch: ["4"],
      section: ["5"],
      subject: ["6"],
    });
    expect(shouldContinue(after, before, full)).toBe(false);
  });
  test("stops when the deepest ready level came back populated but gained nothing", () => {
    const unchanged = sel();
    expect(
      shouldContinue(
        unchanged,
        unchanged,
        reply({
          course: ["1"],
          semester: [],
          branch: [],
          section: [],
          subject: [],
        })
      )
    ).toBe(false);
  });
});

test.describe("the register, before it is sent", () => {
  test("names the level that has no choice, so the warning can point at it", () => {
    const chosen = chosenLevels(
      reply({
        course: ["1"],
        semester: ["3"],
        branch: ["4"],
        section: ["5"],
        subject: ["6"],
      }),
      sel({ course: "1", semester: "3" })
    );
    expect(chosen.ok).toBe(false);
    if (!chosen.ok) expect(chosen.label).toBe("Branch");
  });
  test("returns each level whole, labels included, not as a bare value", () => {
    const opts = reply({
      course: ["1"],
      semester: ["3"],
      branch: ["4"],
      section: ["5"],
      subject: ["6"],
    });
    const chosen = chosenLevels(
      opts,
      sel({
        course: "1",
        semester: "3",
        branch: "4",
        section: "5",
        subject: "6",
      })
    );
    expect(chosen.ok).toBe(true);
    if (chosen.ok) {
      expect(chosen.levels.course).toEqual(opts.course[0]);
      expect(chosen.levels.subject.label).toBe("L6");
    }
  });
  test("the register's naming, one fact per row", () => {
    const facts = chosenFacts(
      reply({
        course: ["1"],
        semester: ["3"],
        branch: ["4"],
        section: ["5"],
        subject: ["6"],
      }),
      sel({
        course: "1",
        semester: "3",
        branch: "4",
        section: "5",
        subject: "6",
      }),
      { range: { from: "01/10/2026", to: "16/10/2026" } }
    );
    expect(facts).toEqual([
      { label: "Course", value: "L1" },
      { label: "Semester", value: "L3" },
      { label: "Branch", value: "L4" },
      { label: "Section", value: "L5" },
      { label: "Subject", value: "L6" },
      { label: "Date Range", value: "01/10/2026 to 16/10/2026" },
    ]);
  });
  test("the date range carries the register's own class-day count", () => {
    // 01/10 to 16/10 is 16 calendar days, and the register states classes
    // held there — so the frame count travels with the label. Only the held
    // figure is read.
    expect(dateRangeTail(6)).toEqual([
      { label: "Date Range (16 days)", value: "01/10/2026 to 16/10/2026" },
    ]);
    expect(dateRangeTail(1)).toEqual([
      { label: "Date Range (16 days)", value: "01/10/2026 to 16/10/2026" },
    ]);
    expect(dateRangeTail(null)).toEqual([
      { label: "Date Range", value: "01/10/2026 to 16/10/2026" },
    ]);
    expect(dateRangeTail(undefined)).toEqual([
      { label: "Date Range", value: "01/10/2026 to 16/10/2026" },
    ]);
  });
  test("the register's own first date is the start the fact names", () => {
    // The Portal holds nothing before the semester began, so a range asked
    // from July shows figures that begin in September — the fact names that
    // day, and the frame counts the period the register covers.
    expect(statedTail("01/09/2026")).toEqual([
      { label: "Date Range (46 days)", value: "01/09/2026 to 16/10/2026" },
    ]);
    expect(statedTail("")).toEqual([
      { label: "Date Range (108 days)", value: "01/07/2026 to 16/10/2026" },
    ]);
  });
  test("the Sem Start Date row names the earliest day known, not the window", () => {
    // A later From moves the Date Range — the figures on screen are that
    // window's — but the row keeps the original start the memory holds.
    expect(statedTail("01/10/2026", "01/09/2026")).toEqual([
      { label: "Date Range (16 days)", value: "01/10/2026 to 16/10/2026" },
      { label: "Sem Start Date", value: "01/09/2026" },
    ]);
    expect(statedTail("01/09/2026", "01/09/2026")).toEqual([
      { label: "Date Range (46 days)", value: "01/09/2026 to 16/10/2026" },
      { label: "Sem Start Date", value: "01/09/2026" },
    ]);
    // No memory and no stated start: no row, never a bare range passed off as
    // a semester start.
    expect(statedTail("", undefined)).toEqual([
      { label: "Date Range (108 days)", value: "01/07/2026 to 16/10/2026" },
    ]);
  });
  test.describe("the semester start memory", () => {
    const key = semStartKey(
      { course: "1", semester: "3", branch: "4", section: "5", subject: "6" },
      "2025"
    );
    test("the earliest day seen wins, whatever the window says", () => {
      const first = noteSemStart({}, key, "01/09/2026");
      expect(first[key]).toBe("01/09/2026");
      // A later window's first day never moves the memory forward.
      const kept = noteSemStart(first, key, "01/10/2026");
      expect(kept).toBe(first);
      expect(kept[key]).toBe("01/09/2026");
      // An earlier day does move it back.
      expect(noteSemStart(first, key, "05/08/2026")[key]).toBe("05/08/2026");
    });
    test("a garbage date and an empty key remember nothing", () => {
      expect(noteSemStart({}, key, null)).toEqual({});
      expect(noteSemStart({}, key, "not a date")).toEqual({});
      expect(noteSemStart({}, key, "99/99/9999")).toEqual({});
      expect(noteSemStart({}, "", "01/09/2026")).toEqual({});
    });
    test("one class never takes another's start", () => {
      const other = semStartKey(
        { course: "1", semester: "3", branch: "4", section: "5", subject: "7" },
        "2025"
      );
      expect(other).not.toBe(key);
      const both = noteSemStart(
        noteSemStart({}, key, "01/09/2026"),
        other,
        "01/10/2026"
      );
      expect(both[key]).toBe("01/09/2026");
      expect(both[other]).toBe("01/10/2026");
    });
    test("a new batch year starts a new memory", () => {
      const next = semStartKey(
        { course: "1", semester: "3", branch: "4", section: "5", subject: "6" },
        "2026"
      );
      expect(next).not.toBe(key);
    });
  });
  test.describe("the period-hours memory", () => {
    test("a stated hour is learnt, and its own repeat changes nothing", () => {
      const stated = [slot("Period 1", "08:45 AM- 09:35 AM")];
      const learnt = notePeriodTimes({}, stated);
      // Property, not a copy of the answer: one stated hour with a clock
      // becomes one remembered hour — no more, no less.
      expect(Object.keys(learnt)).toHaveLength(
        stated.filter((entry) => /\d{1,2}:\d{2}\s*[AP]M/i.test(entry.time))
          .length
      );
      // The same answer again is the same map, not a rewrite.
      expect(notePeriodTimes(learnt, stated)).toBe(learnt);
    });
    test("a cleared evening never erases what the morning taught", () => {
      const learnt = notePeriodTimes({}, [
        slot("Period 1", "08:45 AM- 09:35 AM"),
        slot("Period 4", "11:40 AM- 12:30 PM"),
      ]);
      // ECAP's cleared day: the same slots, no hours stated at all.
      const cleared = notePeriodTimes(learnt, [
        slot("Period 1", ""),
        slot("Period 4", ""),
      ]);
      expect(cleared).toBe(learnt);
      expect(cleared["Period 1"]).toBe("08:45 AM- 09:35 AM");
    });
    test("a period that moved corrects itself, and junk is never stored", () => {
      const learnt = notePeriodTimes({ "Period 1": "08:45 AM- 09:35 AM" }, [
        slot("Period 1", "09:00 AM- 09:50 AM"),
        slot("Period 2", "whenever"),
        slot("", "10:50 AM- 11:40 AM"),
      ]);
      expect(learnt["Period 1"]).toBe("09:00 AM- 09:50 AM");
      expect(learnt["Period 2"]).toBeUndefined();
      expect(learnt[""]).toBeUndefined();
    });
  });
});

test.describe("what a changed level clears below it", () => {
  test("opening a saved class keeps the subject it names", () => {
    expect(
      resetFor("section", CLASS_A),
      "clearing the subject made the card open ALL SUBJECTS instead"
    ).toEqual([]);
  });
  test("changing the section by hand still clears the subject", () => {
    expect(resetFor("section", sel({ section: "A" }))).toEqual(["subject"]);
    expect(resetFor("section")).toEqual(["subject"]);
  });
  test("changing a higher level clears everything below it", () => {
    expect(resetFor("course")).toEqual([
      "semester",
      "branch",
      "section",
      "subject",
    ]);
    expect(resetFor("semester")).toEqual(["section", "subject"]);
    expect(resetFor("branch")).toEqual(["section", "subject"]);
  });
  test("changing the subject clears nothing below it", () => {
    expect(resetFor("subject", CLASS_A)).toEqual([]);
  });
});
