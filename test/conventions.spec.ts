import { createDecipheriv } from "node:crypto";

import { test, expect } from "@playwright/test";

import {
  absorbResponse,
  absorbSetCookie,
  AES_KEY,
  calendarPairs,
  CookieJar,
  enc,
  jqBody,
  nextHop,
  portalEncrypt,
  webMethodBody,
} from "../server/portal-conventions";
import type { CascadeLevel, Option } from "../shared/api";

test.describe("the password cipher", () => {
  test("produces bare base64 ciphertext, not the OpenSSL Salted__ form", () => {
    const cipher = portalEncrypt("secret");
    expect(cipher).not.toContain("Salted__");
    expect(cipher).toMatch(/^[A-Za-z0-9+/]+=*$/);
  });
  test("is one block of padding, with no salt and no header prepended", () => {
    expect(Buffer.from(portalEncrypt("secret"), "base64").length).toBe(16);
    expect(
      Buffer.from(portalEncrypt("seventeen bytes!!"), "base64").length
    ).toBe(32);
  });
  test("carries no salt, so nothing about the output varies with a random source", () => {
    const a = Buffer.from(portalEncrypt("secret"), "base64");
    const b = Buffer.from(portalEncrypt("secret"), "base64");
    expect(a.equals(b)).toBe(true);
    expect(a.length).toBe(16);
  });
  test("round-trips, so the key really is used as the IV as well", () => {
    const plain = "a password with spaces & symbols";
    const decipher = createDecipheriv(
      "aes-128-cbc",
      Buffer.from(AES_KEY, "utf-8"),
      Buffer.from(AES_KEY, "utf-8")
    );
    const out = Buffer.concat([
      decipher.update(Buffer.from(portalEncrypt(plain), "base64")),
      decipher.final(),
    ]).toString("utf-8");
    expect(out).toBe(plain);
  });
  test("the same input always gives the same output, so no random IV is involved", () => {
    expect(portalEncrypt("secret")).toBe(portalEncrypt("secret"));
  });
  test("is 16-byte-block aligned, so block padding is what makes it work", () => {
    const cipher = portalEncrypt("a");
    expect(Buffer.from(cipher, "base64").length % 16).toBe(0);
  });
});
test.describe("enc(), which escapes only % and =", () => {
  test("escapes the two characters the portal's own JavaScript escapes", () => {
    expect(enc("50%")).toBe("50%26");
    expect(enc("a=b")).toBe("a%3Db");
  });
  test("leaves everything else alone, because the portal does not encode it", () => {
    expect(enc("MFCS & Data Structures")).toBe("MFCS & Data Structures");
    expect(enc("a b+c/d?e")).toBe("a b+c/d?e");
  });
  test("escapes every occurrence, not just the first", () => {
    expect(enc("a=b=c")).toBe("a%3Db%3Dc");
  });
});
test.describe("convention A, the dropdown fillers", () => {
  test("wraps keys and string values in single quotes, which is not JSON", () => {
    expect(jqBody({ controlid: "ddlcourse" })).toBe(
      "{'controlid':'ddlcourse'}"
    );
  });
  test("leaves numbers and booleans unquoted", () => {
    expect(jqBody({ courseid: 1, isdefaultall: false })).toBe(
      "{'courseid':1,'isdefaultall':false}"
    );
  });
  test("preserves the order it was given, because the portal's parser is positional in places", () => {
    expect(jqBody({ a: "1", b: "2", c: "3" })).toBe(
      "{'a':'1','b':'2','c':'3'}"
    );
  });
  test("escapes a single quote inside a value as \\'", () => {
    expect(jqBody({ title: "O'Brien" })).toBe("{'title':'O\\'Brien'}");
  });
});
test.describe("convention B, the static web methods", () => {
  test("joins name=value with CRLF, not with &", () => {
    expect(
      webMethodBody([
        ["CourseId", 1],
        ["BranchId", 6],
      ])
    ).toBe("CourseId=1\r\nBranchId=6");
  });
  test("escapes values through enc(), so the body is safe without being encoded", () => {
    expect(webMethodBody([["SemesterName", "III & IV"]])).toBe(
      "SemesterName=III & IV"
    );
  });
  test("keeps the order given, because it is the proxy's declared order", () => {
    expect(
      webMethodBody([
        ["z", "1"],
        ["a", "2"],
      ])
    ).toBe("z=1\r\na=2");
  });
});
test.describe("ShowAcademicCalendar needs every level twice", () => {
  const levels: Record<CascadeLevel, Option> = {
    course: { value: "1", label: "B.Tech", title: "" },
    semester: { value: "3", label: "III Semester", title: "2025" },
    branch: { value: "6", label: "Information Technology", title: "" },
    section: { value: "1", label: "Section-1", title: "" },
    subject: { value: "57", label: "MFCS", title: "Theory" },
  };
  test("sends each level by identifier and by visible label", () => {
    const pairs = Object.fromEntries(
      calendarPairs({ ...levels, from: "", to: "" })
    );
    expect(pairs.Course).toBe("1");
    expect(pairs.CourseName).toBe("B.Tech");
    expect(pairs.Branch).toBe("6");
    expect(pairs.BranchName).toBe("Information Technology");
    expect(pairs.Semester).toBe("3");
    expect(pairs.SemesterName).toBe("III Semester");
  });
  test("sends the subject three ways, because its title is the teaching type", () => {
    const pairs = Object.fromEntries(
      calendarPairs({ ...levels, from: "", to: "" })
    );
    expect(pairs.SubjectId).toBe("57");
    expect(pairs.SubjectShortCode).toBe("MFCS");
    expect(pairs.SubjectType).toBe("Theory");
  });
  test("a missing title becomes an empty value, not the word undefined", () => {
    const pairs = Object.fromEntries(
      calendarPairs({
        ...levels,
        subject: { value: "57", label: "MFCS" } as Option,
        from: "",
        to: "",
      })
    );
    expect(pairs.SubjectType).toBe("");
    expect(pairs.SubjectType).not.toBe("undefined");
  });
  test("an empty title stays empty, and is not turned into a placeholder", () => {
    const pairs = Object.fromEntries(
      calendarPairs({
        ...levels,
        subject: { value: "57", label: "MFCS", title: "" },
        from: "",
        to: "",
      })
    );
    expect(pairs.SubjectType).toBe("");
  });
  test("never asks the portal to print, and always carries both dates", () => {
    const pairs = Object.fromEntries(
      calendarPairs({ ...levels, from: "01/01/2026", to: "28/09/2026" })
    );
    expect(pairs.AllowPrint).toBe("false");
    expect(pairs.fromdate).toBe("01/01/2026");
    expect(pairs.todate).toBe("28/09/2026");
  });
});
test.describe("the cookie jar", () => {
  test("is not signed in until the portal issues frmAuth", () => {
    const jar = new CookieJar();
    expect(jar.signedIn).toBe(false);
    jar.entries.set("ASP.NET_SessionId", "abc");
    expect(jar.signedIn).toBe(false);
    jar.entries.set("frmAuth", "yes");
    expect(jar.signedIn).toBe(true);
  });
  test("has no header at all while empty, rather than an empty one", () => {
    expect(new CookieJar().header()).toBeNull();
  });
  test("joins every cookie it holds into one header", () => {
    const jar = new CookieJar();
    jar.entries.set("a", "1");
    jar.entries.set("b", "2");
    expect(jar.header()).toBe("a=1; b=2");
  });
  test("keeps only the first pair of a Set-Cookie, never its attributes", () => {
    const jar = new CookieJar();
    expect(
      absorbSetCookie(jar, "frmAuth=abc; Path=/; HttpOnly; SameSite=Strict")
    ).toBe(true);
    expect(jar.entries.get("frmAuth")).toBe("abc");
    expect(jar.entries.has("Path")).toBe(false);
    expect(jar.entries.size).toBe(1);
  });
  test("keeps a value that itself contains an =", () => {
    const jar = new CookieJar();
    absorbSetCookie(jar, "frmAuth=ab=cd==; Path=/");
    expect(jar.entries.get("frmAuth")).toBe("ab=cd==");
  });
  test("refuses a cookie with no name, rather than storing an empty one", () => {
    const jar = new CookieJar();
    expect(absorbSetCookie(jar, "=orphan")).toBe(false);
    expect(absorbSetCookie(jar, "novalue")).toBe(false);
    expect(jar.entries.size).toBe(0);
    expect(jar.header()).toBeNull();
  });
  test("reads a missing or empty header as no cookie at all", () => {
    const jar = new CookieJar();
    expect(absorbSetCookie(jar, null)).toBe(false);
    expect(absorbSetCookie(jar, undefined)).toBe(false);
    expect(absorbSetCookie(jar, "")).toBe(false);
  });
  test("takes every cookie off a response and reports how many were usable", () => {
    const res = new Response(null, {
      headers: [
        ["set-cookie", "frmAuth=abc; Path=/"],
        ["set-cookie", "ASP.NET_SessionId=xyz; Path=/"],
        ["set-cookie", "malformed"],
      ],
    });
    const jar = new CookieJar();
    expect(absorbResponse(jar, res)).toBe(2);
    expect(jar.signedIn).toBe(true);
    expect(jar.entries.get("ASP.NET_SessionId")).toBe("xyz");
  });
  test("a response with no Set-Cookie is not a crash", () => {
    expect(absorbResponse(new CookieJar(), new Response(null))).toBe(0);
  });
});
const at = (status: number, location?: string): Response =>
  new Response(null, location ? { status, headers: { location } } : { status });
test.describe("following redirects by hand", () => {
  test("follows a 302 to the location it was given", () => {
    expect(nextHop(at(302, "/vignanit/main.aspx"), "https://x/y", 6)).toBe(
      "https://x/vignanit/main.aspx"
    );
  });
  test("resolves a relative location against the URL that produced it", () => {
    expect(nextHop(at(301, "sub"), "https://x/a/b", 6)).toBe("https://x/a/sub");
  });
  test("keeps an absolute location as it is", () => {
    expect(nextHop(at(302, "https://other/x"), "https://x/a", 6)).toBe(
      "https://other/x"
    );
  });
  test("stops at the hop limit, so a redirect loop cannot hang the server", () => {
    expect(nextHop(at(302, "/again"), "https://x/", 0)).toBeNull();
    expect(nextHop(at(302, "/again"), "https://x/", 6)).toBe("https://x/again");
  });
  test("hands back a redirect with no Location rather than guessing", () => {
    expect(nextHop(at(302), "https://x/", 6)).toBeNull();
  });
  test("does not follow a 200, and does not treat a 404 as a redirect", () => {
    expect(nextHop(at(200, "/somewhere"), "https://x/", 6)).toBeNull();
    expect(nextHop(at(404, "/somewhere"), "https://x/", 6)).toBeNull();
  });
});
