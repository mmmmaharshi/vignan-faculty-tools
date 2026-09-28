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
  parseSession,
  saveSessions,
  sessionKey,
  sweep,
  VAULT_INDEX,
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
    delete: (name) => Promise.resolve(store.delete(name)),
  };
}

const JAR: [string, string][] = [
  ["ASP.NET_SessionId", "abc123"],
  ["frmAuth", "DEADBEEF"],
];

/**
 * A session as of a moment ago, rather than at a fixed timestamp.
 *
 * `at` is a wall-clock time and `saveSessions` prunes on it, so a literal would
 * age past the cutoff as the suite runs. Six failures in this file were exactly
 * that: the fixture had quietly become stale and the store was right to drop it.
 */
const SESSION: StoredSession = { id: "s1", at: Date.now(), cookies: JAR };

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

  test("everything goes in one entry per session, plus an index", async () => {
    // `Bun.secrets` cannot be enumerated, so something has to list the entries.
    // Packing every session into one entry instead is the mistake this shape
    // exists to avoid: Windows caps a generic credential's blob at 2560 bytes and a
    // session is ~526 of them, so the fifth sign-in is rejected outright and
    // persistence stops working with nothing on screen to say so.
    const vault = fakeVault();
    await saveSessions(vault, [SESSION, { ...SESSION, id: "s2" }]);
    expect([...vault.store.keys()].toSorted()).toEqual([
      "session-s1",
      "session-s2",
      VAULT_INDEX,
    ]);
    const loaded = await loadSessions(vault);
    expect(loaded.map((s) => s.id)).toEqual(["s1", "s2"]);
  });

  test("a real-sized set of sessions stays under the Windows size cap", async () => {
    // The measurement that found the ceiling, kept as a test so the shape cannot
    // quietly go back to one entry. `CRED_MAX_CREDENTIAL_BLOB_SIZE` is 5 x 512.
    const cap = 5 * 512;
    const realistic: StoredSession[] = Array.from({ length: 20 }, (_, i) => ({
      id: `session-${i}`,
      // Now, not a literal: the store prunes on age, so a fixed timestamp here
      // would be stale and the twenty sessions would be pruned to none.
      at: Date.now(),
      cookies: [
        ["ASP.NET_SessionId", "k".repeat(24)],
        ["frmAuth", "A".repeat(384)],
      ],
    }));
    const vault = fakeVault();
    await saveSessions(vault, realistic);
    const biggest = Math.max(
      ...[...vault.store].map(([name, value]) =>
        name === VAULT_INDEX ? 0 : value.length
      )
    );
    // One session's own entry, and the index, both have to fit.
    expect(biggest, "largest single entry").toBeLessThan(cap);
    expect(
      vault.store.get(VAULT_INDEX)?.length ?? 0,
      "the index holds ids only, so it grows at ~39 bytes a session"
    ).toBeLessThan(cap);
    const all = await loadSessions(vault);
    expect(all.length).toBe(20);
  });

  test("a stale session is not rewritten, however often the store is saved", async () => {
    // A boot-time sweep alone was not enough: a long-running server never boots
    // again, and every sign-in from another browser added an entry. Measured after
    // half an hour of test runs - seventeen sessions, seven already dead at the
    // portal. A store that only tidies itself on restart does not get tidied, and
    // one entry per session means that also eats the 2560-byte size cap.
    const day = 24 * 60 * 60 * 1000;
    const now = Date.now();
    const vault = fakeVault();
    await saveSessions(vault, [
      { id: "fresh", at: now - 1000, cookies: JAR },
      { id: "ancient", at: now - 30 * day, cookies: JAR },
    ]);
    const after = await loadSessions(vault);
    expect(after.map((s) => s.id)).toEqual(["fresh"]);
    // And the entry is gone, not merely unindexed.
    expect(vault.store.has(sessionKey("ancient"))).toBe(false);
  });

  test("a session just inside the cutoff is kept, because it might still work", async () => {
    // ECAP's own session ends at about twenty minutes, measured, so a day is
    // generous - and it has to be. Deleting a session that would still have
    // authenticated is a worse failure than keeping one that will not.
    const hour = 60 * 60 * 1000;
    const vault = fakeVault();
    await saveSessions(vault, [
      { id: "old", at: Date.now() - 23 * hour, cookies: JAR },
    ]);
    const kept = await loadSessions(vault);
    expect(kept.map((s) => s.id)).toEqual(["old"]);
  });

  test("an ended session's entry is removed, not left orphaned", async () => {
    const vault = fakeVault();
    await saveSessions(vault, [SESSION, { ...SESSION, id: "s2" }]);
    // A sign-out rewrites the set without one session.
    await saveSessions(vault, [{ ...SESSION, id: "s2" }]);
    expect(vault.store.has(sessionKey("s1"))).toBe(false);
    const loaded = await loadSessions(vault);
    expect(loaded.map((s) => s.id)).toEqual(["s2"]);
  });

  test("a failed write leaves the previous index, and its sessions, intact", async () => {
    // The order the two writes happen in, which is the whole reason they are two.
    // Sessions are written first and the index second, so a write that fails
    // part-way leaves the old index in place and every id in it still resolves.
    // Written the other way round, the index would name an entry that was never
    // stored, and a load would drop a live session with nothing to show why.
    const store = new Map<string, string>();
    let failNext = false;
    const flaky: Secrets = {
      get: (name) => Promise.resolve(store.get(name) ?? null),
      set: (name, value) => {
        if (failNext) return Promise.reject(new Error("disk full"));
        store.set(name, value);
        return Promise.resolve();
      },
      delete: (name) => Promise.resolve(store.delete(name)),
    };
    // A first save that succeeds, so there is a real previous index to protect.
    expect(await saveSessions(flaky, [SESSION])).toBeNull();
    const indexBefore = store.get(VAULT_INDEX);
    expect(indexBefore).toBeTruthy();

    // The second fails on the first session it tries to write.
    failNext = true;
    const written = await saveSessions(flaky, [
      SESSION,
      { ...SESSION, id: "s2" },
    ]);
    expect(written).toContain("could not write");

    // The index is untouched, so the session it names is still reachable.
    expect(store.get(VAULT_INDEX)).toBe(indexBefore);
    const survived = await loadSessions(flaky);
    expect(survived.map((s) => s.id)).toEqual(["s1"]);
  });

  test("a session the index does not name is never loaded", async () => {
    // The index is the only way anything is found, because the vault cannot be
    // enumerated. An entry sitting on disk that the index omits is invisible, and
    // that is the intended behaviour rather than a gap: the index is written last,
    // so it only ever names entries that are already stored. Anything else would
    // mean loading every credential on the machine to find one.
    const store = new Map([
      [VAULT_INDEX, JSON.stringify(["s2"])],
      [sessionKey("s1"), JSON.stringify(SESSION)],
      [sessionKey("s2"), JSON.stringify({ ...SESSION, id: "s2" })],
    ]);
    const loaded = await loadSessions(fakeVault(store));
    expect(loaded.map((s) => s.id)).toEqual(["s2"]);
  });

  test("an index naming a missing entry costs that session, not the rest", async () => {
    // A write interrupted between the entries and the index can leave the index
    // pointing at something that was never written.
    const store = new Map([
      [VAULT_INDEX, JSON.stringify(["gone", "s2"])],
      [sessionKey("s2"), JSON.stringify({ ...SESSION, id: "s2" })],
    ]);
    const loaded = await loadSessions(fakeVault(store));
    expect(loaded.map((s) => s.id)).toEqual(["s2"]);
  });

  test("an entry filed under the wrong id is not trusted", async () => {
    // Otherwise a restored session carries an id the cookie does not match, and
    // the next request is a 401 against a jar that looked fine.
    const store = new Map([
      [VAULT_INDEX, JSON.stringify(["s2"])],
      [sessionKey("s2"), JSON.stringify(SESSION)],
    ]);
    const mismatched = await loadSessions(fakeVault(store));
    expect(mismatched).toEqual([]);
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
      const seed = new Map([[VAULT_INDEX, body]]);
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
      delete: () => Promise.resolve(false),
    };
    expect(await loadSessions(hostile)).toEqual([]);
  });

  test("one malformed session costs that session, not the rest", async () => {
    const store = new Map([
      [VAULT_INDEX, JSON.stringify(["", "bad-at", "bad-jar", "no-auth", "s1"])],
      [
        sessionKey("bad-at"),
        JSON.stringify({ id: "bad-at", at: "soon", cookies: JAR }),
      ],
      [
        sessionKey("bad-jar"),
        JSON.stringify({ id: "bad-jar", at: 1, cookies: "nope" }),
      ],
      [
        sessionKey("no-auth"),
        JSON.stringify({
          id: "no-auth",
          at: 1,
          cookies: [["ASP.NET_SessionId", "x"]],
        }),
      ],
      [sessionKey("s1"), JSON.stringify(SESSION)],
    ]);
    const loaded = await loadSessions(fakeVault(store));
    expect(loaded.map((s) => s.id)).toEqual(["s1"]);
  });

  test("a jar with no frmAuth is refused, because it is not a session", () => {
    // Restored as-is, a jar missing the credential looks exactly like a signed-in
    // one and every portal call would fail. The alternative - keeping it - is
    // worse than dropping it, because the drop is a clean sign-in form.
    expect(
      parseSession({ id: "s", at: 1, cookies: [["ASP.NET_SessionId", "x"]] })
    ).toBeNull();
    expect(parseSession({ id: "s", at: 1, cookies: [] })).toBeNull();
  });

  test("a malformed cookie pair is dropped, the rest of the jar survives", () => {
    // frmAuth is the credential. If a bad neighbour took the whole jar with it,
    // the session would be dead with no visible reason why.
    const parsed = parseSession({
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

  // NOTE: the fact that signing out *reaches the vault* is not testable here, and
  // an earlier version of this file pretended otherwise. It called `saveSessions`
  // twice with a hand-written list and a comment saying "what the logout handler
  // writes" - which passes identically whether or not the handler flushes, and so
  // proved nothing about the one thing that matters. The real coverage drives the
  // actual endpoint and watches the vault: "a sign-out survives a restart" in
  // test/smoke.spec.ts. What remains here is the part this module owns - that the
  // store round-trips a set of sessions, and that removing one from the set is
  // what the vault is then asked to hold.
  test("the set the vault holds is the set that comes back", async () => {
    const vault = fakeVault();
    await saveSessions(vault, [SESSION, { ...SESSION, id: "s2" }]);
    const both = await loadSessions(vault);
    expect(both.map((s) => s.id)).toEqual(["s1", "s2"]);

    // Dropping one from the set - which is all the logout handler does before
    // handing the rest to `saveSessions`.
    await saveSessions(
      vault,
      both.filter((s) => s.id !== "s1")
    );
    const after = await loadSessions(vault);
    expect(after.map((s) => s.id)).toEqual(["s2"]);
  });

  test("a vault that refuses to write is reported, not thrown", async () => {
    // The server must keep serving its in-memory session rather than refusing to
    // start, or failing every sign-in, over a convenience write.
    const hostile: Secrets = {
      get: () => Promise.resolve(null),
      set: () => Promise.reject(new Error("access denied")),
      delete: () => Promise.resolve(false),
    };
    expect(await saveSessions(hostile, [SESSION])).toContain("could not write");
  });
});
