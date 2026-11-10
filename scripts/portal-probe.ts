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
import { CookieJar } from "../server/portal-conventions";
import { options } from "../server/portal-options";
import { signInTo } from "../server/portal-signin";
import {
  portalJq,
  portalRequest,
  REGISTER_PAGE_URL,
  REGISTER_REMOTE,
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

// The app's own sign-in, so what this script measures is what the app speaks.
try {
  await signInTo(jar, userId, password);
} catch (error) {
  console.error(
    `Sign-in failed (${error instanceof Error ? error.message : String(error)}).`
  );
  process.exit(1);
}

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
