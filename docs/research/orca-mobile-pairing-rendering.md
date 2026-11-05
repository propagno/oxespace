# Orca mobile: how it pairs and renders the terminal, and what OXESpace takes from it

This study is the gate for 1.4.3. The user asked for it on 04/11: "when he analyses what Orca does to render and implement the pairing correctly, we'll release 1.4.3".

**Sources:**
- Orca (MIT), read only, from the copy the user handed over:
  - phone side: `mobile/src/transport/*`, `mobile/src/terminal/*`, the markdown files under `mobile/*.md`;
  - desktop side: `src/main/ipc/mobile.ts`, `src/main/runtime/{device-registry,windows-mobile-firewall}.ts`, `src/main/daemon/headless-emulator.ts`.
- OXESpace: `origin/main`, plus the open 1.4.3 PRs #620, #622, #625 and #626.

**What we take:** ideas only. Any code we copy carries Orca's MIT notice.

## Why the user's phone failed, in order

1. **No network path.** The Wi-Fi profile was Public and there was no inbound rule. The phone showed its code, but the computer never heard it.
2. **The pairing lapsed.** The phone was saved, but its session only started when Done was tapped. The 2-minute unused-pairing timer then revoked it, and the phone read "OXESpace removed this phone".
3. **A black terminal.** The phone had no terminal emulator. It also got no screen state on subscribe, so a TUI's cursor moves and repaints left only fragments.

Orca has an answer for each of these three.

## 1. Network path and firewall

**What Orca does** (`windows-mobile-firewall.ts`, `WindowsFirewallNotice.tsx`):
- **Checks.** Before pairing, the desktop runs PowerShell to read:
  - the network category of the interface it advertises (`Get-NetConnectionProfile`);
  - whether the Private firewall profile is on;
  - whether an enabled inbound rule covers *this executable* and *this port*, with a wide enough remote scope.
- **Notice.** The pairing screen shows a notice when the network is Public, or when no rule covers the app.
- **Repair.** The notice offers a one-click repair: an elevated child process runs `New-NetFirewallRule`, scoped to Private, TCP, the port, and the program.
- **Re-check.** After the repair the desktop inspects again, and only a verified result reads as success ("could not be verified" otherwise).
- **No address.** If there is no usable LAN address, the offer is refused with guidance. A loopback QR is never shown.

**What we do:** Settings → Devices shows a one-time firewall explanation before the connection first turns on. We never check the profile or the rule, and we can't repair either.

**Gap:** what failed for the user is exactly what Orca detects. We left it to them to diagnose, with my help, over about an hour.

## 2. The pairing lifecycle

**What Orca does** (`device-registry.ts`, `mobile.ts`):
- **The QR is a credential.** It carries a device token plus the desktop's public key (Noise/E2EE). Scanning it is the whole pairing: the phone has no code to read back, and the desktop has no confirm step.
- **Pending entries.** A token with `lastSeenAt === 0` is *pending*:
  - Showing the QR again reuses the same pending token, so no orphan credentials pile up.
  - "Regenerate" (`rotate: true`) throws the pending token away and mints a new one.
  - Pending tokens are listed and can be revoked.
- **Graduation.** A token becomes a real device the first time a phone *connects*. It is never removed by a timer.
- **Path probing.** The phone probes the paths it was given (`racePairingCandidates`, direct vs relay) with a status probe, and keeps the first one that answers. A direct probe gets a 2 s grace period for one redial, and one extension once the peer reaches `handshaking`. A dead LAN fails in about 2 s, not after a long timeout.

**What we do** (`gateway.ts`):
- The phone shows a code, the person confirms it on the computer, and the device is saved.
- A device that hasn't signed in within `UNUSED_PAIRING_TTL_MS` (2 min) is **revoked**. That rule came from SECURITY #458/#476, and it holds across relaunches.
- Before #620, the phone only signed in when Done was tapped. Any delay turned a good pairing into "removed this phone".

**Gap:**
- **The timer.** Our timer is right for security: a saved but unused credential shouldn't live forever. But it hits a person who is still in the middle of the flow.
- **The phone's view.** The phone can't tell "lapsed, pair again" from "you removed me".
- **Probing.** We don't probe before we save, so "couldn't reach your computer" arrives late and with no reason.

## 3. Keeping the session alive

**What Orca does:**
- **Watchdog** (`rpc-session-liveness-watchdog.ts`): when the session is idle it sends a probe every 20 s. Each probe has 8 s to answer, and three misses end the session, which then reconnects. A session is either connected or visibly reconnecting, never half-alive.
- **Issue #5049**, a session that looked alive but ignored taps, had three causes:
  - the reconnect loop gave up after 12 attempts and nothing ever restarted it;
  - there was no foreground listener;
  - stream subscriptions weren't replayed after a reconnect.
- **Fixes:** returning to the foreground restarts the reconnect loop, and active streams are stored and replayed after every reconnect.
- **Diagnostics:** the phone has a connection log screen and a Troubleshoot screen.

**What we do:** MOBILE must confirm three things on our phone:
- whether a lapsed reconnect loop restarts when the app returns to the foreground;
- whether subscriptions are replayed after a reconnect;
- whether a dead socket is ever detected while the app sits idle.

We have no connection log the person can see.

## 4. Terminal rendering

**What Orca does:**
- **One emulator on both sides.**
  - The desktop keeps a headless xterm (`@xterm/headless` plus `@xterm/addon-serialize`) for each terminal.
  - The phone renders with real xterm.js 6 in a WebView, with the webgl and unicode11 addons, so box-drawing, wide characters and the alternate screen behave the same as on the desktop.
- **A snapshot on subscribe.** The first event of `terminal.subscribe` is the serialized screen: ANSI with an absolute cursor, split into a screen part and a scrollback part, plus the cols and rows. After that the live stream follows.
- **Clean snapshots.** The desktop takes a snapshot only after pending writes are applied, so it never captures a half-cleared TUI. A partial escape sequence at the end of a chunk is carried over, so it can't turn into literal text.
- **Two queues.** Messages wait for the WebView's `web-ready`, and writes wait for xterm's `init()`. Without them, the first bytes after opening were lost: that was their own black-screen bug (`terminal-output-streaming-findings.md`).
- **Fit and resize.** The cell box is measured, and the grid is fitted to the phone's width. Columns are never clipped silently.
- **A reproduction script with no phone.** `mobile/scripts/test-subscribe.ts <token> <serverKey>` subscribes from Node and prints what arrives. Their rule: run it *before* debugging on a device.

**What we do:**
- #622 (T97) adds a Kotlin VT emulator on the phone.
- The desktop sends only the live stream. The T98 CCR (#623) specifies a snapshot as rows plus the cursor and alternate state, held for 1.5.0.
- The desktop **already** runs `@xterm/headless` (`agent-state/screen.ts`).

**Gap:**
- **Two emulators.** The desktop (xterm) and the phone (our own VT) are different, so every escape sequence the VT doesn't know is a rendering bug.
- **No snapshot.** Opening a busy terminal shows nothing until the next repaint.
- HML-M1-8 (80 columns clipped) and HML-M1-9 (another pane's prompt) are the same kind of problem.

## Decisions (TECH LEAD)

The rule for 1.4.3: everything below that touches the protocol is **additive and optional**. An old phone ignores a field it doesn't know, and a new phone on an old desktop falls back to today's behaviour.

### In 1.4.3

| # | Change | Owner | From Orca |
|---|---|---|---|
| P1 | **Firewall and network check on the desktop, with a repair.** Windows only. Read the network category of the advertised interface and look for an enabled inbound rule for OXESpace.exe on the gateway port. Settings → Devices shows a warning Notice for Public, and another for "no rule" with a one-click elevated "Allow on private networks" (Private, TCP, the port, the program). Re-check after the repair; it counts as fixed only if verified. A clear message on Public: "this network is Public; Windows blocks phones". The repair never changes the network category itself; it says how to. | BACKEND (service + IPC), FRONTEND (Notice) | `windows-mobile-firewall.ts` |
| P2 | **The phone signs in when the pairing is saved** (#620, T95), plus **the lapse is told apart from a removal** (#626). The 2-minute timer stays (SECURITY #458/#476), but it now only catches a phone that really walked away. | MOBILE/BACKEND: already in the set | lifecycle "graduates on first connect" |
| P3 | **Probe before we save.** After the code is confirmed, the phone makes one status call on the endpoint it was given. It gets 2 s of grace for one redial, extended once if the handshake has started. The pairing is shown as done only after that call answers. Failures land on the existing `unreachable`/`timed-out` states in #622's goldens, with the reason. | MOBILE | `mobile-direct-endpoint-probe.ts` |
| P4 | **A snapshot on subscribe, as serialized ANSI.** T98 moves into 1.4.3 in Orca's form. The desktop adds `@xterm/addon-serialize` to the headless screen it already keeps, and answers a subscribe with an optional `snapshot: { ansi, cols, rows }` before the stream. Pending writes are flushed first, and a partial escape at a chunk's end is carried over. The phone feeds `ansi` into the #622 VT before the live bytes. This replaces the rows shape in the #623 CCR: one parser, no second model. Scrollback is capped at 200 lines. | BACKEND (desktop + protocol, then `android:generate`), MOBILE (feed the VT) | `headless-emulator.ts` `getSnapshot` |
| P5 | **A no-phone repro script.** `scripts/remote-subscribe.mts <deviceToken>` signs in like a phone, subscribes to a terminal, and prints the snapshot and the first frames. It goes into the homologation steps, run before any device pass. | BACKEND | `scripts/test-subscribe.ts` |
| P6 | **Recovering on foreground.** When the app returns to the foreground, a stopped reconnect loop restarts and active terminal and thread subscriptions are replayed. MOBILE first checks which of the two is missing; only the missing part is built. | MOBILE | issue #5049 fixes |

The 1.4.3 set becomes #620, #622, #625 and #626, plus P1, P3, P4, P5 and the P6 part that is missing.

**Why P4 isn't a protocol break:** the field is optional. An old phone ignores it, and a new phone that gets no snapshot behaves as today. This changes the earlier MOB-1-3 decision, which made T98 a 1.5.0 exception. It now ships earlier, in a simpler shape.

### In 1.5.0 (the OXE phone phase)

- **The terminal renderer.** Move the phone terminal to xterm.js in an Android WebView, with the web-ready queue and the init queue. That gives one emulator end to end. It is the lasting fix for box-drawing, wide characters and TUIs, and it removes our VT as a source of bugs. The cost is a WebView and its assets in the APK, so we measure that first. If the 1.4.3 VT plus the snapshot is good enough on the device pass, this stays an option, not a must.
- **A liveness watchdog** (20 s idle probe, 8 s timeout, 3 misses).
- **A connection log, and a Troubleshoot screen on the phone.** These are DESIGN screens in the #627 round.
- **Pending pairings.** Showing a code again reuses the pending one, Regenerate rotates it, and pending entries are listed and revocable on Devices.
- **Fitting the terminal grid** to the phone's width, with a horizontal pan in place of silent clipping (HML-M1-8).

### What we don't take

- **Pairing by QR alone,** with no code shown on the phone and no confirm on the computer. Our code-confirm step is a deliberate security choice (SECURITY_MODEL). It stays.
- **Relay transport.** It is out of scope; the LAN only.
