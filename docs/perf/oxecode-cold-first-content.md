# OxeCode cold first content: where it starts (OXE-331)

`e2e/perceived-perf.spec.ts` measures, for every surface, the time from the click that opens it to its first content
(`CODE_COLD` for OxeCode's first open in a session). The gate compares it to a per-OS baseline (`PLATFORM_COLD_BASELINE_MS`)
with the spec's tolerance; for OxeCode the Linux baseline is 52 ms (limit 68.7 ms).

**Since OXE-331, the first run stays at Step 2 after Launch; OxeCode's cold first content is measured from the footer
OxeCode.**

- Before OXE-331, the wizard's Launch made the workspace and switched to OxeCode in one step, so `CODE_COLD` started on
  the Launch button.
- With OXE-331, a workspace made from the first run's Step 1 keeps the first run on screen at Step 2. OxeCode opens when
  the person clicks the first run's footer "OxeCode". That click is now `CODE_COLD`'s start point. The Launch (making the
  workspace) happens before the measurement, as setup.
- The perceived-perf launch keeps the first run on screen (`OXESPACE_E2E_FIRST_RUN=stay`), so the e2e harness does not
  click the footer on its own (`e2e/electron-main.cjs`).
- **The baseline value did not change; only the start point moved.** The limit stays at 68.7 ms.
- While the first run waits at Step 2, the app preloads OxeCode's view at idle (`src/app/useFirstRunLaunch.ts`), so the
  footer opens it without loading its chunk on the click.

This is a series break for `OxeCode (Code) cold` only: samples before OXE-331 measured Launch → grid; samples after it
measure footer OxeCode → grid. Compare trends across OXE-331 with that in mind.
