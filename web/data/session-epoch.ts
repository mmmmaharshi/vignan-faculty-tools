/**
 * The session generation, as a value rather than a module-level counter.
 *
 * Every request captures the generation it set out with, and only a response
 * carrying that same generation may slide the session back into storage. That
 * is what stops an answer already in flight across a sign-out from logging the
 * next visit back in.
 *
 * A factory, not a global: the rule is worth testing over generated sequences,
 * and a shared counter would make those tests order-dependent.
 */
export type SessionEpoch = {
  current: () => number;
  /** Drops every generation in flight: nothing captured earlier may slide. */
  bump: () => void;
  /** Whether a request that set out at `seen` may still write the session. */
  admits: (seen: number) => boolean;
};

export function createEpoch(): SessionEpoch {
  let epoch = 0;
  return {
    current: () => epoch,
    bump: () => {
      epoch += 1;
    },
    admits: (seen) => seen === epoch,
  };
}
