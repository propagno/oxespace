# Web Preview browser control

Goal: the page visible in OXESpace is the same page an authorized agent inspects and operates through MCP. Code and Thread use independent project/session scopes.

## Progress on 2026-10-01

- Stage 1 implemented and verified on Windows Electron. Both screenshot MCP tools now require a live execution and the agent opt-in; both use the same redacting capture. Thread actions bind to `threadId`, Code actions to a live pane. Actual wheel scrolling, tab-change checks, and route fingerprints are covered by the real-guest test.
- Stage 2 is implemented for ephemeral sessions. The visible browser has multiple retained tabs and an in-memory Chromium partition per Code workspace or Thread conversation. MCP returns a stable owner-scoped session ID and tab IDs, and supports `tabs`, `newTab`, `selectTab`, `closeTab`, `status`, `inspect`, `console`, `network`, `click`, `fill`, `navigate`, `wait`, `scroll`, and redacted capture. Console output is summarized without message bodies; network shows bounded resource timings without headers or bodies. The main process owns tab order, active selection, URL, loading/error state, native web contents, opt-in state, visibility and Chromium navigation history. The renderer subscribes to session changes and retains only the address input draft. MCP tab operations act on the main session instead of clicking renderer DOM. Tab state survives panel close/reopen within the app process, while agent access resets. Restart creates a fresh browser session and no previous agent consent is restored; a persistent profile setting remains a separate optional product decision.
- Stage 3 has a native `WebContentsView` host in the main process. Measured bounds and visibility follow the panel, Code/Thread sessions are separate, and Design Mode events and captures route through the main process. The old `<webview>` host is no longer rendered. Windows Electron E2E exercises native guest tabs, Design Mode, Thread embedding, focus, bounds after resize, and teardown. A failed local response shows a recoverable error with Retry. A mount lease prevents stale React cleanup from closing a newer guest. Linux packaged-build validation remains open.
- Stage 4 has Windows Electron coverage for consent, Code/Thread routing, tab lifecycle, private-route binding, redaction, Design Mode, scroll, console and network. On 2026-10-01, the Debian Docker/Xvfb harness passed typecheck, lint, Electron tests, build and the standard E2E smoke, including native Web Preview and Design Mode. Its performance gate failed on an unrelated shell sidebar expansion (665 ms p95 versus 500 ms) while other Docker workloads were running. The same gated shell test passed on Windows after Docker shutdown (40 ms p95 for expansion). This establishes a constrained-container performance issue, not a Linux packaged-build or visual certification; those and browser process/startup measurements remain open.
- Navigation controls now call Chromium back, forward and reload on the native guest. Navigation events drive the address and availability state, including page-initiated links. Bounds updates are coalesced by animation frame and unchanged measurements do not cross IPC. The Windows E2E covers these controls and native guest disposal after the last tab closes.
- The main process now enforces one visible native tab per owner and supplies native tab identity and labels to MCP. The obsolete `<webview>` inspection fallback has been removed. Page-initiated pop-ups are denied; only the explicit UI control opens a URL in the system browser. Windows Electron E2E covers native tab switching and a blocked pop-up.
- The Windows Electron E2E now also covers external URL consent, revocation while a browser action awaits approval, a failed local response and Retry, native focus/bounds/teardown, and ephemeral browser state across app restart. The Windows package was built and `dist/win-unpacked/OXESpace.exe` passed a smoke with a native terminal and four real preview tabs. Three development and three packaged measurements informed relative process and memory budgets; see `docs/audits/web-preview-windows-2026-10-01.md`. The NSIS installer was generated but not installed by this smoke.

## 1. Close existing correctness and consent gaps

- Route every MCP image response through the opt-in, redacting `PreviewAutomation.capture` path. User-initiated clipboard capture remains a local UI action.
- Make scroll a real, bounded browser input. Report dispatch separately from verified page state.
- Require an authenticated live execution for browser MCP tools; resolve Code panes and Thread sessions without falling back to the active Code workspace.
- Test denied opt-in, workspace/thread isolation, redacted pixels, actual scrolling and navigation while approval is pending.

## 2. Model browser sessions explicitly

- One owner-scoped browser session per Code workspace or Thread conversation, with a stable session ID and one or more tabs. Store URL, title, loading/error state, active tab, navigation history and lifecycle in the main process; UI is a subscriber.
- Keep the guest profile isolated and ephemeral by default. Make persistence an explicit user setting, separate from OXESpace authentication.
- Expose bounded MCP operations for list/open/select/close tab, inspect, click, fill, scroll, wait, capture, console and network summaries. Return the exact session/tab identity and a verification-required outcome for mutating actions.
- Keep user consent close to the specific operation and never expose credentials, input values or full raw network bodies by default.

## 3. Integrate a native browser surface

- Replace the renderer-owned `<webview>` with a main-process `WebContentsView` attached to the active panel. Update its bounds from the renderer's measured container and hide it when the owning panel is inactive.
- Use the view's `webContents.debugger` for bounded DevTools inspection, screenshots, console and network metadata; do not expose a general remote debugging port.
- Preserve the existing Design Mode workflow and device-size controls. Verify layout, focus and teardown on Windows and Linux.

## 4. Release gates

- Electron E2E covers Code and Thread ownership, no cross-session control, local and external URL consent, multi-tab navigation, browser restart, capture redaction, console/network, and panel resize/close.
- Packaged Windows and Linux builds run the same smoke flows. Browser process, memory and startup budgets are measured before publishing.
