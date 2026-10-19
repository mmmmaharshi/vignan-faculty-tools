import "@fontsource-variable/scoutie-sans";
import "@mantine/core/styles.css";
import { createTheme, MantineProvider } from "@mantine/core";
import React from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Route, Routes } from "react-router";

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
        <Routes>
          <Route path="*" element={<App />} />
        </Routes>
      </BrowserRouter>
    </MantineProvider>
  </React.StrictMode>
);
