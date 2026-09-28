import "@fontsource-variable/scoutie-sans";
import "@mantine/core/styles.css";
import { createTheme, MantineProvider } from "@mantine/core";
import React from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Route, Routes } from "react-router";

import App from "./App";

/**
 * The one departure from the stock Mantine theme: the typeface.
 *
 * `fontFamily` is the only key set here. Every other decision - spacing, colour,
 * radius, shadows - is Mantine's default, and this file stays the single place
 * that would need to change if that stops being true. The family name is the
 * one the fontsource package declares in its own `@font-face` rules; the import
 * above is what puts those rules and the woff2 files into the build.
 */
const theme = createTheme({
  fontFamily: '"Scoutie Sans Variable", sans-serif',
});

const root = document.querySelector("#root");
if (!root) throw new Error("web/index.html has no #root element to mount into");

/**
 * One catch-all, and one component behind it.
 *
 * `App` decides what each path means — the guard, the sign-in form, the dashboard —
 * because splitting it into routed modules would either duplicate the cascade's
 * state or put it in a context. The router's job here is narrower and worth
 * stating: the URL is the answer to "which screen", so a refresh, a bookmark and
 * the back button all agree with the screen, and ending a session is a navigation
 * rather than a state change only `App` can see.
 *
 * **One catch-all, not a list of paths.** This used to enumerate `/`, `/dashboard`
 * and `/login`, each rendering `App`, with a fourth route redirecting unknown paths
 * to `/`. Every one rendered the same component, so the list carried no behaviour
 * — and it was a *second* statement of which path is the dashboard, with nothing
 * connecting it to `DASHBOARD_PATH` in `App.tsx`. When the two disagreed the result
 * was not a broken link but a **redirect loop**: the unknown path went to `/`, the
 * guard sent `/` to `/dashboard`, and back and forth — measured at 37 navigations
 * and 82 API calls in six seconds. It presents as a page that never finishes
 * loading, so it costs an hour rather than a minute.
 *
 * `App` already decides what every path means, from `pathname === LOGIN_PATH`, so a
 * single catch-all loses nothing and cannot drift. A 404 page would be wrong for a
 * two-screen app whose only "pages" are the dashboard and the sign-in form. If a
 * second screen ever needs its own module, the seam belongs here — but a path that
 * only names `App` does not belong in this file at all.
 *
 * This needs the server to serve index.html for unknown paths, or a deep link
 * 404s before the router ever runs. See the static handling in `server.ts`.
 */
createRoot(root).render(
  <React.StrictMode>
    {/* Stock Mantine theme, plus the font family. See the note above. */}
    <MantineProvider theme={theme} defaultColorScheme="light">
      <BrowserRouter>
        <Routes>
          <Route path="*" element={<App />} />
        </Routes>
      </BrowserRouter>
    </MantineProvider>
  </React.StrictMode>
);
