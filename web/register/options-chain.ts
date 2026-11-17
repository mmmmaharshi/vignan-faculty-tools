/** One pass of the option chain, and the hook that runs it. It lives beside
 *  the cascade because that is what it settles; the fetch layer keeps the path
 *  and knows nothing about levels. */
import { mutate } from "swr";
import useSWRMutation from "swr/mutation";

import type { OptionsReply, OptionsRequest } from "../../shared/api";
import { ApiError, currentEpoch, OPTIONS_PATH, postJson } from "../data/client";
import { runCascade } from "./cascade-run";
import type { CascadeOutcome, CascadeSetup } from "./cascade-run";

/** The generation is part of the key, so a cascade whose options call is still
 *  in flight at Sign-out cannot leave its refusal in the next session's hook. */
export const optionsRunKey = (): string =>
  `${OPTIONS_PATH}#chain#${currentEpoch()}`;
/**
 * One pass of the option chain. Cached under the request it answered, so the
 * same chain run twice — the same saved section opened again — costs no Portal
 * calls. `revalidate: false` because the chain, not the cache, decides what to
 * ask for next.
 */
const optionsFor = async (request: OptionsRequest): Promise<OptionsReply> => {
  const reply = await mutate(
    [OPTIONS_PATH, request, currentEpoch()],
    () => postJson<OptionsReply>(OPTIONS_PATH, request),
    { revalidate: false }
  );
  // A reply that is not options is a failure, the same way a register reply
  // without its roster is: the caller's next pass cannot be built from nothing.
  if (!reply) throw new ApiError(502, "ECAP sent no options for that class.");
  return reply;
};
/** The cascade, as one run: `trigger` settles a selection and answers what the
 *  Portal said, or null when the run was superseded before it settled. */
export function useOptionsChain() {
  return useSWRMutation<CascadeOutcome | null, ApiError, string, CascadeSetup>(
    optionsRunKey(),
    (_key, { arg }) => runCascade(arg, optionsFor)
  );
}
