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
const SESSION: StoredSession = { id: "s1", at: Date.now(), cookies: JAR };
test.describe("the session store", () => {
  test("a session written by one process is readable by the next", async () => {
    const store = new Map<string, string>();
    expect(await saveSessions(fakeVault(store), [SESSION])).toBeNull();
    const loaded = await loadSessions(fakeVault(store));
    expect(loaded).toHaveLength(1);
    expect(loaded[0]?.id).toBe("s1");
    expect(loaded[0]?.cookies).toEqual(JAR);
  });
  test("everything goes in one entry per session, plus an index", async () => {
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
    const cap = 5 * 512;
    const realistic: StoredSession[] = Array.from({ length: 20 }, (_, i) => ({
      id: `session-${i}`,
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
    expect(biggest, "largest single entry").toBeLessThan(cap);
    expect(
      vault.store.get(VAULT_INDEX)?.length ?? 0,
      "the index holds ids only, so it grows at ~39 bytes a session"
    ).toBeLessThan(cap);
    const all = await loadSessions(vault);
    expect(all.length).toBe(20);
  });
  test("a stale session is not rewritten, however often the store is saved", async () => {
    const day = 24 * 60 * 60 * 1000;
    const now = Date.now();
    const vault = fakeVault();
    await saveSessions(vault, [
      { id: "fresh", at: now - 1000, cookies: JAR },
      { id: "ancient", at: now - 30 * day, cookies: JAR },
    ]);
    const after = await loadSessions(vault);
    expect(after.map((s) => s.id)).toEqual(["fresh"]);
    expect(vault.store.has(sessionKey("ancient"))).toBe(false);
  });
  test("a session just inside the cutoff is kept, because it might still work", async () => {
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
    await saveSessions(vault, [{ ...SESSION, id: "s2" }]);
    expect(vault.store.has(sessionKey("s1"))).toBe(false);
    const loaded = await loadSessions(vault);
    expect(loaded.map((s) => s.id)).toEqual(["s2"]);
  });
  test("a failed write leaves the previous index, and its sessions, intact", async () => {
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
    expect(await saveSessions(flaky, [SESSION])).toBeNull();
    const indexBefore = store.get(VAULT_INDEX);
    expect(indexBefore).toBeTruthy();
    failNext = true;
    const written = await saveSessions(flaky, [
      SESSION,
      { ...SESSION, id: "s2" },
    ]);
    expect(written).toContain("could not write");
    expect(store.get(VAULT_INDEX)).toBe(indexBefore);
    const survived = await loadSessions(flaky);
    expect(survived.map((s) => s.id)).toEqual(["s1"]);
  });
  test("a session the index does not name is never loaded", async () => {
    const store = new Map([
      [VAULT_INDEX, JSON.stringify(["s2"])],
      [sessionKey("s1"), JSON.stringify(SESSION)],
      [sessionKey("s2"), JSON.stringify({ ...SESSION, id: "s2" })],
    ]);
    const loaded = await loadSessions(fakeVault(store));
    expect(loaded.map((s) => s.id)).toEqual(["s2"]);
  });
  test("an index naming a missing entry costs that session, not the rest", async () => {
    const store = new Map([
      [VAULT_INDEX, JSON.stringify(["gone", "s2"])],
      [sessionKey("s2"), JSON.stringify({ ...SESSION, id: "s2" })],
    ]);
    const loaded = await loadSessions(fakeVault(store));
    expect(loaded.map((s) => s.id)).toEqual(["s2"]);
  });
  test("an entry filed under the wrong id is not trusted", async () => {
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
    expect(
      parseSession({ id: "s", at: 1, cookies: [["ASP.NET_SessionId", "x"]] })
    ).toBeNull();
    expect(parseSession({ id: "s", at: 1, cookies: [] })).toBeNull();
  });
  test("a malformed cookie pair is dropped, the rest of the jar survives", () => {
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
  test("the set the vault holds is the set that comes back", async () => {
    const vault = fakeVault();
    await saveSessions(vault, [SESSION, { ...SESSION, id: "s2" }]);
    const both = await loadSessions(vault);
    expect(both.map((s) => s.id)).toEqual(["s1", "s2"]);
    await saveSessions(
      vault,
      both.filter((s) => s.id !== "s1")
    );
    const after = await loadSessions(vault);
    expect(after.map((s) => s.id)).toEqual(["s2"]);
  });
  test("a vault that refuses to write is reported, not thrown", async () => {
    const hostile: Secrets = {
      get: () => Promise.resolve(null),
      set: () => Promise.reject(new Error("access denied")),
      delete: () => Promise.resolve(false),
    };
    expect(await saveSessions(hostile, [SESSION])).toContain("could not write");
  });
});
