import { test, expect } from "@playwright/test";

import { watchForUpdates } from "../web/data/sw-update";

/** A fake installing worker the test drives through states by hand. */
const fakeWorker = () => {
  const listeners = new Map<string, (() => void)[]>();
  return {
    state: "installing",
    addEventListener(type: string, listener: () => void): void {
      listeners.set(type, [...(listeners.get(type) ?? []), listener]);
    },
    fire(type: string): void {
      for (const listener of listeners.get(type) ?? []) listener();
    },
  };
};

const fakeRegistration = (worker: ReturnType<typeof fakeWorker>) => {
  const listeners = new Map<string, (() => void)[]>();
  return {
    installing: worker,
    waiting: null,
    addEventListener(type: string, listener: () => void): void {
      listeners.set(type, [...(listeners.get(type) ?? []), listener]);
    },
    fire(type: string): void {
      for (const listener of listeners.get(type) ?? []) listener();
    },
  };
};

test.describe("service worker updates", () => {
  test("an installed update offers a native confirm, and reloads on yes", () => {
    const worker = fakeWorker();
    const registration = fakeRegistration(worker);
    let confirmations = 0;
    let reloads = 0;
    watchForUpdates(registration, {
      hasController: () => true,
      confirmUpdate: () => {
        confirmations += 1;
        return true;
      },
      applyUpdate: () => {
        reloads += 1;
      },
    });
    registration.fire("updatefound");
    worker.state = "installed";
    worker.fire("statechange");
    expect(confirmations).toBe(1);
    expect(reloads).toBe(1);
  });
  test("no controller means a first install, so no prompt", () => {
    const worker = fakeWorker();
    const registration = fakeRegistration(worker);
    let confirmations = 0;
    watchForUpdates(registration, {
      hasController: () => false,
      confirmUpdate: () => {
        confirmations += 1;
        return true;
      },
      applyUpdate: () => {},
    });
    registration.fire("updatefound");
    worker.state = "installed";
    worker.fire("statechange");
    expect(confirmations).toBe(0);
  });
  test("answering no leaves the running app alone", () => {
    const worker = fakeWorker();
    const registration = fakeRegistration(worker);
    let reloads = 0;
    watchForUpdates(registration, {
      hasController: () => true,
      confirmUpdate: () => false,
      applyUpdate: () => {
        reloads += 1;
      },
    });
    registration.fire("updatefound");
    worker.state = "installed";
    worker.fire("statechange");
    expect(reloads).toBe(0);
  });
});
