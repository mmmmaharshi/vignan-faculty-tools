/**
 * The session store, over a fake vault and nothing else.
 *
 * The fake is the point. `Bun.secrets` writes to the real Windows Credential
 * Manager, so production wiring is the only code that touches it — which is the
 * same arrangement `server-routes.ts` already uses with its `PortalReader`, and
 * the reason the credential-free suite can cover all of this.
 *
 * Every test states a property. The one that matters most is the first: a session
 * written by one process must be usable by the next. That is the whole feature,
 * and the only honest way to say it is to write with one store and read with
 * another that shares nothing but the vault.
 */
import { expect, test } from "@playwright/test";

import {
  loadSessions,
  parseOne,
  saveSessions,
  sweep,
  VAULT_ENTRY,
} from "../session-store";
import type { Secrets, StoredSession } from "../session-store";

/** A vault in a Map. A restart is a fresh one over the same Map. */
function fakeVault(
  seed?: Map<string, string>
): Secrets & { store: Map<string, string> } {
  const store = seed ?? new Map<string, string>();
  return {
    store,
    get: (name) => Promise.resolve(store.get(name) ?? null),
    set: (name, value) => {
      store.set(name, value);
      return Promise.resolve();
    },
  };
}

const JAR: [string, string][] = [
  ["ASP.NET_SessionId", "abc123"],
  ["frmAuth", "DEADBEEF"],
];

const SESSION: StoredSession = { id: "s1", at: 1000, cookies: JAR };

test.describe("the session store", () => {
  test("a session written by one process is readable by the next", async () => {
    const store = new Map<string, string>();

    // "One process" and "the next" share nothing but the vault. That is exactly
    // what a restart leaves behind.
    expect(await saveSessions(fakeVault(store), [SESSION])).toBeNull();
    const loaded = await loadSessions(fakeVault(store));

    expect(loaded).toHaveLength(1);
    expect(loaded[0]?.id).toBe("s1");
    // The cookies are the whole auth state, so a jar that loses a member is a
    // session that will not authenticate. Both must survive, in order.
    expect(loaded[0]?.cookies).toEqual(JAR);
  });

  test("everything goes in one entry, because the vault cannot be listed", async () => {
    // `Bun.secrets` has no enumerate. If sessions were stored one per entry there
    // would be nothing to iterate at boot, and the index needed to find them
    // would be a second thing that can fall out of step.
    const vault = fakeVault();
    await saveSessions(vault, [SESSION, { ...SESSION, id: "s2" }]);
    expect([...vault.store.keys()]).toEqual([VAULT_ENTRY]);
    expect(await loadSessions(vault)).toHaveLength(2);
  });

  test("an empty vault is no sessions, not a crash", async () => {
    expect(await loadSessions(fakeVault())).toEqual([]);
  });

  test("an unreadable entry is no sessions, not a crash", async () => {
    // The caller is a server boot, and the worst acceptable outcome for an entry
    // we cannot read is that you sign in again.
    for (const body of [
      "",
      "{",
      "not json at all",
      "[]",
      "null",
      '{"not":"an array"}',
      '"a string"',
      "123",
    ]) {
      const seed = new Map([[VAULT_ENTRY, body]]);
      expect(
        await loadSessions(fakeVault(seed)),
        `survives ${JSON.stringify(body)}`
      ).toEqual([]);
    }
  });

  test("a vault that throws on read yields no sessions, not a crash", async () => {
    // A vault can fail for reasons that have nothing to do with us - a locked
    // profile, a policy. Refusing to boot over that would be worse than signing in.
    const hostile: Secrets = {
      get: () => Promise.reject(new Error("vault locked")),
      set: () => Promise.resolve(),
    };
    expect(await loadSessions(hostile)).toEqual([]);
  });

  test("one malformed session costs that session, not the rest", async () => {
    const seed = new Map([
      [
        VAULT_ENTRY,
        JSON.stringify([
          { id: "", at: 1, cookies: JAR }, // no id
          { id: "bad-at", at: "soon", cookies: JAR }, // at is not a number
          { id: "bad-jar", at: 1, cookies: "nope" }, // cookies is not pairs
          { id: "no-auth", at: 1, cookies: [["ASP.NET_SessionId", "x"]] },
          SESSION,
        ]),
      ],
    ]);
    const loaded = await loadSessions(fakeVault(seed));
    expect(loaded.map((s) => s.id)).toEqual(["s1"]);
  });

  test("a jar with no frmAuth is refused, because it is not a session", () => {
    // Restored as-is, a jar missing the credential looks exactly like a signed-in
    // one and every portal call would fail. The alternative - keeping it - is
    // worse than dropping it, because the drop is a clean sign-in form.
    expect(
      parseOne({ id: "s", at: 1, cookies: [["ASP.NET_SessionId", "x"]] })
    ).toBeNull();
    expect(parseOne({ id: "s", at: 1, cookies: [] })).toBeNull();
  });

  test("a malformed cookie pair is dropped, the rest of the jar survives", () => {
    // frmAuth is the credential. If a bad neighbour took the whole jar with it,
    // the session would be dead with no visible reason why.
    const parsed = parseOne({
      id: "s",
      at: 1,
      cookies: [
        ["frmAuth", "kept"],
        ["broken"],
        [1, 2],
        ["", "empty-name"],
        ["ASP.NET_SessionId", "also-kept"],
      ],
    });
    expect(parsed?.cookies).toEqual([
      ["frmAuth", "kept"],
      ["ASP.NET_SessionId", "also-kept"],
    ]);
  });

  test("a session past the TTL is dropped, not restored", () => {
    // Held to *this* build's TTL rather than trusted, so an entry written by an
    // older build cannot come back with a longer life than the code allows.
    const day = 24 * 60 * 60 * 1000;
    const now = 40 * day;
    const result = sweep(
      [
        { id: "fresh", at: now - 1000, cookies: JAR },
        { id: "stale", at: now - 31 * day, cookies: JAR },
      ],
      now,
      30 * day
    );
    expect(result.kept.map((s) => s.id)).toEqual(["fresh"]);
    expect(result.dropped).toBe(1);
  });

  test("signing out removes the session from the vault, not just the map", async () => {
    const vault = fakeVault();
    await saveSessions(vault, [SESSION, { ...SESSION, id: "s2" }]);
    // What the logout handler writes: the map minus the one that ended.
    await saveSessions(vault, [{ ...SESSION, id: "s2" }]);
    const after = await loadSessions(vault);
    expect(after.map((s) => s.id)).toEqual(["s2"]);
  });

  test("a vault that refuses to write is reported, not thrown", async () => {
    // The server must keep serving its in-memory session rather than refusing to
    // start, or failing every sign-in, over a convenience write.
    const hostile: Secrets = {
      get: () => Promise.resolve(null),
      set: () => Promise.reject(new Error("access denied")),
    };
    expect(await saveSessions(hostile, [SESSION])).toContain("could not write");
  });
});
