import "@fontsource-variable/scoutie-sans";
import "@mantine/core/styles.css";
import { createTheme, MantineProvider } from "@mantine/core";
import React from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Navigate, Route, Routes } from "react-router";

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
 * Two routes, and one component behind both.
 *
 * `App` decides what each path means - the guard, the sign-in form, the
 * dashboard - because splitting it into two routed components would either
 * duplicate the cascade's state or put it in a context. The router's job here is
 * narrower and worth stating: the URL is the answer to "which screen", so a
 * refresh, a bookmark and the back button all agree with the screen, and ending
 * a session is a navigation rather than a state change only `App` can see.
 *
 * `/` and `/dashboard` both render `App`, and `App` sends each on to whichever
 * screen the session calls for, so the two are interchangeable ways in. Anything
 * unrecognised lands on `/` for the same reason. A 404 page would be wrong for a
 * two-screen app whose only "pages" are the dashboard and the sign-in form.
 *
 * **These paths must be the ones `DASHBOARD_PATH` and `LOGIN_PATH` name in
 * `App.tsx`.** A dashboard path in one file and not the other is not a broken
 * link, it is a redirect loop: the catch-all sends the unknown path to `/`, the
 * guard sends `/` to `/dashboard`, and the two take turns for ever. It presents
 * as a page that never finishes loading rather than as an error, so it is easy to
 * lose an hour in.
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
          <Route path="/" element={<App />} />
          <Route path="/dashboard" element={<App />} />
          <Route path="/login" element={<App />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
    </MantineProvider>
  </React.StrictMode>
);
