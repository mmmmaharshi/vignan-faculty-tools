import { FIRST_PHASE, updateStep } from "./update-lifecycle";
import type { UpdateEvent, UpdatePhase } from "./update-lifecycle";

/**
 * Wires the browser's update events through the lifecycle decision. The native
 * confirm stays here on purpose: the app is Mantine-only with no custom dialog
 * chrome, and an update prompt is one blocking question, not a screen.
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
  let phase: UpdatePhase = FIRST_PHASE;

  const run = (event: UpdateEvent, worker?: UpdateWorker | null): void => {
    const { phase: next, action } = updateStep(phase, event);
    phase = next;
    if (action === "listen") {
      registration.addEventListener("updatefound", () => {
        run({ kind: "updatefound" }, registration.installing);
      });
    } else if (action === "watch" && worker) {
      worker.addEventListener("statechange", () => {
        run({
          kind: "worker-state",
          state: worker.state,
          hasController: hooks.hasController(),
        });
      });
    } else if (action === "offer") {
      run({ kind: "answered", confirmed: hooks.confirmUpdate() });
    } else if (action === "apply") {
      hooks.applyUpdate();
    }
    // "none" has nothing to do.
  };

  run({
    kind: "boot",
    hasController: hooks.hasController(),
    hasWaiting:
      registration.waiting !== null && registration.waiting !== undefined,
  });
}
