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
