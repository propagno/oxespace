# Releasing the Android app

The signed APK is attached to each GitHub release by **`.github/workflows/release.yml`** (the unified Desktop +
Android release workflow triggered by pushing a `vX.Y.Z` tag). It can also be re-run for Android only by hand
(Actions › Release › Run workflow, **Use workflow from** set to the `vX.Y.Z` tag, `target=android-only`; from a branch
it stops at once). It's not on the Play Store.

It keeps two isolated jobs, so the signing key is never near build or test code (`SECURITY #231`):
- **`android-build` (Android build and minified smoke test):** zero secrets, `contents: read`, runs in parallel with
  Desktop verification before approval. It checks out the tag by its full name, builds the unsigned release APK, runs
  lint and unit tests, and executes the minified emulator smoke test (`ReleaseSmokeTest`).
- **`sign-android` (Sign, attest and attach Android APK):** runs in the protected `android-release` environment (which
  enters `waiting` simultaneously with Desktop's `release` environment so both are approved in one modal). In a single
  step it writes the key, signs the APK from `android-build` with `apksigner`, and deletes the key; then it verifies,
  attests, waits briefly for `publish-desktop` to mark the GitHub Release live, and attaches the APK (without `--clobber`).

## One-time setup (maintainer)

The signing key stays out of the repository. Create it once, keep a backup somewhere safe (losing it means phones
can't update the app; they would have to uninstall and pair again), and register four secrets in a protected
environment:

1. Create the key, on your machine (JDK `keytool`):

   ```sh
   keytool -genkeypair -v -keystore oxespace-release.jks -alias oxespace \
     -keyalg RSA -keysize 4096 -validity 10000 \
     -dname "CN=OXESpace, O=OXESpace"
   ```

2. Create the environment: Settings › Environments › New environment, named `android-release`. Then set:
   - **Deployment branches and tags:** "Selected branches and tags", with one rule: tags matching `v*`.
   - **Required reviewers:** yourself. Each release then waits for your OK before the key is used.

   Set these rules **before** adding any secret: the required reviewer is the gate that matters, since anyone who can
   push could create a new `v*` tag. Optionally, also add a tag ruleset (Settings › Rules › Rulesets, target tags
   `v*`) that limits who can create them.

   Only then register the secrets under that environment (Environment secrets), not as repository secrets:

   | Secret | Value |
   |---|---|
   | `ANDROID_KEYSTORE_BASE64` | `base64 -w0 oxespace-release.jks` (on macOS: `base64 -i oxespace-release.jks`) |
   | `ANDROID_KEYSTORE_PASSWORD` | the keystore password |
   | `ANDROID_KEY_ALIAS` | `oxespace` (or the alias you chose) |
   | `ANDROID_KEY_PASSWORD` | the key password |

3. Publish the certificate fingerprint once, in the project README or the first release notes, so people can check
   every later APK against it:

   ```sh
   keytool -list -v -keystore oxespace-release.jks -alias oxespace | grep "SHA256:"
   ```

   Published in the 1.4.0 release notes ("Verify the Android APK"): `CC:65:D9:0A:FA:2F:DE:65:18:AD:AD:92:D4:07:69:49:6A:04:3B:90:1F:60:3E:FF:05:62:E0:56:CD:43:36:E4`
   (`apksigner` prints it as `cc65d90afa2fde6518adad92d40769496a043b901f603eff0562e056cd4336e4`).

Without the secrets, the signing job stops at its first step and names the ones missing; nothing is published. If
older repository secrets with these names exist, delete them once the environment holds them.

Also check, once:
- Settings › Actions › General › Workflow permissions lets a job ask for write access (the default "Read repository
  contents" setting still allows the job's own `contents: write`; an organization policy that forbids it doesn't).
- Only tags that contain `mobile/android` get an APK: v1.4.0 and later. The workflow never creates a release; run by
  hand, it attaches to the release that already exists for the tag, and fails if there is none. It never replaces
  an APK already attached: to publish again, delete that asset from the release first.

## What each release gets

- `oxespace-android-vX.Y.Z.apk`: release build (minified), signed with APK Signature Scheme v3 (Android 9+).
- `oxespace-android-vX.Y.Z.apk.sha256`: its SHA-256.
- The run summary shows the same SHA-256 and the signing certificate's SHA-256.
- A build provenance attestation (GitHub artifact attestations): this APK came from this workflow at this tag.

Before attaching anything, the workflow starts the build R8 shrank on an emulator and reads every kind of desktop
frame with it (`ReleaseSmokeTest`, on the `minified` build type: the release build with the debug key). A shrinking
rule that is missing fails the release there, not on a phone.

## Verifying an APK before installing it

1. The file is the one published:

   ```sh
   sha256sum -c oxespace-android-vX.Y.Z.apk.sha256
   ```

2. It's signed by the project's key: `apksigner` from the Android SDK build-tools.

   ```sh
   apksigner verify --print-certs oxespace-android-vX.Y.Z.apk
   ```

   The line `Signer #1 certificate SHA-256 digest:` must match the fingerprint the project published (step 3 above,
   without the colons, in lowercase). Android also refuses an update signed by a different key.

   Or check its provenance with the GitHub CLI: `gh attestation verify oxespace-android-vX.Y.Z.apk --repo propagno/oxespace`.

3. Install it (enable "install unknown apps" for the browser or file manager), open OXESpace › Settings › Devices on
   the computer, and pair by scanning the QR. Google Play Protect may warn about an app from outside the Play Store;
   that warning is about where it came from, not about this APK, which steps 1 and 2 already checked. Choose to install
   anyway.
