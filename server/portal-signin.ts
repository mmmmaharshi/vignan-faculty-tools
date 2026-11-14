import { HttpError } from "./http-error.js";
import type { CookieJar } from "./portal-conventions.js";
import { portalEncrypt } from "./portal-conventions.js";
import { hiddenValue } from "./portal-html.js";
import {
  BASE,
  HTTP_TIMEOUT_MS,
  LOGIN_PAGE,
  LOGIN_POST,
  portalRequest,
  UA,
} from "./portal-transport.js";
/**
 * One ECAP sign-in: read the login form's view state, post the password as bare
 * ciphertext, and let the jar keep the cookie. Throws the 401 the API answers
 * with when the jar ends up without one, which is the only sign ECAP gives that
 * the credentials were refused.
 *
 * It lives here rather than on the portal class so the probe script measures the
 * same sign-in the app performs — a copy would drift the moment ECAP renames a
 * field, and the probe's whole job is to measure the wire the app speaks.
 */
export async function signInTo(
  jar: CookieJar,
  userId: string,
  password: string
): Promise<void> {
  const page = await fetch(LOGIN_PAGE, {
    headers: { "user-agent": UA },
    signal: AbortSignal.timeout(HTTP_TIMEOUT_MS),
  });
  const html = await page.text();
  const cipher = portalEncrypt(password);
  const res = await portalRequest(jar, LOGIN_POST, {
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
  await res.text();
  if (!jar.signedIn) {
    throw new HttpError(
      401,
      "Sign-in failed. Check your ECAP user name and password."
    );
  }
}
/**
 * ECAP's own sign-out: the landing shell's `lnkLogOut` postback, measured off
 * an authenticated reply (scripts/portal-logout-link.ts) rather than guessed.
 * Dropping the browser's session leaves this one alive server-side, and a
 * second sign-in while it lives comes back dead — its first read 401s and
 * the app bounces to the sign-in form. May throw; the caller treats it as
 * best-effort so a refusal here never fails the browser's own sign-out.
 */
export async function signOutFrom(jar: CookieJar): Promise<void> {
  const page = await portalRequest(jar, LOGIN_PAGE, {
    headers: { "user-agent": UA, referer: LOGIN_PAGE },
  });
  const html = await page.text();
  const body = new URLSearchParams({
    __VIEWSTATE: hiddenValue(html, "__VIEWSTATE"),
    __VIEWSTATEGENERATOR: hiddenValue(html, "__VIEWSTATEGENERATOR"),
    __EVENTVALIDATION: hiddenValue(html, "__EVENTVALIDATION"),
    __EVENTTARGET: "lnkLogOut",
    __EVENTARGUMENT: "",
  });
  await portalRequest(jar, LOGIN_PAGE, {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      referer: LOGIN_PAGE,
      "user-agent": UA,
    },
    body,
  });
}
