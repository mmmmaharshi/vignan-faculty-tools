/**
 * Every path the app can name. One module with no JSX, so pure route logic
 * (`route-guard.ts`) and the test harness (which compiles without `--jsx`)
 * can import it. `NavTabs.tsx` re-exports these: the tabs are the only other
 * place the strings appear.
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
