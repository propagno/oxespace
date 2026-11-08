# CCR (phone phase, 1.5.0): the screens on the approved design, and safe answers

- **Owner:** MOBILE (oxespace-29).
- **Acceptance:** A42 and A44, and the phone side of A67.
- **Phase:** Fase 10, Celular, in `docs/roadmap-1.5/oxe/ROADMAP.md`.
- **Status:** draft. DESIGN reviews the UI, and HML reviews the field question (M10), before any execute.
- **Inputs:**
  - the approved design #627 @ c8ada4a1 (`playground/HANDOFF-MOBILE.md`, `MOBILE-AUDIT.md`, `src/components/Phone.tsx`);
  - `team/plans/1.5.0-mobile-acceptance.md` (MG1–MG10, M1–M8, MX);
  - `team/checklists/phone-parity-1.4.md` (S1–S12, the step counts);
  - the round-1/2 reviews in `team/reviews/1.5-mobile/`.

## Rules for every task here

- **No protocol change.** The only exception is A67's field, which is BACKEND's (see T-P1.6).
- **Safety logic stays where it is.** Only the presentation changes:
  - `RequestResponder`;
  - `BiometricApprovalGate`;
  - `KeystorePresence`;
  - `PairingFlow`;
  - `SessionPairingProbe`;
  - `DesktopSessionController`.
- **Colours come only from `OxeTokens.kt`,** generated from the desktop tokens (MG3). No hex in Compose.
- **Every control is at least 48 × 48 dp** (MG8), and text scales with the system font size (MG7).
- **Goldens:** re-recorded once, at the end of the batch, in en/pt-BR × light/dark.
- **No paid runs.** The emulator runs on CI (`android-emulator.yml`, API 36 and 37).

## Tasks and their exact files

### T-P1.1 Tokens and terminal roles (MG3, MOB-1-4)

- **Files:**
  - `scripts/android/theme-kotlin.mjs`: emit `termAnsi0`…`termAnsi15`, plus `termBg`, `termFg` and `termCursor`, once, from the desktop terminal theme. They're used in both themes.
  - `mobile/android/app/src/main/java/com/oxespace/mobile/ui/theme/OxeTokens.kt`: generated, never hand-edited.
  - `mobile/android/app/src/main/java/com/oxespace/mobile/ui/theme/OxeTheme.kt`.
  - `tests/android-generated.test.ts`: the generator check.
- **Frozen tests:**
  - `OxeColorSchemeTest`: every `termAnsi*` role exists and is the same in light and dark.
  - `tests/android-generated.test.ts`: the generated file matches the tokens.

### T-P1.2 Components (HANDOFF-MOBILE "Components")

- **New files,** in `mobile/android/app/src/main/java/com/oxespace/mobile/ui/components/`:
  - `Notice.kt`: 4 intents, a 32 dp icon tile, title, text, actions;
  - `StatusGlyph.kt`: the 7 states;
  - `ProviderAvatar.kt`;
  - `WorkspaceChip.kt`;
  - `RiskChip.kt`;
  - `OxeButton.kt`: primary, secondary, ghost, danger, 48 dp, 12 dp radius;
  - `CriticalDelayAllow.kt`: a 2 s timer ring, then a tap. It's not a press-and-hold (MOB-1-6);
  - `EmptyState.kt`;
  - `OxeMark.kt`;
  - `PairingStepper.kt`, `CodeBoxes.kt`, `Viewfinder.kt`;
  - `SettingsRow.kt`, including `OxeSwitch` (48 dp target) and `Segmented`.
- **Icons:** `mobile/android/app/src/main/res/drawable/`:
  - `ic_chat.xml`, `ic_code.xml`, `ic_agora.xml`, ported from #606's path data;
  - `ic_wifi.xml`, `ic_wifi_off.xml`, `ic_monitor.xml`, `ic_qr.xml`, `ic_fingerprint.xml`;
  - **delete** `ic_threads.xml`, `ic_terminal.xml` and `ic_tasks.xml`, which are replaced.
- **Frozen tests:**
  - **new** `mobile/android/app/src/test/java/com/oxespace/mobile/ui/components/ComponentsSnapshotTest.kt`:
    - every component in each of its states;
    - `CriticalDelayAllow` at 0, 50 and 100 %;
  - **new** `.../ui/components/CriticalDelayAllowTest.kt`: disabled until 2 000 ms on critical, and enabled at once on
    other risks;
  - `AccessibilitySnapshotTest`, extended: every component meets the 48 dp target and has a label.

### T-P1.3 Home and connection (M1)

- **Files:** `ui/HomeScreen.kt` and `MainActivity.kt` (routing only), plus the strings in `shared/locales/{en,pt-BR}/mobile.json` and `npm run android:generate`.
- **States,** all from the parity list:
  - unpaired, connecting (skeleton), unreachable ("Trying again in N s" with a ring), offline, incompatible;
  - revoked, and **lapsed (T96)** as its own danger Notice;
  - NotAccepted;
  - "Enter the computer's address" under **Can't connect?**.
- **Frozen tests:**
  - `ScreensSnapshotTest.home`: all 8 states;
  - `DesktopSessionControllerTest`: unchanged and still green, which pins S12.

### T-P1.4 Pairing (M2)

- **Files:** `ui/pairing/PairingScreen.kt`, `ui/pairing/QrScanner.kt` and `ui/LocalNetworkAccess.kt` (presentation only), plus the strings.
- **The stepper:** Scan, Reach, Confirm, Done, from the existing `PairingState` with no new state:
  - `Contacting` → Reach;
  - `Waiting` → Confirm;
  - `Paired` → Done;
  - `Failed` → a ✕ on the step it failed at.
- **Confirm's "Cancel pairing" (MOB-1-7):** `PairingFlow.cancel()` cancels the `/pair` call and deletes the key. That's
  the one logic change, and it's covered by a test.
- **Frozen tests:**
  - `ScreensSnapshotTest.pairing`: every 1.4.3 state, plus the stepper at each step;
  - `PairingFlowTest`, new case "cancel during Waiting deletes the key and returns to Scanning";
  - `SessionPairingProbeTest`: unchanged, pins S11.

### T-P1.5 Live, Conversation and Request (M3, M4, M5) with safe answers (A44)

- **Files:**
  - `ui/live/LiveHome.kt`: bottom navigation, Conversations · Needs you · Agents · Terminals · Tasks. The Agents tab's
    content is in CCR phone-agents-steer.
  - `ui/live/ThreadScreen.kt`, `ui/live/Timeline.kt`, `ui/live/RequestScreen.kt`, `ui/live/Risk.kt`.
  - The strings.
- **A44:**
  - **Deny goes through the biometric sheet** ("Deny: <title>"). That's already the logic; this pins the UI.
  - **A truncated request is Deny-only,** with the 1.4 copy and **its own golden.**
  - **A truncated question** gets the "Answer on <computer>" Notice.
  - **"Answer on <computer>"** names no kind (MOB-1-5).
- **Frozen tests:**
  - `ScreensSnapshotTest.requests`: risky, the critical delay at 0 % and 100 %, hidden characters, question, desktop-only,
    gone, risk levels, and **truncated plus truncated-question (new)**;
  - `RequestResponderTest`: unchanged, pins S1, S3 and S5;
  - **new** `.../ui/live/RequestActionsTest.kt`, the actions a request gets:
    - a truncated request offers only Deny;
    - an `answerable: false` request offers none;
    - critical Allow is enabled only after 2 s;
  - `NoFrameWithoutBiometricsTest` (emulator, API 36): extended to Deny, so no frame leaves without the biometric.
  - **Step counts must not grow** (parity checklist):
    - approve is still 4 taps, deny is still 4;
    - `ScreensSnapshotTest` documents the path in the sample;
    - HML checks it on the stand-in phone.

### T-P1.6 Workspace colour chip (A67, phone side)

- **Depends on BACKEND:** an optional `RemoteWorkspace.color?: number` (1–8), plus `android:generate`.
- **Files:** `ui/components/WorkspaceChip.kt` and the generated `RemoteProtocol.kt` (BACKEND's PR).
- **Behaviour:**
  - with `color`, the chip uses `ws-N` and `ws-N-fg`;
  - without it (an older desktop), the neutral chip.
- **Frozen tests:**
  - `ComponentsSnapshotTest`: the chip with colours 1–8, and absent;
  - **new** `.../ui/components/WorkspaceChipTest.kt`: an unknown or out-of-range value reads as neutral.

### T-P1.7 Settings (M8)

- **New file:** `ui/settings/SettingsScreen.kt`, plus a route from the app bar in `LiveHome.kt`.
- **What it holds:**
  - the paired computer card, with Enter the address and Unpair (asks first, MOB-1-9);
  - the Answers rules as information;
  - local notification switches, a preference only;
  - Appearance: System, Light, Dark;
  - the count of terminals that accept typing;
  - About, with licences.
- **Files:** `ui/theme/OxeTheme.kt`, where the theme override reads the preference, and a new
  `.../settings/PhonePreferences.kt` (SharedPreferences `phone-prefs`).
- **Frozen tests:**
  - `ScreensSnapshotTest.settings`;
  - **new** `.../ui/settings/PhonePreferencesTest.kt`: the default theme is System, and a notification switch that's off
    suppresses only that channel's posts (`AlertWatcher` filtered).

## Field question (M10, HML)

- **Network:** these screens show nothing new from the network. HML's stand-in phone (R143) plus
  `scripts/remote-subscribe.mts` drive the pairing, request and conversation paths against a real gateway, on the step
  counts in the parity checklist.
- **On a real phone:** the user's S23 checks that the biometric sheet appears for Deny.

## Out of scope

- The Agents tab content and steer while working: CCR phone-agents-steer.
- The terminal grid and the CLI conversation: CCR phone-terminal.
- Any change to C5, other than A67's field, which is BACKEND's.
