import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import { CookieJar } from "./portal-conventions";

export type StoredSession = {
  id: string;
  at: number;
  userId: string;
  // The ECAP password, kept only so a dead session can be re-established. See
  // ADR 0019. Absent for sessions stored before this existed.
  password?: string;
  cookies: [string, string][];
};
export type Secrets = {
  get: (name: string) => Promise<string | null>;
  set: (name: string, value: string) => Promise<void>;
  delete: (name: string) => Promise<boolean>;
};
export const VAULT_SERVICE = "ecap-attendance-app";
export const VAULT_INDEX = "sessions";
export function sessionKey(id: string): string {
  return `session-${id}`;
}
const DEV_VAULT_FILE = ".dev-sessions.json";
/**
 * A plain-file session store for the dev server, which runs the API inside Vite
 * on Node and so has no `Bun.secrets`. It keeps a dev restart from signing you
 * out, and stays out of production.
 *
 * shortcut: dev-only, plaintext, one file — this writes the portal cookies to
 * disk, which is exactly what the OS vault exists to avoid. Never wire it in
 * where `Bun` is present; use the real vault there.
 */
export function devSecrets(): Secrets {
  const file = process.env.ECAP_DEV_VAULT || DEV_VAULT_FILE;
  const read = (): Record<string, string> => {
    try {
      const parsed: unknown = JSON.parse(readFileSync(file, "utf-8"));
      return parsed !== null && typeof parsed === "object"
        ? (parsed as Record<string, string>)
        : {};
    } catch {
      return {};
    }
  };
  const write = (data: Record<string, string>) => {
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, JSON.stringify(data), { mode: 0o600 });
  };
  return {
    get: (name) => Promise.resolve(read()[name] ?? null),
    set: (name, value) => {
      const data = read();
      data[name] = value;
      write(data);
      return Promise.resolve();
    },
    delete: (name) => {
      const data = read();
      const had = name in data;
      const kept = Object.fromEntries(
        Object.entries(data).filter(([key]) => key !== name)
      );
      write(kept);
      return Promise.resolve(had);
    },
  };
}
export function bunSecrets(): Secrets | null {
  // Dev serves the API from Vite's runtime, which is Node here: no Bun global,
  // so fall back to the plain-file dev store.
  if (typeof Bun === "undefined") return devSecrets();
  const raw = (Bun as unknown as { secrets?: unknown }).secrets as
    | {
        get: (q: { service: string; name: string }) => Promise<string | null>;
        set: (q: {
          service: string;
          name: string;
          value: string;
          persist?: string;
        }) => Promise<unknown>;
        delete: (q: { service: string; name: string }) => Promise<boolean>;
      }
    | undefined;
  if (!raw) return null;
  return {
    get: (name) => raw.get({ service: VAULT_SERVICE, name }),
    set: async (name, value) => {
      await raw.set({ service: VAULT_SERVICE, name, value, persist: "local" });
    },
    delete: (name) => raw.delete({ service: VAULT_SERVICE, name }),
  };
}
export function parseSession(value: unknown): StoredSession | null {
  if (typeof value !== "object" || value === null) return null;
  const { id, at, userId, cookies, password } = value as Partial<StoredSession>;
  if (typeof id !== "string" || !id) return null;
  if (typeof at !== "number" || !Number.isFinite(at)) return null;
  if (!Array.isArray(cookies)) return null;
  const pairs: [string, string][] = [];
  for (const pair of cookies) {
    if (!Array.isArray(pair) || pair.length !== 2) continue;
    const [k, v] = pair as [unknown, unknown];
    if (typeof k !== "string" || typeof v !== "string" || !k) continue;
    pairs.push([k, v]);
  }
  const jar = new CookieJar();
  for (const [name, cookieValue] of pairs) jar.entries.set(name, cookieValue);
  if (!jar.signedIn) return null;
  return {
    id,
    at,
    userId: typeof userId === "string" ? userId : "",
    password: typeof password === "string" ? password : "",
    cookies: pairs,
  };
}
async function readIndex(backend: Secrets): Promise<string[]> {
  let raw: string | null;
  try {
    raw = await backend.get(VAULT_INDEX);
  } catch {
    return [];
  }
  if (!raw) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  return parsed.filter((id): id is string => typeof id === "string" && !!id);
}
function safeParse(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}
export async function loadSessions(backend: Secrets): Promise<StoredSession[]> {
  const ids = await readIndex(backend);
  if (!ids.length) return [];
  const found = await Promise.all(
    ids.map(async (id): Promise<StoredSession | null> => {
      let raw: string | null;
      try {
        raw = await backend.get(sessionKey(id));
      } catch {
        return null;
      }
      const session = parseSession(raw ? safeParse(raw) : null);
      return session && session.id === id ? session : null;
    })
  );
  return found.filter((s): s is StoredSession => s !== null);
}
/**
 * Windows caps one generic credential at `CRED_MAX_CREDENTIAL_BLOB_SIZE` =
 * 5 × 512 = 2560 bytes. Going one entry per session is what keeps a *session*
 * under that cap; the index is still a single credential, so it has the same one,
 * and it grows about 39 bytes a session. Left alone it fills after roughly 65
 * sign-ins inside the 24-hour staleness window, and the write that follows fails
 * with `code 1783` — silently, because the caller only logs it.
 *
 * 2048 keeps the newest sessions and leaves headroom for the brackets and the
 * commas. Past that, the oldest live session is dropped rather than the newest,
 * because the newest is the one that was just used.
 */
export const INDEX_BYTE_BUDGET = 2048;
const byteLength = (value: string): number =>
  new TextEncoder().encode(value).length;
export function withinIndexBudget(
  live: readonly StoredSession[],
  budget: number = INDEX_BYTE_BUDGET
): Set<string> {
  const kept = new Set<string>();
  let used = 2; // the enclosing brackets
  for (const session of live.toSorted((a, b) => b.at - a.at)) {
    const cost = byteLength(JSON.stringify(session.id)) + 1; // plus a comma
    if (used + cost > budget) break;
    used += cost;
    kept.add(session.id);
  }
  return kept;
}
export async function saveSessions(
  backend: Secrets,
  sessions: readonly StoredSession[],
  staleAfterMs = 24 * 60 * 60 * 1000
): Promise<string | null> {
  const now = Date.now();
  const live = sessions.filter((s) => now - s.at <= staleAfterMs);
  const wanted = withinIndexBudget(live);
  const keep = live.filter((s) => wanted.has(s.id));
  const previous = await readIndex(backend);
  for (const session of keep) {
    try {
      await backend.set(sessionKey(session.id), JSON.stringify(session));
    } catch (error) {
      return `could not write the session to the OS vault: ${(error as Error).message}`;
    }
  }
  try {
    await backend.set(VAULT_INDEX, JSON.stringify(keep.map((s) => s.id)));
  } catch (error) {
    return `could not write the session index to the OS vault: ${(error as Error).message}`;
  }
  for (const id of previous) {
    if (wanted.has(id)) continue;
    await backend.delete(sessionKey(id)).catch(() => undefined);
  }
  return null;
}
export function sweep(
  sessions: readonly StoredSession[],
  now: number,
  ttlMs: number
): { kept: StoredSession[]; dropped: number } {
  const kept = sessions.filter((s) => now - s.at <= ttlMs);
  return { kept, dropped: sessions.length - kept.length };
}
