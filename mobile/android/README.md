# OXESpace for Android

The phone companion of OXESpace: follow your sessions and answer the Thread from the same Wi-Fi as your computer.
It talks only to the OXESpace gateway on your local network (off by default on the desktop), never to a cloud.
Plan and scope: [docs/roadmap-1.4/mobile.md](../../docs/roadmap-1.4/mobile.md).

## Build

Needs JDK 21 or newer (Paparazzi) and the Android SDK with platform 37 (`platforms;android-37.0`, cmdline-tools 23 or newer). Point Gradle at the SDK with `ANDROID_HOME` or a
`local.properties` file (not versioned):

```properties
sdk.dir=C\:/Users/you/AppData/Local/Android/Sdk
```

Then, from `mobile/android`:

```sh
./gradlew lint verifyPaparazziDebug :protocol:test assembleDebug
```

The debug APK lands in `app/build/outputs/apk/debug/`. CI runs the same command (`.github/workflows/android.yml`).

Instrumented tests (Keystore, pinned TLS, the WSS session) need a device or emulator: `./gradlew connectedDebugAndroidTest`.
On CI they run on request: Actions › Android emulator › Run workflow (`.github/workflows/android-emulator.yml`).

## Screenshots

Every screen has screenshot goldens (Paparazzi, `app/src/test/snapshots`): each state in light and dark, en and
pt-BR, plus large-text (200 %) accessibility snapshots that list what TalkBack reads. After a deliberate visual
change, record them again and review the images in the diff:

```sh
./gradlew :app:recordPaparazziDebug
```

CI runs `verifyPaparazziDebug` and keeps the differences (`app/build/paparazzi/failures`) as an artifact when one
fails. Paparazzi is pinned to 2.0.0-alpha05.1: the 2.0 alphas are the first line that supports AGP 9 (and they need
Java 21); the 1.x releases don't build with AGP 9.

## Releases

Each GitHub release carries a signed APK and its SHA-256; how it's signed, the secrets the maintainer registers once,
and how to verify an APK before installing it are in [RELEASING.md](RELEASING.md).

## What the app never does

Everything in `REMOTE_FORBIDDEN` of `shared/remote/protocol.ts` stays on the desktop: OxeQuery and MCP `confirm`
approvals, provider sign-in and tokens, secrets, MCP trust, policy edits and `host.exec`. The app also keeps its
pairing keys and tokens out of every backup.
