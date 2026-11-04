import { expect, test } from "@playwright/test";

import { ALL_SUBJECTS } from "../shared/api";
import type { OptionsReply } from "../shared/api";
import {
  probeSubject,
  selKeyOf,
  semesterTitleOf,
  subjectNameKey,
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

test.describe("the saved classes", () => {
  const OTHER_SECTION: Sel = {
    course: "1",
    semester: "3",
    branch: "5",
    section: "B",
    subject: "101",
  };
  const OTHER_SUBJECT: Sel = { ...CLASS_A, subject: "102" };
  test("a class that was saved comes back after a reload", () => {
    saved.clear();
    rememberClass("sirichandrasekhar", CLASS_A);
    expect(savedClasses("sirichandrasekhar")).toEqual([CLASS_A]);
  });
  test("the subject is saved, so a card opens that subject's register", () => {
    saved.clear();
    rememberClass("sirichandrasekhar", OTHER_SUBJECT);
    expect(savedClasses("sirichandrasekhar")[0]?.subject).toBe("102");
  });
  test("two subjects in one section are two classes", () => {
    saved.clear();
    rememberClass("sirichandrasekhar", CLASS_A);
    rememberClass("sirichandrasekhar", OTHER_SUBJECT);
    expect(savedClasses("sirichandrasekhar")).toEqual([OTHER_SUBJECT, CLASS_A]);
  });
  test("classes from any section are all kept", () => {
    saved.clear();
    rememberClass("sirichandrasekhar", CLASS_A);
    rememberClass("sirichandrasekhar", OTHER_SECTION);
    expect(savedClasses("sirichandrasekhar")).toEqual([OTHER_SECTION, CLASS_A]);
  });
  test("saving the same class twice keeps one of it", () => {
    saved.clear();
    rememberClass("sirichandrasekhar", CLASS_A);
    rememberClass("sirichandrasekhar", CLASS_A);
    expect(savedClasses("sirichandrasekhar")).toEqual([CLASS_A]);
  });
  test("the newest save is offered first, and re-saving moves rather than adds", () => {
    saved.clear();
    rememberClass("sirichandrasekhar", CLASS_A);
    rememberClass("sirichandrasekhar", OTHER_SECTION);
    rememberClass("sirichandrasekhar", CLASS_A);
    expect(savedClasses("sirichandrasekhar")).toEqual([CLASS_A, OTHER_SECTION]);
  });
  test("no date is ever stored with a class", () => {
    saved.clear();
    rememberClass("sirichandrasekhar", CLASS_A);
    const raw = saved.get("section-sirichandrasekhar") ?? "";
    expect(raw, "the range belongs to the register").not.toMatch(
      /\d{4}-\d{2}-\d{2}/
    );
  });
  test("a save with no subject is not offered back", () => {
    saved.clear();
    rememberClass("sirichandrasekhar", { ...CLASS_A, subject: "" });
    expect(savedClasses("sirichandrasekhar")).toEqual([]);
  });
  test("a save missing any level is not offered back", () => {
    saved.clear();
    rememberClass("sirichandrasekhar", { ...CLASS_A, section: "" });
    expect(savedClasses("sirichandrasekhar")).toEqual([]);
  });
  test("one user's classes are never handed to the next", () => {
    saved.clear();
    rememberClass("sirichandrasekhar", CLASS_A);
    // Readable for its owner first: without this, the assertion below passes for
    // the wrong reason on any build where nothing is readable at all.
    expect(savedClasses("sirichandrasekhar")).toEqual([CLASS_A]);
    expect(savedClasses("someone-else")).toEqual([]);
  });
  test("forgetting one leaves the others", () => {
    saved.clear();
    rememberClass("sirichandrasekhar", CLASS_A);
    rememberClass("sirichandrasekhar", OTHER_SUBJECT);
    forgetClass("sirichandrasekhar", CLASS_A);
    expect(savedClasses("sirichandrasekhar")).toEqual([OTHER_SUBJECT]);
  });
  test("the same subject code in two sections keeps its own name", () => {
    // A subject code repeats across branches, so the label saved for Section-A's
    // "101" must not become Section-B's "101" name. Both classes survive a reload
    // and both are still named, each with its own.
    const sameCodeOtherSection: Sel = {
      course: "1",
      semester: "3",
      branch: "7",
      section: "B",
      subject: "101",
    };
    saved.clear();
    rememberClass("sirichandrasekhar", CLASS_A, "Computer Networks");
    rememberClass("sirichandrasekhar", sameCodeOtherSection, "Discrete Maths");
    const restored = savedClasses("sirichandrasekhar");
    expect(
      restored.map((s) => s.label).toSorted(),
      "a shared subject code let one section's name overwrite the other's"
    ).toEqual(["Computer Networks", "Discrete Maths"]);
  });
  test("a name key is never the bare subject value", () => {
    // The guard on the key itself, because the collision above is invisible until
    // two sections happen to share a code. Value-only keys pass everything else.
    expect(subjectNameKey("A", "101")).not.toBe("101");
    expect(subjectNameKey("B", "101")).not.toBe(subjectNameKey("A", "101"));
  });
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
  test("a saved class is named again after a reload, with no portal call", () => {
    // A card that cannot name its own subject makes the user open every card once
    // per browser session before the screen is readable.
    saved.clear();
    rememberClass("sirichandrasekhar", CLASS_A, "Computer Networks");
    const [restored] = savedClasses("sirichandrasekhar");
    expect(restored?.label).toBe("Computer Networks");
  });
  test("the name is the subject's, never the one already stored", () => {
    // Re-saving the same class with a new label must replace it, not keep the
    // first — otherwise a renamed subject stays wrong however often it is saved.
    saved.clear();
    rememberClass("sirichandrasekhar", CLASS_A, "Computer Networks");
    rememberClass("sirichandrasekhar", CLASS_A, "Computer Networks II");
    const [restored] = savedClasses("sirichandrasekhar");
    expect(restored?.label).toBe("Computer Networks II");
  });
  test("saving without a name still offers the class", () => {
    // The label is a cache, not part of the identity: a class saved with no label
    // must still open rather than being dropped.
    saved.clear();
    rememberClass("sirichandrasekhar", CLASS_A);
    expect(savedClasses("sirichandrasekhar")).toHaveLength(1);
    expect(savedClasses("sirichandrasekhar")[0]?.label).toBeUndefined();
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
    expect(() => rememberClass("sirichandrasekhar", CLASS_A)).not.toThrow();
    expect(savedClasses("sirichandrasekhar")).toEqual([]);
    expect(() => forgetClass("sirichandrasekhar", CLASS_A)).not.toThrow();
    globalThis.localStorage = real;
  });
  test("a stored value that is not a list of classes is refused", () => {
    saved.clear();
    saved.set("section-sirichandrasekhar", "{not json");
    expect(savedClasses("sirichandrasekhar")).toEqual([]);
    saved.set("section-sirichandrasekhar", JSON.stringify({ course: "1" }));
    expect(
      savedClasses("sirichandrasekhar"),
      "a single object is not a list, and half-reading it invents a class"
    ).toEqual([]);
    saved.set(
      "section-sirichandrasekhar",
      JSON.stringify([{ course: "1" }, CLASS_A])
    );
    expect(
      savedClasses("sirichandrasekhar"),
      "one bad entry costs itself, not the rest"
    ).toEqual([CLASS_A]);
  });
  test("a class saved with no subject is dropped, not offered blank", () => {
    saved.clear();
    saved.set(
      "section-sirichandrasekhar",
      JSON.stringify([{ ...CLASS_A, subject: "" }, OTHER_SUBJECT])
    );
    expect(
      savedClasses("sirichandrasekhar"),
      "an entry from before subjects were saved cannot name a register"
    ).toEqual([OTHER_SUBJECT]);
  });
  test("a class saved as one object is still offered", () => {
    saved.clear();
    rememberClass("sirichandrasekhar", CLASS_A);
    saved.set("section-sirichandrasekhar", JSON.stringify(CLASS_A));
    expect(savedClasses("sirichandrasekhar")).toEqual([CLASS_A]);
  });
});
