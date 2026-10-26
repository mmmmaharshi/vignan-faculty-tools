/** How many periods an ECAP day holds. The timetable and the pending-postings
 *  boxes both name every slot of this length, so the count lives once. */
export const PERIOD_COUNT = 7;
export const PERIODS: readonly string[] = Array.from(
  { length: PERIOD_COUNT },
  (_, index) => String(index + 1)
);
