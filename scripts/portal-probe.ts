/**
 * One Portal call, measured — not guessed.
 *
 * Reaching ECAP by hand means re-writing sign-in, the cookie jar, a jQuery call
 * and a proxy call every time, and getting one of them wrong looks like "no
 * data". This script reuses the app's own transport, so what it measures is
 * what the app speaks:
 *
 *   ECAP_USER=… ECAP_PASS=… bun scripts/portal-probe.ts [method]
 *
 * With no method it prints **every method the signed-in account may call**, with
 * the parameter names the proxy declares — the only place the contract exists.
 * With a method it prints that method's declaration, and its own reply's shape.
 *
 * Read-only. It never prints the password, the cookies, a student's name or a
 * roll number; credentials come from the environment so they never reach the
 * repo.
 */
import { CookieJar, portalEncrypt } from "../server/portal-conventions";
import { hiddenValue } from "../server/portal-html";
import { options } from "../server/portal-options";
import {
  BASE,
  LOGIN_PAGE,
  LOGIN_POST,
  portalJq,
  portalRequest,
  REGISTER_PAGE_URL,
  REGISTER_REMOTE,
  UA,
} from "../server/portal-transport";

const userId = process.env.ECAP_USER ?? "";
const password = process.env.ECAP_PASS ?? "";
if (!userId || !password) {
  console.error(
    "Set ECAP_USER and ECAP_PASS. They are never printed or stored."
  );
  process.exit(1);
}

const jar = new CookieJar();

/** The same sign-in the server performs, so the cookie jar holds what the app
 *  holds. */
async function signIn(): Promise<void> {
  const page = await portalRequest(jar, LOGIN_PAGE, {
    method: "GET",
    headers: { "user-agent": UA },
  });
  const html = await page.text();
  const cipher = portalEncrypt(password);
  const login = await portalRequest(jar, LOGIN_POST, {
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

const proxyResponse = await portalRequest(jar, REGISTER_REMOTE.proxy);
const proxy = await proxyResponse.text();
const methods = declared(proxy);
console.log(`signed in; the proxy declares ${methods.length} method(s)\n`);
for (const m of methods.toSorted((a, b) => a.name.localeCompare(b.name))) {
  if (wanted && !m.name.toLowerCase().includes(wanted.toLowerCase())) continue;
  console.log(`${m.name}(${m.params})`);
}

if (wanted) {
  // The dropdowns every register call needs, filled the way the page fills them.
  const liveness = await portalJq(jar, REGISTER_PAGE_URL, "LoadCourses", {
    controlid: "ddlcourse",
    onchangemethod: "",
    isdefaultall: false,
  });
  console.log("\nLoadCourses answered:", Boolean(liveness));
  console.log("It offered:", options(liveness));
}
