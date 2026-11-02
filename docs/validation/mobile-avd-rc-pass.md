# Phone RC pass on an emulator (G5, decision 10)

How MOBILE and HOMOLOGATION run the release candidate's phone flows (M1–M6 of
[the RC checklist](../design/rc-checklist-1.4.md)) on the `oxespace-test` emulator, paired with the desktop over the
machine's own network. **The pass runs only after the user's OK on decision 10.** Until then this is the plan, and
nobody starts the emulator for it.

## Memory and the lock

The emulator is the heaviest thing the team runs on this machine. Measured on 2026-11-01, qemu took about 3 GB even
with `-memory 1536`.

- **The machine-wide heavy lock**, held for the whole pass. Nothing else heavy runs alongside: no Gradle, no vitest, no
  E2E, no packaging.
- **Free memory before booting.** At least 4 GB free: about 3 GB for qemu plus the team's 1 GB floor. If it drops under
  1 GB during the pass, MOBILE stops at the next step boundary, shuts the emulator down and reports.
- **Fixed emulator options.** `-memory 1536 -no-snapshot-load -no-snapshot-save -no-window -no-audio -no-boot-anim
  -gpu swiftshader_indirect`. No snapshots, so nothing from a previous run carries over.
- **Foreground only.** Each phase is one foreground call that ends by shutting the emulator down (`adb emu kill`), even
  on failure. Never a background shell.
- **AVD.** Only `oxespace-test`. Never `Medium_Phone_API_36.0`, which belongs to the user.
- **Telling HOMOLOGATION.** MOBILE sends HOMOLOGATION "emulador: vou usar" before the first phase and "emulador: livre"
  after the last.

## Who does what

| | MOBILE | HOMOLOGATION |
|---|---|---|
| Desktop | — | runs the RC build under test, with a clean profile, and pairs from Settings › Devices |
| Phone | installs the debug APK from the RC commit, drives the emulator with `adb`, takes the evidence | picks the scenario order, checks each expected result, writes the report |
| Report | the screenshots, UI dumps and logcat for each step | the PASS/FAIL table in `docs/validation/homologacao-1.4.md` |

## The file protocol

Neither session can message the other in the middle of a call, so a phase hands over through files in a shared
folder, `RC_ROOT`, one per pass. Each file is written once and never edited.

1. `avd-ready`: MOBILE has booted the emulator and installed the app. The file holds the options used.
2. `pair-link.txt`: HOMOLOGATION has opened pairing on the desktop. The file holds the `oxespace://pair?…` link the QR
   encodes, copied from the desktop's "copy link" or decoded from the QR.
3. `phone-code.txt`: MOBILE has delivered the link and read the 6-character verification code the phone shows.
4. HOMOLOGATION compares that code with the desktop's and accepts there.
5. `done`: MOBILE has seen the phone connected and saved the evidence.

A step waits at most 6 minutes for the file before it. When that runs out, MOBILE writes `fail.txt` with the step
that didn't arrive, shuts the emulator down and reports.

**Delivering the link without a camera.** An emulator can't scan a QR from another screen. A debug build accepts the
same link as an extra:

```sh
adb shell am start -n com.oxespace.mobile/.MainActivity --es pair_link "$(cat "$RC_ROOT/pair-link.txt")" --ez allow_capture true
```

The link goes through exactly the checks of a scanned code: a private address, the certificate fingerprint and a
one-time code. A release build ignores the extra (`ReleaseSmokeTest`).

`allow_capture` lets this pass take screenshots of the screens that normally block them. Step 10.9 of
[mobile-1.4.md](mobile-1.4.md) checks that blocking separately, without the extra.

## Scenarios

| # | Area | On the emulator | Not possible here (covered elsewhere) |
|---|---|---|---|
| M1 | Pairing | the pairing link; an expired code (wait 2 min); a used code (deliver the same link twice); 5 devices (pair, then fill to 5 on the desktop); the reserved phone name (rename the emulator to "OXESpace" in Settings › About, then back) | camera denied, and another device answering on the address (unit tests, and the real-phone script in mobile-1.4.md) |
| M2 | Home and tabs | connecting, connected; offline (desktop's phone connection turned off): its action isn't just Unpair | — |
| M3 | Agents (S7.4) | out of 1.4.0: the Agents tab ships in 1.4.1 | — |
| M4 | Request screen | an agent request from the desktop's test agent, not a live paid run: approve, deny with a reason, let it expire. Risk badge and Deny first on a risky request. A truncated request offers only Deny | biometrics: the emulator's fingerprint is `adb -e emu finger touch 1` after enrolling one in Settings. If enrolling isn't possible on the image, the screen lock PIN is used |
| M5 | Live terminal and conversation | send a line, Orientar, stop the turn (with its confirmation); several lines ask first | the FLAG_SECURE check needs no `allow_capture` (10.9) |
| M6 | Notifications | a needs-you notification opens the request in one tap | — |

No step starts a paid Claude or Codex run. A request comes from the desktop's own test path, or HOMOLOGATION triggers it
with an agent the user already approved for this.

## Evidence

The evidence goes to `e2e/screenshots/mobile-homologation/<date>/rc/<step>/`, which git ignores:

- a screenshot and a `uiautomator` dump after each action;
- `logcat -s OxeSpace:* AndroidRuntime:E` at the end of each phase.

They can show paths, command lines or tokens, so they never go into an issue or PR unredacted.

## What the user decides (decision 10)

- **Whether to run the pass on this machine at all.** It needs about 4 GB free and the heavy lock for each phase, which
  takes roughly 10–15 minutes.
- **Or the alternative:** the same scenarios on a real phone on the same Wi-Fi, with the user holding it. No emulator
  memory is needed, and camera, biometrics and Recents are tested for real.

The instrumented tests already run on CI's emulator through the "Android emulator" workflow. That covers what doesn't
need a desktop: Keystore, pinned TLS, the session, FLAG_SECURE, the app's language and notification taps. This pass
adds the parts that need the real desktop.
