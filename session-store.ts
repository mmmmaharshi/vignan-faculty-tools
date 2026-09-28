import { CookieJar } from "./portal-conventions";

export type StoredSession = {
  id: string;
  at: number;
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
export function bunSecrets(): Secrets | null {
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
  const { id, at, cookies } = value as Partial<StoredSession>;
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
  return { id, at, cookies: pairs };
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
export async function saveSessions(
  backend: Secrets,
  sessions: readonly StoredSession[],
  staleAfterMs = 24 * 60 * 60 * 1000
): Promise<string | null> {
  const now = Date.now();
  const live = sessions.filter((s) => now - s.at <= staleAfterMs);
  const wanted = new Set(live.map((s) => s.id));
  const previous = await readIndex(backend);
  for (const session of live) {
    try {
      await backend.set(sessionKey(session.id), JSON.stringify(session));
    } catch (error) {
      return `could not write the session to the OS vault: ${(error as Error).message}`;
    }
  }
  try {
    await backend.set(VAULT_INDEX, JSON.stringify([...wanted]));
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
