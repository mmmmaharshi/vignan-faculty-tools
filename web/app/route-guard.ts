import {
  DASHBOARD_PATH,
  HOME_PATH,
  LOGIN_PATH,
  PROFILE_PATH,
  SEARCH_PATH,
} from "./paths";

/**
 * The steady-state redirect, as a pure decision: every redirect once the
 * session is known. The boot effect owns the pre-boot cases (landing screen,
 * deep links, signed-out sends) and runs while this returns null, so the two
 * never compete — the signed-out and unknown-path branches below exist so the
 * decision reads whole, and only the back-button effect acts on them.
 */
export function nextRoute(
  pathname: string,
  session: { booted: boolean; signedIn: boolean }
): string | null {
  if (!session.booted) return null;
  const onLogin = pathname === LOGIN_PATH;
  if (!session.signedIn) return onLogin ? null : LOGIN_PATH;
  if (onLogin) return HOME_PATH;
  if (pathname === "/" || pathname === HOME_PATH || pathname === DASHBOARD_PATH)
    return null;
  if (pathname === PROFILE_PATH || pathname === SEARCH_PATH) return null;
  return HOME_PATH;
}
