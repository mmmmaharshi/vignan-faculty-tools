import { MantineProvider } from "@mantine/core";
import React from "react";
import { createRoot } from "react-dom/client";

import "@mantine/core/styles.css";
import App from "./App";

const root = document.querySelector("#root");
if (!root) throw new Error("web/index.html has no #root element to mount into");

createRoot(root).render(
  <React.StrictMode>
    {/* Default theme, untouched. All visual style comes from Mantine. */}
    <MantineProvider defaultColorScheme="light">
      <App />
    </MantineProvider>
  </React.StrictMode>
);
