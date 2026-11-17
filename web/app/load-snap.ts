/**
 * The one-shot Register snap, as an armed/consumed decision with one owner.
 *
 * A real load arms it; a hand-typed range edit disarms it; the settle effect
 * consumes it once. One owner keeps a range edit and a finished load from both
 * claiming the snap.
 */
export type LoadSnap = {
  /** A register was really asked for, so its first day may snap From. */
  arm: () => void;
  /** The reader typed a range of their own; no stale reply may overwrite it. */
  disarm: () => void;
  /** Whether this effect run owns the one snap. Consumes it when it does. */
  consume: () => boolean;
};

export function createLoadSnap(): LoadSnap {
  let armed = false;
  return {
    arm: () => {
      armed = true;
    },
    disarm: () => {
      armed = false;
    },
    consume: () => {
      const fire = armed;
      armed = false;
      return fire;
    },
  };
}
