/**
 * Where ECAP's own sign-out lives, measured — not guessed.
 *
 * Our Sign out drops the browser's session but never tells ECAP, so the
 * portal session stays alive server-side and the next sign-in opens a
 * second one. If ECAP keeps only one session per user, the new session's
 * first read 401s and the app bounces straight back to the sign-in form.
 * Ending the portal session inside `/api/logout` removes the lingering
 * first session — but the sign-out control lives on a post-login page, so
 * its address has to be read off an authenticated reply, never guessed:
 *
 *   ECAP_USER=… ECAP_PASS=… bun scripts/portal-logout-link.ts
 *
 * Read-only. It prints sign-out control addresses and form targets from the
 * authenticated shell; never the password, cookies, names, or numbers.
 */
import { CookieJar } from "../server/portal-conventions";
import { signInTo } from "../server/portal-signin";
import { LOGIN_PAGE, portalRequest } from "../server/portal-transport";

const userId = process.env.ECAP_USER ?? "";
const password = process.env.ECAP_PASS ?? "";
if (!userId || !password) {
  console.error(
    "Set ECAP_USER and ECAP_PASS. They are never printed or stored."
  );
  process.exit(1);
}

const jar = new CookieJar();
try {
  await signInTo(jar, userId, password);
} catch (error) {
  console.error(
    `Sign-in failed (${error instanceof Error ? error.message : String(error)}).`
  );
  process.exit(1);
}

// The shell the sign-in lands on: the sign-out control lives here.
const res = await portalRequest(jar, LOGIN_PAGE);
const html = await res.text();
const hits = new Set<string>();
for (const m of html.matchAll(
  /(?:href|action)=["'](?<target>[^"']*(?:logout|signout|logoff)[^"']*)["']/gi
)) {
  if (m.groups?.target) hits.add(m.groups.target);
}
for (const m of html.matchAll(
  /(?<control>__doPostBack\(['"][^'"]*(?:logout|signout|logoff)[^'"]*['"]\)|Logout|SignOut|Sign out)/gi
)) {
  if (m.groups?.control) hits.add(m.groups.control);
}
if (hits.size === 0) {
  console.log("No sign-out control found on the landing shell.");
} else {
  for (const hit of [...hits].toSorted()) console.log(hit);
}
