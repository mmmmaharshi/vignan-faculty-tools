import { useSyncExternalStore } from "react";

/** The whole router: the path is history state, read once per render. Five
 *  static paths need no route table, nesting or loaders — only the current
 *  pathname and a way to move it. Back and forward buttons answer through the
 *  native `popstate` they already fire. */
const subscribe = (notify: () => void): (() => void) => {
  window.addEventListener("popstate", notify);
  return () => window.removeEventListener("popstate", notify);
};
const readPath = (): string => window.location.pathname;

/** What `useLocation().pathname` was: the path this render is for. */
export const usePathname = (): string =>
  useSyncExternalStore(subscribe, readPath, () => "/");

/** What `useNavigate()` was: push a history entry, or replace it, then tell
 *  every reader. `pushState` fires no event on its own, so the dispatch is
 *  the half that makes the screen follow the address. */
export const navigateTo = (
  path: string,
  { replace = false }: { replace?: boolean } = {}
): void => {
  if (replace) {
    window.history.replaceState(null, "", path);
  } else {
    window.history.pushState(null, "", path);
  }
  window.dispatchEvent(new PopStateEvent("popstate"));
};
