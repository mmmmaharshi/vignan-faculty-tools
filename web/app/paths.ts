/**
 * Every path the app can name, and the two questions asked of them: is this a
 * screen, and which tab does the address bar highlight. One module with no JSX,
 * so the guard, the boot landing and the test harness read the same list as the
 * rail and the bar.
 */
export const LOGIN_PATH = "/login";
export const HOME_PATH = "/home";
export const DASHBOARD_PATH = "/dashboard";
export const PROFILE_PATH = "/profile";
export const SEARCH_PATH = "/search";
/** Every path that is a screen, in tab order. The guard, the tabs and the boot
 *  landing all read this one list: a fifth screen added to the tabs but not
 *  here would be redirected home while its tab was already on the rail. */
export const SCREENS = [
  HOME_PATH,
  DASHBOARD_PATH,
  SEARCH_PATH,
  PROFILE_PATH,
] as const;
export type Screen = (typeof SCREENS)[number];
export const isScreen = (pathname: string): boolean =>
  (SCREENS as readonly string[]).includes(pathname);
/** Which screen the address bar names. Anything else is the register screen:
 *  unknown paths render its body before the guard sends them on, so the
 *  highlight agrees with the screen rather than going dark. */
export const activeTab = (pathname: string): Screen =>
  isScreen(pathname) ? (pathname as Screen) : DASHBOARD_PATH;
