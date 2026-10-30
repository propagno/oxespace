# OXESpace for Android

The phone companion of OXESpace: follow your sessions and answer the Thread from the same Wi-Fi as your computer.
It talks only to the OXESpace gateway on your local network (off by default on the desktop), never to a cloud.
Plan and scope: [docs/roadmap-1.4/mobile.md](../../docs/roadmap-1.4/mobile.md).

## Build

Needs JDK 17 or newer and the Android SDK with platform 36. Point Gradle at the SDK with `ANDROID_HOME` or a
`local.properties` file (not versioned):

```properties
sdk.dir=C\:/Users/you/AppData/Local/Android/Sdk
```

Then, from `mobile/android`:

```sh
./gradlew lint testDebugUnitTest assembleDebug
```

The debug APK lands in `app/build/outputs/apk/debug/`. CI runs the same command (`.github/workflows/android.yml`).

## What the app never does

Everything in `REMOTE_FORBIDDEN` of `shared/remote/protocol.ts` stays on the desktop: OxeQuery and MCP `confirm`
approvals, provider sign-in and tokens, secrets, MCP trust, policy edits and `host.exec`. The app also keeps its
pairing keys and tokens out of every backup.
