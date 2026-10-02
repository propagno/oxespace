# Web Preview Windows validation — 2026-10-01

The native `WebContentsView` preview was verified in Electron development and in the Windows packaged executable. The package smoke launched `dist/win-unpacked/OXESpace.exe` with `app.isPackaged === true`; it did not install the generated NSIS installer. This machine already has registered OXESpace installations, so an NSIS install here could replace an existing uninstall entry or shortcut. An isolated Windows VM is needed to validate those installer side effects.

## Flows verified

- Code preview: open local page, inspect and capture through the authorized MCP path, tab switching, native history, failure and Retry, focus and bounds after resize, native guest teardown on collapse.
- Consent: agent access denied by default and after panel reopen or app restart; pending click rejected after access revocation; external URL blocked until `External` is enabled, and guest removed when it is disabled.
- Scope: Code and Thread owners do not cross; the Thread preview uses the Thread owner and a separate native view.
- Packaged executable: boot to interactive, create workspace and native terminal, open four local pages, then close the panel and release all four browser guests.

## Measurements

Five development runs and five packaged runs on this Windows host. Values are observations, not universal performance claims. Electron `app.getAppMetrics()` reports working-set memory across all OXESpace processes; the delta isolates the cost of the preview more usefully than the absolute value.

| Scenario | Boot to interactive | Open panel | Four tabs: additional working set | After close: residual working set | Guest/process lifecycle |
| --- | ---: | ---: | ---: | ---: | --- |
| Development E2E | 1.38–2.18 s | 0.97–1.07 s | 376–385 MB | 19–27 MB | 0 → 4 → 0 guests; 4 → 8 → 4 processes |
| Packaged Windows | 6.95–7.67 s | not separately measured | 389–397 MB | 20–29 MB | 0 → 4 → 0 guests; 4 → 8 → 4 processes |

Development tab-load p95 across four local tabs was 179–485 ms in these runs. The automated development budget is panel <5 s, tab-load p95 <3 s, four-tab delta <600 MB and post-close residual <128 MB with process count returning to baseline. The packaged Windows smoke keeps its pre-existing 15 s boot budget and now gates four-tab delta <600 MB, post-close residual <160 MB, and process count returning to baseline.

## Commands

- `npm run typecheck`
- `npm run build`
- `npx playwright test e2e/documentation-preview.spec.ts e2e/design-mode.spec.ts e2e/thread-view.spec.ts e2e/browser-preview-restart.spec.ts --workers=1`
- `npm run bench:web-preview`
- `npm run dist:win`
- `OXESPACE_PACKAGED_EXECUTABLE=dist/win-unpacked/OXESpace.exe npx playwright test --config playwright.tools.config.ts e2e/packaged-win.spec.ts --workers=1` (environment variable syntax adjusted for PowerShell)

Linux packaged visual/performance certification remains separate. This validation does not claim that the NSIS installation workflow was exercised.
