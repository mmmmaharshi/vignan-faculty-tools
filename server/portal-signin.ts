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
