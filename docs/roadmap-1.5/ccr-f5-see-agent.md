# CCR: F5 backend — see what the agent does: the agent browser, emulation, the Android mirror (1.5.0)

Owner: BACKEND. Status: frozen tests for review (M5: HML tests, DESIGN shapes, FE renderer; SECURITY: TECH LEAD).

**Criteria:** A49, A50, A51 and A52 (B1–B3). F5 depends on F3.

**Contract:** DESIGN's `.claude/roadmap-1.4/team/plans/1.5.0-f5-design.md`, section "Data each screen needs". FRONTEND's renderer-facing names were agreed on 08/11 (see §Contract).

**Frozen tests:** `tests/acceptance/f5/`: 35 tests in 5 files.

**Tasks:** `.claude/roadmap-1.4/team/plans/f5-tasks-BACKEND.json`: 5 tasks with the pack fields.

**Rigor:** pure or injected modules only, tested against real code: CDP-shaped fixtures, a fake `webContents.debugger`, a fake adb runner, and the real tool registry and MCP coverage. There is no browser, device, emulator or network in a test.

## A49 · Who may act on the page (SECURITY)

**`PreviewGrants.authorize({ previewSessionId, url, action, target?, ask })`**
- **Loopback** (the existing `classifyPreviewUrl` rule) asks once per `(previewSessionId, origin)`, with scope `session`.
- **Any other origin** asks on every action, with scope `action`, and keeps nothing.
- **Navigating from local to external** always asks.
- **A denial** grants nothing.
- **Reads** never ask.
- **Refused outright:** credential URLs and non-http(s) schemes.
- **Lookalikes** are external (`localhost.evil.example`, `127.0.0.1.nip.io`, `0.0.0.0`).
- `revoke(previewSessionId)` is the window's End.

**Wiring:** `PreviewAutomation.run` calls `authorize` before click, fill, navigate and scroll, with the existing approval broker as `ask`.

**Step pills:** `previewStep` turns an action into a pill: the path for a navigate, the label for a click, the label and value for a fill. A password value shows as `••••`; any other value is redacted and cut to 80 characters.

## A50 · Console and Network (SECURITY)

- **`consoleRow`:** level, the message (redacted, at most 500 characters), the source with query values masked, and the line.
- **`NetworkLog`:** method, URL (userinfo dropped, query values masked as `•••`, keys kept), status, type and ms, keeping the newest 200. It never holds a header, a post body or a response body.

## A51 · Emulation and the broker

- **`PREVIEW_DEVICES`** (`shared/`): Desktop, Pixel 8, iPhone 15, Galaxy S23 and iPad mini.
- **`emulationFor(device, rotated)`** gives the `enableDeviceEmulation` parameters plus the user agent and touch.
- **`DebuggerBroker`** reference-counts the debugger:
  - one attach, detached only by the last release;
  - capture works while emulation holds the debugger;
  - capture is refused with `preview.capture.devtools` while DevTools is open, without attaching;
  - someone else's attach gives `preview.capture.busy`, and the broker stays usable.

## A52 · The Android mirror (SECURITY)

**`AndroidDevices({ run })`** drives the user's own adb. Nothing is bundled or downloaded.
- The device list reports `adb: missing` when there is no adb, and each device's name, kind, API and state.
- Every call is an argument array, never a shell, with `-s <serial>`.
- An option-like serial is refused before adb runs.
- `mapTap` maps a point on the scaled canvas to a device pixel.

**`AndroidAgentAccess`:**
- "Agents can see" is off by default, per device.
- A screenshot is refused without asking while it is off.
- When it is on, the first screenshot asks once per agent session and device.
- A denial captures nothing, and switching it off revokes at once.

**The agent tool:** `oxespace_device_screenshot` is a read tool, and its schema has no input fields. No tool can send input to a device.

## Contract (agreed with FRONTEND)

**The agent browser** rides on the existing `browserPreview` API.
- New invoke channels: `revokeGrant({ ownerKey, tabId })` and `setDevice({ ownerKey, tabId, deviceId | null, rotated })`.
- New event types on `browser-preview:event` (`onEvent`), each carrying `ownerKey` and `tabId`:
  - `grant`;
  - `agent-action` (`phase` before or after, an `action` from `previewStep`, plus `id` and `at`, and `result`);
  - `console` (`{ row, at }`);
  - `network` (`{ row, at }`);
  - `broker` (`{ attached, devToolsOpen }`).

**Android:** `IPC_CHANNELS.android` = `{ status, changed, connect, disconnect, frame, tap, swipe, key, rotate, screenshot, setAgentsCanSee, startEmulator }`.
- Arguments are objects that carry `serial`.
- Input is in device pixels.

**MCP coverage**
- `android.*` is forbidden.
- `browserPreview.revokeGrant` is forbidden.
- `browserPreview.setDevice` joins the Web Preview capability, with no tool.

**C3 codes:** `preview.capture.devtools` and `preview.capture.busy`.

## SECURITY (TECH LEAD)

The review surface:
- the grant scope (session vs action);
- localhost → external navigation;
- the masked drawers;
- the Android switch off by default;
- adb argument handling;
- no agent input path.

Each one has a refusal or masking test.
