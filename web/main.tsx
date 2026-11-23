import "./fonts.css";
// Only the stylesheets the bundle's components need. `styles.css` ships every
// Mantine component's CSS, most of which no screen renders.
import "@mantine/core/styles/baseline.css";
import "@mantine/core/styles/default-css-variables.css";
import "@mantine/core/styles/global.css";
import "@mantine/core/styles/ScrollArea.css";
import "@mantine/core/styles/UnstyledButton.css";
import "@mantine/core/styles/VisuallyHidden.css";
import "@mantine/core/styles/Paper.css";
import "@mantine/core/styles/Popover.css";
import "@mantine/core/styles/CloseButton.css";
import "@mantine/core/styles/Group.css";
import "@mantine/core/styles/Loader.css";
import "@mantine/core/styles/Overlay.css";
import "@mantine/core/styles/ModalBase.css";
import "@mantine/core/styles/Input.css";
import "@mantine/core/styles/InlineInput.css";
import "@mantine/core/styles/ActionIcon.css";
import "@mantine/core/styles/Alert.css";
import "@mantine/core/styles/AppShell.css";
import "@mantine/core/styles/Badge.css";
import "@mantine/core/styles/Button.css";
import "@mantine/core/styles/Card.css";
import "@mantine/core/styles/Center.css";
import "@mantine/core/styles/Checkbox.css";
import "@mantine/core/styles/CheckboxCard.css";
import "@mantine/core/styles/CheckboxIndicator.css";
import "@mantine/core/styles/Combobox.css";
import "@mantine/core/styles/Container.css";
import "@mantine/core/styles/Divider.css";
import "@mantine/core/styles/Drawer.css";
import "@mantine/core/styles/Image.css";
import "@mantine/core/styles/Modal.css";
import "@mantine/core/styles/PasswordInput.css";
import "@mantine/core/styles/Pill.css";
import "@mantine/core/styles/SimpleGrid.css";
import "@mantine/core/styles/Stack.css";
import "@mantine/core/styles/Table.css";
import "@mantine/core/styles/Text.css";
import "@mantine/core/styles/Title.css";
import { createTheme, MantineProvider } from "@mantine/core";
import React from "react";
import { createRoot } from "react-dom/client";
import { SWRConfig } from "swr";

import App from "./app/App";
import { watchForUpdates } from "./data/sw-update";

if (import.meta.env.DEV) {
  void import("react-grab");
}

/** The service worker caches the app shell and nothing else — and only in
 *  production builds. Registering it in dev would serve yesterday's bundle
 *  while the source moved on, which is the stale-server failure in a new
 *  shape. See web/public/sw.js for what it may and may not cache. */
/** Best-effort: without a worker this stays an ordinary web app. */
async function registerWorker(): Promise<void> {
  try {
    const registration = await navigator.serviceWorker.register("/sw.js");
    // A new shell version installed while the app runs: ask natively, and
    // reload onto it on yes. A first install has no controller to update
    // from, so it stays silent.
    watchForUpdates(registration, {
      hasController: () => navigator.serviceWorker.controller !== null,
      confirmUpdate: () =>
        // Native dialog on purpose: one blocking question, and the app
        // holds no custom dialog chrome for it (Mantine-only, no CSS).
        window.confirm(
          "A new version of Vignan Faculty Tools is available. Update now?"
        ),
      applyUpdate: () => window.location.reload(),
    });
  } catch {
    // Registration failed; the app works uninstalled.
  }
}
if (import.meta.env.PROD && "serviceWorker" in navigator) {
  // Registration is not on the path to first paint: the app mounts while the
  // worker installs, so a slow registration cannot hold the screen back.
  // oxlint-disable-next-line unicorn/prefer-top-level-await
  void registerWorker();
}

const theme = createTheme({
  fontFamily: '"Scoutie Sans Variable", sans-serif',
});
const root = document.querySelector("#root");
if (!root) {
  throw new Error("web/index.html has no #root element to mount into");
}
createRoot(root).render(
  <React.StrictMode>
    <MantineProvider theme={theme} defaultColorScheme="light">
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
        <App />
      </SWRConfig>
    </MantineProvider>
  </React.StrictMode>
);
