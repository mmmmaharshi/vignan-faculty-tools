/**
 * Offers an installed service worker update through the native confirm
 * dialog, and reloads onto it when the user says yes. Plain `window.confirm`
 * on purpose: the app is Mantine-only with no custom dialog chrome, and an
 * update prompt is one blocking question, not a screen.
 *
 * The worker itself already `skipWaiting` at install (see web/public/sw.js),
 * so by the time `installed` fires the new shell is active — the reload is
 * what puts the running page onto it. No controller means a first install,
 * which offers nothing.
 */
export type UpdateWorker = {
  readonly state: string;
  addEventListener: (type: "statechange", listener: () => void) => void;
};

export type UpdateRegistration = {
  readonly installing: UpdateWorker | null;
  readonly waiting: unknown;
  addEventListener: (type: "updatefound", listener: () => void) => void;
};

export function watchForUpdates(
  registration: UpdateRegistration,
  hooks: {
    hasController: () => boolean;
    confirmUpdate: () => boolean;
    applyUpdate: () => void;
  }
): void {
  const offerIfInstalled = (worker: UpdateWorker): void => {
    worker.addEventListener("statechange", () => {
      if (worker.state !== "installed" || !hooks.hasController()) return;
      if (hooks.confirmUpdate()) hooks.applyUpdate();
    });
  };
  // An update that finished downloading while the page was already open.
  if (registration.waiting && hooks.hasController()) {
    if (hooks.confirmUpdate()) hooks.applyUpdate();
    return;
  }
  registration.addEventListener("updatefound", () => {
    const worker = registration.installing;
    if (worker) offerIfInstalled(worker);
  });
}
