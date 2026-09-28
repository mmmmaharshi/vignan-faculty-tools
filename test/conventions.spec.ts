/**
 * The portal's wire conventions, tested with no network and no credentials.
 *
 * These were private methods and private helpers inside `server.ts`, which
 * exports nothing, so none of them had a test. Every one of them is a landmine:
 * the portal's documented failure mode is "returns an empty result with no
 * error", which means a wrong convention does not fail loudly, it fails by
 * returning nothing and looking like a data problem.
 *
 * The AES test below pins the *shape* rather than a value, because the shape is
 * the thing that was discovered by hand and the thing a rewrite would break:
 * bare base64 ciphertext, no OpenSSL `Salted__` header.
 */

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
} from "../portal-conventions";
import type { CascadeLevel, Option } from "../shared/api";

test.describe("the password cipher", () => {
  test("produces bare base64 ciphertext, not the OpenSSL Salted__ form", () => {
    // The portal's JSFiles/jsaes.js is a custom build. Stock CryptoJS would
    // prepend "Salted__" plus a 16-byte salt, and a login built that way never
    // raises the Click event - so a correct password looks like a wrong one.
    const cipher = portalEncrypt("secret");
    expect(cipher).not.toContain("Salted__");
    expect(cipher).toMatch(/^[A-Za-z0-9+/]+=*$/); // base64, nothing else
  });

  test("is one block of padding, with no salt and no header prepended", () => {
    // The property that actually distinguishes this from stock CryptoJS, stated
    // as a length rather than as a substring. AES-CBC pads up to the next
    // 16-byte boundary, so a short input is exactly one block - and stock
    // CryptoJS would add a further "Salted__" plus a 16-byte salt on top.
    // Checking the size catches a salt whether or not it is spelled "Salted__".
    expect(Buffer.from(portalEncrypt("secret"), "base64").length).toBe(16);

    // Seventeen bytes cannot fit in one block, so it takes two - still with
    // nothing prepended.
    expect(
      Buffer.from(portalEncrypt("seventeen bytes!!"), "base64").length
    ).toBe(32);
  });

  test("carries no salt, so nothing about the output varies with a random source", () => {
    // A salt is normally random, which is the point of it. Two calls with the
    // same input must be byte-identical, because the portal has no way to learn
    // a random value.
    const a = Buffer.from(portalEncrypt("secret"), "base64");
    const b = Buffer.from(portalEncrypt("secret"), "base64");
    expect(a.equals(b)).toBe(true);
    expect(a.length).toBe(16);
  });

  test("round-trips, so the key really is used as the IV as well", () => {
    // Not a property the app depends on - it never decrypts. It is here because
    // "key used as IV" is unusual, and a change to separate them would be
    // silent: the cipher would still produce base64, still look right, and stop
    // authenticating.
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
    // An IV drawn at random would be correct AES and still fail here, since the
    // portal has no way to learn it.
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
    // This is the part that looks like a bug. Encoding spaces or `&` would
    // change the values the portal receives, and a subject name would come back
    // mangled. Do not "fix" it.
    expect(enc("MFCS & Data Structures")).toBe("MFCS & Data Structures");
    expect(enc("a b+c/d?e")).toBe("a b+c/d?e");
  });

  test("escapes every occurrence, not just the first", () => {
    expect(enc("a=b=c")).toBe("a%3Db%3Dc");
  });
});

test.describe("convention A, the dropdown fillers", () => {
  test("wraps keys and string values in single quotes, which is not JSON", () => {
    // The portal's parser wants this. Real JSON would be rejected, and the
    // rejection is an empty result rather than an error.
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
    // The one place a real value can break the body - a subject title or a
    // student's name. This is the escape the portal's own JavaScript emits, and
    // it is not the one JSON would use.
    expect(jqBody({ title: "O'Brien" })).toBe("{'title':'O\\'Brien'}");
  });
});

test.describe("convention B, the static web methods", () => {
  test("joins name=value with CRLF, not with &", () => {
    // It looks like a query string. It is not one, and the portal does not parse
    // it as one.
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
    // Not alphabetical, not sorted by name. Reordering would be a silent change
    // to a protocol that answers with nothing when it is wrong.
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
    // The single most expensive behaviour this app works around. Passing only
    // the values returns NOTHING AT ALL rather than failing, which is why a
    // per-session label cache used to exist.
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
    // Most levels have no title, and `Option.title` is typed as a required
    // string - so the runtime value really can be absent when the portal omits
    // the attribute. Sending "undefined" is a value the portal will accept and
    // then fail on, and it fails as an empty register rather than an error.
    const pairs = Object.fromEntries(
      calendarPairs({
        ...levels,
        // The attribute was simply not in the markup.
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
    // That one cookie is the whole auth state; nothing else is needed.
    const jar = new CookieJar();
    expect(jar.signedIn).toBe(false);

    jar.entries.set("ASP.NET_SessionId", "abc");
    expect(jar.signedIn).toBe(false);

    jar.entries.set("frmAuth", "yes");
    expect(jar.signedIn).toBe(true);
  });

  test("has no header at all while empty, rather than an empty one", () => {
    // An empty `cookie: ` header is not the same as sending nothing, and some
    // servers answer the first with 401.
    expect(new CookieJar().header()).toBeNull();
  });

  test("joins every cookie it holds into one header", () => {
    const jar = new CookieJar();
    jar.entries.set("a", "1");
    jar.entries.set("b", "2");
    expect(jar.header()).toBe("a=1; b=2");
  });

  test("keeps only the first pair of a Set-Cookie, never its attributes", () => {
    // Storing Path=/ as a cookie called "Path" would send it on every request,
    // and the portal would not explain the result.
    const jar = new CookieJar();
    expect(
      absorbSetCookie(jar, "frmAuth=abc; Path=/; HttpOnly; SameSite=Strict")
    ).toBe(true);
    expect(jar.entries.get("frmAuth")).toBe("abc");
    expect(jar.entries.has("Path")).toBe(false);
    expect(jar.entries.size).toBe(1);
  });

  test("keeps a value that itself contains an =", () => {
    // base64 padding ends in "=" and a JWT has dots; splitting on the first "="
    // is the only reading that survives either.
    const jar = new CookieJar();
    absorbSetCookie(jar, "frmAuth=ab=cd==; Path=/");
    expect(jar.entries.get("frmAuth")).toBe("ab=cd==");
  });

  test("refuses a cookie with no name, rather than storing an empty one", () => {
    // A jar holding "=value" produces a header that is wrong in a way the
    // portal will not explain.
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
    // A silent partial failure here is the real hazard: dropping
    // ASP.NET_SessionId still signs in, so the app works until it does not.
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

/** A response with a status and, optionally, a Location header. */
const at = (status: number, location?: string): Response =>
  new Response(null, location ? { status, headers: { location } } : { status });

test.describe("following redirects by hand", () => {
  test("follows a 302 to the location it was given", () => {
    // Bun.fetch does not store Set-Cookie, so the 302 after sign-in is where
    // frmAuth is issued. Letting fetch follow it would replay the request
    // without the cookie that was just handed out, and a good sign-in would
    // look like a failure.
    expect(nextHop(at(302, "/vignanit/main.aspx"), "https://x/y", 6)).toBe(
      "https://x/vignanit/main.aspx"
    );
  });

  test("resolves a relative location against the URL that produced it", () => {
    // Which is what the portal sends.
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
    // A malformed one surfaces as the 3xx it is, instead of a request to the
    // wrong place.
    expect(nextHop(at(302), "https://x/", 6)).toBeNull();
  });

  test("does not follow a 200, and does not treat a 404 as a redirect", () => {
    expect(nextHop(at(200, "/somewhere"), "https://x/", 6)).toBeNull();
    expect(nextHop(at(404, "/somewhere"), "https://x/", 6)).toBeNull();
  });
});
