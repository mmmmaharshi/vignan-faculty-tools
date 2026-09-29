# 05: Record the decision and the new Portal convention

**What to build:** The decision behind the feature, and the Portal convention it
needed, are written down where the next agent will find them without scraping
the Portal again. This ticket changes no behaviour. It waits for the code so it
documents what shipped.

**Blocked by:** 02 — An "All subjects" entry in the Cascade; 03 — Overall
statistics in the summary cards; 04 — The overall Attended of held column and the
overall badge.

**Status:** ready-for-agent

- [ ] ADR 0017 records that the overall figures are read from the Portal's own
      declared cells and never recomputed by the app, with the measured evidence:
      across a real section, every student's overall cell agreed with the sum of
      that student's own per-subject columns, and every percentage agreed with
      the Portal's stated formula.
- [ ] ADR 0017 records that recomputation is declined even though it agreed,
      because the Portal's declared cell is the single source of truth and a
      second derivation is a second thing that can drift.
- [ ] ADR 0017 records that the overall attended-of-held cell is not split, and
      points at the glossary rule that forbids it.
- [ ] ADR 0017 notes that the app performs no arithmetic on attendance figures
      anywhere, and that the thresholds are the only numbers the app owns.
- [ ] The glossary gains a term for the Section-wide overall figure, with the
      avoid-list the other entries carry.
- [ ] The glossary's Subject entry is corrected. It currently states there is no
      single average for a Section, which the Portal's Class attendance report
      disproves.
- [ ] The agents' guidance documents the new calling convention: the generated
      proxy it lives behind, and that its parameters are Pascal-cased while the
      page's own JavaScript calls them camel-cased.
- [ ] The agents' guidance warns that the session marker in the query string is
      per method, and that the wrong value returns a bare null-reference error
      rather than an empty result.
- [ ] The agents' guidance warns that reaching this method through the other
      convention returns a generic server error while other methods on the same
      endpoint work fine, and records it as a fourth trap alongside the three
      already listed.
- [ ] The agents' guidance names the Class attendance report as the source of
      overall figures, and records that it honours an arbitrary date range — the
      Portal has no semester start date to give.
