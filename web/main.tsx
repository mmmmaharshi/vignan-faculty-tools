import "@fontsource-variable/scoutie-sans";
import "@mantine/core/styles.css";
import { createTheme, MantineProvider } from "@mantine/core";
import React from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Route, Routes } from "react-router";
import { SWRConfig } from "swr";

import App from "./App";

if (import.meta.env.DEV) void import("react-grab");

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
