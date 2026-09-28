import "@fontsource-variable/scoutie-sans";
import "@mantine/core/styles.css";
import { createTheme, MantineProvider } from "@mantine/core";
import React from "react";
import { createRoot } from "react-dom/client";

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

createRoot(root).render(
  <React.StrictMode>
    {/* Stock Mantine theme, plus the font family. See the note above. */}
    <MantineProvider theme={theme} defaultColorScheme="light">
      <App />
    </MantineProvider>
  </React.StrictMode>
);
