import { expect, test } from "@playwright/test";

import { ALL_SUBJECTS } from "../shared/api";
import type { OptionsReply } from "../shared/api";
import {
  probeSubject,
  selKeyOf,
  semesterTitleOf,
} from "../web/register/cascade";
import type { Sel } from "../web/register/cascade";
import {
  abbreviate,
  forgetClass,
  rememberClass,
  savedClasses,
} from "../web/register/saved-classes";
import { CLASS_A, opt, reply, saved, sel } from "./support/cascade-harness";

test.describe("a branch name on a card", () => {
  test("words before the bracket become initials", () => {
    expect(
      abbreviate("Computer Science and Engineering (Artificial Intelligence)")
    ).toBe("CSE(AI)");
    expect(abbreviate("Information Technology")).toBe("IT");
    expect(abbreviate("Electronics and Communication Engineering")).toBe("ECE");
  });
  test("the bracket keeps its own initialism, and a whole phrase is shortened", () => {
    expect(
      abbreviate("Computer Science and Engineering (Artificial Intelligence)")
    ).toBe("CSE(AI)");
    expect(abbreviate("Computer Science and Engineering (CSE)")).toBe("CSE");
    expect(abbreviate("Computer Science and Engineering (AIML)")).toBe(
      "CSE(AIML)"
    );
  });
  test("connecting words are not initials of their own", () => {
    expect(abbreviate("Computer Science and Engineering")).toBe("CSE");
    expect(abbreviate("Bachelor of Technology")).toBe("BT");
  });
  test("a single word is left alone, because an initial says nothing", () => {
    expect(abbreviate("Mathematics")).toBe("Mathematics");
    expect(abbreviate("Physics")).toBe("Physics");
  });
  test("an already short name is never made longer", () => {
    expect(abbreviate("CSE")).toBe("CSE");
    expect(abbreviate("IT")).toBe("IT");
    expect(abbreviate("")).toBe("");
  });
});

test.describe("the saved sections", () => {
  /** CLASS_A as it is stored: the subject is the section-wide one, whichever
   *  subject happened to be on screen when the section was saved. */
  const SECTION_A: Sel = { ...CLASS_A, subject: ALL_SUBJECTS.value };
  const OTHER_SECTION: Sel = {
    ...SECTION_A,
    branch: "7",
    section: "B",
  };
  /** The same section, saved while a particular subject was chosen. */
  const SECTION_A_OTHER_SUBJECT: Sel = { ...CLASS_A, subject: "102" };
  test("a section that was saved comes back after a reload", () => {
    saved.clear();
    rememberClass("sirichandrasekhar", SECTION_A);
    expect(savedClasses("sirichandrasekhar")).toEqual([SECTION_A]);
  });
  test("a card opens the whole section, never the subject that was on screen", () => {
    // The card names a section; the register it opens is the section-wide one.
    saved.clear();
    rememberClass("sirichandrasekhar", SECTION_A_OTHER_SUBJECT);
    expect(savedClasses("sirichandrasekhar")[0]?.subject).toBe(
      ALL_SUBJECTS.value
    );
  });
  test("one section saved under two subjects is one card, not two", () => {
    saved.clear();
    rememberClass("sirichandrasekhar", CLASS_A);
    rememberClass("sirichandrasekhar", SECTION_A_OTHER_SUBJECT);
    expect(
      savedClasses("sirichandrasekhar"),
      "a section is the card's identity, so the second save moved it rather than adding"
    ).toEqual([SECTION_A]);
  });
  test("sections from any branch are all kept", () => {
    saved.clear();
    rememberClass("sirichandrasekhar", SECTION_A);
    rememberClass("sirichandrasekhar", OTHER_SECTION);
    expect(savedClasses("sirichandrasekhar")).toEqual([
      OTHER_SECTION,
      SECTION_A,
    ]);
  });
  test("saving the same section twice keeps one of it", () => {
    saved.clear();
    rememberClass("sirichandrasekhar", SECTION_A);
    rememberClass("sirichandrasekhar", SECTION_A);
    expect(savedClasses("sirichandrasekhar")).toEqual([SECTION_A]);
  });
  test("the newest save is offered first, and re-saving moves rather than adds", () => {
    saved.clear();
    rememberClass("sirichandrasekhar", SECTION_A);
    rememberClass("sirichandrasekhar", OTHER_SECTION);
    rememberClass("sirichandrasekhar", SECTION_A);
    expect(savedClasses("sirichandrasekhar")).toEqual([
      SECTION_A,
      OTHER_SECTION,
    ]);
  });
  test("no date is ever stored with a section", () => {
    saved.clear();
    rememberClass("sirichandrasekhar", SECTION_A);
    const raw = saved.get("section-sirichandrasekhar") ?? "";
    expect(raw, "the range belongs to the register").not.toMatch(
      /\d{4}-\d{2}-\d{2}/
    );
  });
  test("a save missing a level is not offered back", () => {
    saved.clear();
    rememberClass("sirichandrasekhar", { ...SECTION_A, section: "" });
    rememberClass("sirichandrasekhar", { ...SECTION_A, branch: "" });
    expect(savedClasses("sirichandrasekhar")).toEqual([]);
  });
  test("one user's sections are never handed to the next", () => {
    saved.clear();
    rememberClass("sirichandrasekhar", SECTION_A);
    // Readable for its owner first: without this, the assertion below passes for
    // the wrong reason on any build where nothing is readable at all.
    expect(savedClasses("sirichandrasekhar")).toEqual([SECTION_A]);
    expect(savedClasses("someone-else")).toEqual([]);
  });
  test("forgetting one leaves the others", () => {
    saved.clear();
    rememberClass("sirichandrasekhar", SECTION_A);
    rememberClass("sirichandrasekhar", OTHER_SECTION);
    forgetClass("sirichandrasekhar", SECTION_A);
    expect(savedClasses("sirichandrasekhar")).toEqual([OTHER_SECTION]);
  });
  test("a card saved before sections were, still reads as its section", () => {
    // Cards used to be one per subject. The section is all such an entry needs,
    // so it opens rather than being dropped when the shape changed.
    saved.clear();
    saved.set("section-sirichandrasekhar", JSON.stringify([CLASS_A]));
    expect(savedClasses("sirichandrasekhar")).toEqual([SECTION_A]);
  });
  test("a refused storage saves nothing and breaks nothing", () => {
    const real = globalThis.localStorage;
    globalThis.localStorage = {
      getItem: () => {
        throw new Error("denied");
      },
      setItem: () => {
        throw new Error("denied");
      },
      removeItem: () => {
        throw new Error("denied");
      },
    } as unknown as Storage;
    expect(() => rememberClass("sirichandrasekhar", SECTION_A)).not.toThrow();
    expect(savedClasses("sirichandrasekhar")).toEqual([]);
    expect(() => forgetClass("sirichandrasekhar", SECTION_A)).not.toThrow();
    globalThis.localStorage = real;
  });
  test("a stored value that is not a list of sections is refused", () => {
    saved.clear();
    saved.set("section-sirichandrasekhar", "{not json");
    expect(savedClasses("sirichandrasekhar")).toEqual([]);
    saved.set("section-sirichandrasekhar", JSON.stringify({ course: "1" }));
    expect(
      savedClasses("sirichandrasekhar"),
      "a half-named section is not a section"
    ).toEqual([]);
    saved.set(
      "section-sirichandrasekhar",
      JSON.stringify([{ course: "1" }, CLASS_A])
    );
    expect(
      savedClasses("sirichandrasekhar"),
      "one bad entry costs itself, not the rest"
    ).toEqual([SECTION_A]);
  });
  test("a section saved as one object is still offered", () => {
    saved.clear();
    rememberClass("sirichandrasekhar", SECTION_A);
    saved.set("section-sirichandrasekhar", JSON.stringify(SECTION_A));
    expect(savedClasses("sirichandrasekhar")).toEqual([SECTION_A]);
  });
});

test.describe("the cascade helpers beside it", () => {
  test("ALL SUBJECTS stands in its first subject for a probe, or nothing", () => {
    const subjects = [ALL_SUBJECTS, opt("7", "MFCS"), opt("8", "DBMS")];
    expect(probeSubject(subjects, ALL_SUBJECTS)).toEqual(opt("7", "MFCS"));
    expect(probeSubject(subjects, opt("8", "DBMS"))).toEqual(opt("8", "DBMS"));
    expect(probeSubject([ALL_SUBJECTS], ALL_SUBJECTS)).toBeNull();
  });
  test("the semester title travels empty where the semester names nothing", () => {
    const titled: OptionsReply = {
      ...reply({
        course: [],
        semester: [],
        branch: [],
        section: [],
        subject: [],
      }),
      semester: [opt("3", "III", "2025")],
    };
    expect(semesterTitleOf(titled, "3")).toBe("2025");
    expect(semesterTitleOf(titled, "9")).toBe("");
  });
  test("a selection key names every level, in cascade order", () => {
    const full = sel({
      course: "1",
      semester: "3",
      branch: "6",
      section: "2",
      subject: "57",
    });
    expect(selKeyOf(full)).toBe("1|3|6|2|57");
    expect(selKeyOf({ ...full, subject: "58" })).not.toBe(selKeyOf(full));
    expect(selKeyOf({ ...full, section: "9" })).not.toBe(selKeyOf(full));
  });
});
