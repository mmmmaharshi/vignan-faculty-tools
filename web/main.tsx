import "./fonts.css";
import "@mantine/core/styles.css";
import { createTheme, MantineProvider } from "@mantine/core";
import React from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Route, Routes } from "react-router";
import { SWRConfig } from "swr";

import App from "./App";

if (import.meta.env.DEV) void import("react-grab");

/** The service worker caches the app shell and nothing else — and only in
 *  production builds. Registering it in dev would serve yesterday's bundle
 *  while the source moved on, which is the stale-server failure in a new
 *  shape. See web/public/sw.js for what it may and may not cache. */
/** Best-effort: without a worker this stays an ordinary web app. */
async function registerWorker(): Promise<void> {
  try {
    await navigator.serviceWorker.register("/sw.js");
  } catch {
    // Registration failed; the app works uninstalled.
  }
}
if (import.meta.env.PROD && "serviceWorker" in navigator) {
  void registerWorker();
}

const theme = createTheme({
  fontFamily: '"Scoutie Sans Variable", sans-serif',
});
const root = document.querySelector("#root");
if (!root) throw new Error("web/index.html has no #root element to mount into");
createRoot(root).render(
  <React.StrictMode>
    <MantineProvider theme={theme} defaultColorScheme="light">
      <BrowserRouter>
        {/* A read is something the user asked for: no focus or reconnect
            revalidation, no retries, and no dedupe window — a key that comes
            back is a new ask. Hooks keep only what differs. */}
        <SWRConfig
          value={{
            revalidateOnFocus: false,
            revalidateOnReconnect: false,
            shouldRetryOnError: false,
            dedupingInterval: 0,
          }}
        >
          <Routes>
            <Route path="*" element={<App />} />
          </Routes>
        </SWRConfig>
      </BrowserRouter>
    </MantineProvider>
  </React.StrictMode>
);
