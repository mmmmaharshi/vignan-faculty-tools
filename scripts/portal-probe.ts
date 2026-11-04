/**
 * One Portal call, measured — not guessed.
 *
 * Reaching ECAP by hand means re-writing sign-in, the cookie jar, a jQuery call
 * and a proxy call every time, and getting one of them wrong looks like "no
 * data". This script is that scaffold once:
 *
 *   ECAP_USER=… ECAP_PASS=… bun scripts/portal-probe.ts [method]
 *
 * With no method it prints **every method the signed-in account may call**, with
 * the parameter names the proxy declares — the only place the contract exists.
 * With a method it prints that method's declaration, and for the register family
 * also one real reply's table geometry.
 *
 * Read-only. It never prints the password, the cookies, a student's name or a
 * roll number; credentials come from the environment so they never reach the
 * repo.
 */
import {
  absorbResponse,
  CookieJar,
  jqBody,
  nextHop,
  portalEncrypt,
  webMethodBody,
} from "../server/portal-conventions";
import { hiddenValue, unquoteJs } from "../server/portal-replies";

const BASE = "https://webprosindia.com";
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/152.0.0.0 Safari/537.36";
const JQ = `${BASE}/vignanit/jqmethods.aspx`;
const LOGIN_PAGE = `${BASE}/vignanit/main.aspx`;
const LOGIN_POST = `${BASE}/vignanit/Default.aspx?ReturnUrl=%2fvignanit%2fmain.aspx`;
const REGISTER_PAGE_URL = `${BASE}/vignanit/ACADEMICS/AcademicRegister.aspx?scrid=335`;
const REGISTER_PROXY = `${BASE}/vignanit/ajax/Academics_AcademicRegister,App_Web_academicregister.aspx.a2a1b31c.ashx`;

const userId = process.env.ECAP_USER ?? "";
const password = process.env.ECAP_PASS ?? "";
if (!userId || !password) {
  console.error(
    "Set ECAP_USER and ECAP_PASS. They are never printed or stored."
  );
  process.exit(1);
}

const jar = new CookieJar();

/** One request through the jar, following redirects by hand: `Bun.fetch` drops
 *  `Set-Cookie`, so the auth cookie would vanish mid-flow. */
async function request(url: string, init: RequestInit = {}): Promise<Response> {
  const send = (target: string): Promise<Response> => {
    const cookie = jar.header();
    return fetch(target, {
      ...init,
      headers: {
        ...(init.headers as Record<string, string>),
        ...(cookie ? { cookie } : {}),
      },
      redirect: "manual",
      signal: AbortSignal.timeout(60_000),
    });
  };
  let target = url;
  let res = await send(target);
  absorbResponse(jar, res);
  for (let hops = 0; hops < 6; hops++) {
    const next = nextHop(res, target, 6 - hops);
    if (!next) break;
    target = next;
    res = await send(target);
    absorbResponse(jar, res);
  }
  return res;
}

async function signIn(): Promise<void> {
  const page = await request(LOGIN_PAGE);
  const html = await page.text();
  const cipher = portalEncrypt(password);
  const login = await request(LOGIN_POST, {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      referer: LOGIN_PAGE,
      origin: BASE,
      "user-agent": UA,
    },
    body: new URLSearchParams({
      __VIEWSTATE: hiddenValue(html, "__VIEWSTATE"),
      __VIEWSTATEGENERATOR: hiddenValue(html, "__VIEWSTATEGENERATOR"),
      __EVENTVALIDATION: hiddenValue(html, "__EVENTVALIDATION"),
      txtId1: userId,
      txtPwd1: cipher,
      hdnpwd1: cipher,
      "imgBtn1.x": "12",
      "imgBtn1.y": "12",
    }),
  });
  await login.text();
  if (!jar.signedIn) {
    console.error("Sign-in failed; check the credentials.");
    process.exit(1);
  }
}

/** The jQuery convention: a JS-object body on `jqmethods.aspx`. */
export async function jq(
  method: string,
  data: Record<string, string | number | boolean>
): Promise<unknown> {
  const res = await request(`${JQ}/${method}`, {
    method: "POST",
    headers: {
      "content-type": "application/json; charset=utf-8",
      referer: REGISTER_PAGE_URL,
      "x-requested-with": "XMLHttpRequest",
      "user-agent": UA,
    },
    body: jqBody(data),
  });
  const parsed = JSON.parse(await res.text()) as {
    d?: unknown;
    error?: string;
  };
  if (parsed.error) throw new Error(`${method}: ${parsed.error}`);
  return parsed.d;
}

/** The generated-proxy convention, against the register family's proxy. */
export async function webMethod(
  name: string,
  pairs: [string, string | number][],
  session = "no"
): Promise<string> {
  const res = await request(
    `${REGISTER_PROXY}?_method=${name}&_session=${session}`,
    {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        referer: REGISTER_PAGE_URL,
        "user-agent": UA,
      },
      body: webMethodBody(pairs),
    }
  );
  const text = await res.text();
  if (!res.ok)
    throw new Error(`${name}: HTTP ${res.status} ${text.slice(0, 200)}`);
  return text;
}

/** Every `<option value>` in a reply, without assuming it is wrapped in a select. */
export function optionsIn(reply: string): { value: string; label: string }[] {
  const html = unquoteJs(reply);
  return [
    ...html.matchAll(
      /<option[^>]*value=["'](?<value>[^"']*)["'][^>]*>(?<label>[\s\S]*?)<\/option>/gi
    ),
  ].map((m) => ({
    value: m.groups?.value ?? "",
    label: (m.groups?.label ?? "").trim(),
  }));
}

/** Every table in a reply: header and body rows as plain text cells. */
export function tables(html: string): string[][][] {
  return [...html.matchAll(/<table[\s\S]*?<\/table>/gi)].map((m) =>
    [...m[0].matchAll(/<tr[\s\S]*?<\/tr>/gi)].map((r) =>
      [...r[0].matchAll(/<t[dh][^>]*>(?<cell>[\s\S]*?)<\/t[dh]>/gi)].map((c) =>
        (c.groups?.cell ?? "")
          .replaceAll(/<[^>]+>/g, " ")
          .replaceAll("&nbsp;", " ")
          .replaceAll(/\s+/g, " ")
          .trim()
      )
    )
  );
}

await signIn();

const wanted = process.argv[2] ?? "";
const declared = (text: string): { name: string; params: string }[] =>
  [
    ...text.matchAll(
      /(?<name>[A-Za-z_]\w*)\s*:\s*function\((?<params>[^)]*)\)/g
    ),
  ].map((m) => ({
    name: m.groups?.name ?? "",
    params: m.groups?.params ?? "",
  }));

const proxyResponse = await request(REGISTER_PROXY);
const proxy = await proxyResponse.text();
const methods = declared(proxy);
console.log(`signed in; the proxy declares ${methods.length} method(s)\n`);
for (const m of methods.toSorted((a, b) => a.name.localeCompare(b.name))) {
  if (wanted && !m.name.toLowerCase().includes(wanted.toLowerCase())) continue;
  console.log(`${m.name}(${m.params})`);
}

if (wanted) {
  // The dropdowns every register call needs, filled the way the page fills them.
  const liveness = await jq("LoadCourses", {
    controlid: "ddlcourse",
    onchangemethod: "",
    isdefaultall: false,
  });
  console.log("\nLoadCourses answered:", Boolean(liveness));
}
