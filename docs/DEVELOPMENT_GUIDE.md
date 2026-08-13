# Development guide

## Local verification

```powershell
npm ci
npm run typecheck
npm run lint
npm run test:electron
npm run build
npm run fix:native
npm run verify:native
npm run test:e2e
```

`better-sqlite3` is ABI-specific: it is built for Electron (NODE_MODULE_VERSION 125), while system Node is 127. `npm test` therefore fails every DB-backed test with a module-version error — which is easy to mistake for known noise, and once hid a real migration break until release CI caught it. `npm run test:electron` runs vitest through the Electron binary (`ELECTRON_RUN_AS_NODE=1`), so the ABI matches and the suite passes locally exactly as in CI; forward a path with `npm run test:electron -- tests/integration/foo.test.ts`.

CI takes the other route — it rebuilds for Node, runs `test:coverage`, then prepares the Electron binary for the packaged build and E2E. Locally you can still do that with `npm run rebuild:native:node` / `npm run rebuild:native:electron`, but prefer `test:electron`: switching runtimes replaces the native binary and the rebuild is slow and occasionally fails. `npm run native:doctor` reports the currently loadable Node modules and both runtime ABIs. A source rebuild on Windows requires the Visual Studio C++ workload and Windows SDK; CI/package flows prefer the pinned prebuilt Electron binary.

## Linux (Ubuntu/Debian x64)

Everything above applies unchanged; the shell is `bash` instead of PowerShell. Install the toolchain and the Electron runtime libraries once:

```bash
sudo apt-get install -y build-essential python3 make g++          # native module builds
sudo apt-get install -y libnss3 libatk-bridge2.0-0 libgtk-3-0 \
  libgbm1 libasound2 libxshmfence1 libnotify4                     # Electron runtime
sudo apt-get install -y xvfb                                      # headless `npm run test:e2e`
```

Run E2E headless with `bash scripts/run-with-xvfb.sh npm run test:e2e`. Package with `npm run dist:linux` (AppImage + deb); `npm run dist` now selects `dist:linux` or `dist:win` from the host platform.

For the reproducible Linux gate from Windows or macOS, use `npm run verify:linux`.
The Docker harness rebuilds native modules for Linux, runs typecheck/lint and the
full unit/integration suite, builds production bundles, launches the Electron
E2E suite under Xvfb, then enforces the UI/PTY performance budgets in
`e2e/perf-benchmark.spec.ts`. CI repeats the same smoke and performance gate on
Ubuntu 22.04. Release builds additionally launch `dist/linux-unpacked` with real
SQLite, node-pty and Bash before AppImage/deb artifacts may be uploaded.

Use `bash scripts/run-with-xvfb.sh <command>` instead of invoking `xvfb-run`
directly in automation. The wrapper owns and reaps the X server, which prevents
long Playwright runs from leaving an orphaned Xvfb process until the CI timeout.

Two behaviours differ by design:

- **Auto-update is AppImage-only.** `electron-updater` cannot replace an apt-owned install, so a `.deb` build reports updates as disabled instead of erroring every six hours. See `updaterSupportsThisInstall()` in `electron/main/updater.ts`.
- **OXEVoice is unavailable.** Only a `win-x64` whisper.cpp build is bundled. `voice.service.ts` reports `engineReady: false` and the feature hides itself. Adding it means dropping a Linux build into `resources/whisper/linux-x64` and extending the `linux.extraResources` block.

`better-sqlite3` and `node-pty` are `optionalDependencies`, so a failed native build does **not** fail `npm install` — the app boots into the degraded `registerNativeFailureIpcHandlers` mode instead (it opens, but nothing works). Run `npm run native:doctor` first when that happens.

### Writing tests that survive both hosts

A backslash is path syntax only on Windows. On POSIX, `..\secret.txt` and `C:\workspace\outside.txt` are ordinary *filenames* that resolve **inside** the workspace root — so `safeJoin` correctly does not reject them, and a test asserting a throw is asserting a bug that does not exist.

Three suites were already written against Windows semantics and had to be split (`safe-join`, `file-system.service`, `agent.service`). The pattern is a host-gated alias next to the imports, so the intent is visible at the call site:

```ts
const testWindows = process.platform === 'win32' ? test : test.skip
```

When a case is genuinely platform-specific, gate it and add the equivalent for the other host — do not delete it, and do not weaken the assertion to something that passes everywhere. The same applies to `where.exe`/PATHEXT shim resolution in `agent.service.ts`, which returns early on non-Windows.

### Verifying Linux from a Windows workstation

Three tiers, cheapest first. None requires a Linux install.

**1. Docker — everything except how it looks.** Requires Docker Desktop running with the Linux engine.

```powershell
npm run verify:linux
```

Builds `docker/linux-verify.Dockerfile` and runs the chain in `docker/linux-verify.sh`: native-module compile, typecheck, lint, `test:electron`, `build`, and the E2E smoke against a real Electron window under Xvfb. This is where the POSIX-only paths finally execute — migration 046's bash seeding and repointing, the `safe-join` cases that are `describe.skip`'d on Windows, `buildScriptCommand`, and the shell-profile defaults.

`.dockerignore` excludes `node_modules` on purpose: the host copy holds Windows-built native binaries, and copying them in would mask exactly what the image exists to catch.

To exercise packaging too (downloads the ~1 GB semantic model, so it is not in the default chain):

```powershell
docker run --rm -v ${PWD}/dist-linux:/app/dist oxespace-linux-verify bash -lc "npm run dist:linux"
```

**2. WSL2 — the real GUI.** Windows 11 ships WSLg, so an Electron window renders on your desktop. This is the only local way to answer "does it actually feel right":

```powershell
wsl --install -d Ubuntu-22.04     # once; may prompt for a reboot
```

Then inside the distro, install the prerequisites from the section above, clone the repo **into the Linux filesystem** (`~/oxespace`, never `/mnt/c` — native modules and file watching are both unreliable across the 9p mount), and run `npm ci && npm run dev`.

**3. CI — the authoritative answer.** The `ubuntu-22.04` leg of the build matrix runs the same chain on a clean runner and packages the AppImage + deb. Push the branch and read the job; that is the configuration that actually ships.

## Database changes on more than one OS

Migration 046 is platform-split: `046_shell_profiles_win.sql` is a no-op version bump, while `046_shell_profiles_posix.sql` seeds `builtin-bash` and repoints workspaces/panes away from `builtin-powershell`. The runner in `electron/main/db/index.ts` picks one by `process.platform`; both land on `user_version = 46`.

The `builtin-powershell` row is intentionally kept rather than deleted, so foreign keys stay valid. The consequence: a database migrated on Linux and then opened on Windows keeps its panes on `builtin-bash`. Repair is one statement:

```sql
UPDATE panes SET shell_profile_id = 'builtin-powershell' WHERE shell_profile_id = 'builtin-bash';
UPDATE workspaces SET default_shell_profile_id = 'builtin-powershell' WHERE default_shell_profile_id = 'builtin-bash';
```

When adding a platform-dependent default, put it in `electron/main/services/shell-profile.defaults.ts` and mirror it in the migration — the DB-less code paths (native-failure fallbacks, the E2E mock IPC layer) read from that module, and a drift between the two is invisible until a pane fails to spawn.

## Release pipeline

Both platforms are held to the same bar. Every gate below runs on `windows-2022`
**and** `ubuntu-22.04`; `needs: build` requires *both* legs to succeed, so a
one-sided failure blocks the release rather than shipping half a payload.

| Gate | Where |
|---|---|
| typecheck · lint · unit/integration | every push and PR |
| E2E smoke | every push and PR (Linux via `scripts/run-with-xvfb.sh`) |
| UI/PTY performance budgets | every push and PR (`OXESPACE_PERF_GATE=1 npm run bench:ui`) |
| packaged-artifact smoke | release runs only — `packaged-win.spec.ts` / `packaged-linux.spec.ts` |
| artifact + checksum verification | release runs only — twice: pre-upload and again against the published draft |

The packaged smokes are the only checks that launch the **real shipped binary**,
asar-packed with its native modules and extraResources in place. The unpackaged
E2E suite cannot catch a broken `asarUnpack` entry, a missing `extraResource` or
a native module built for the wrong ABI, because in dev those all resolve from
`node_modules`. Both specs share one body in `e2e/packaged-smoke.ts` so the two
platforms cannot drift apart.

Assets per release: `.exe` + `.blockmap` + `latest.yml`, `.AppImage` + `.deb` +
`latest-linux.yml`, one SBOM per platform, and a combined `SHA256SUMS.txt`.

`scripts/verify-release-artifacts.mjs --platform win|linux` gates each payload.
The `.deb` is matched by **pattern**, not exact name: electron-builder renders
`${arch}` as the Debian architecture (`amd64`), not the Electron one (`x64`), and
that naming is upstream's to change. Exactly one `.deb` must be present — zero or
two both fail.

### Cutting a release

1. Bump `version` in `package.json`; the workflow refuses a tag that disagrees with it.
2. **Dry-run first if anything in the packaging path changed**: `workflow_dispatch`
   with `publish_release: false` runs both legs including packaging and artifact
   verification, without publishing.
3. Push the tag `vX.Y.Z`. The release job creates a **draft**, re-downloads it,
   re-verifies both payloads, and only then publishes.

## Adding an IPC capability

1. Add request/result types to a focused file in `shared/types/` and expose the method through `OxeApi` and `IPC_CHANNELS`.
2. Implement the service without renderer dependencies. Enforce authorization and path/trust validation in the service, not just the UI.
3. Register a small adapter in `electron/main/ipc/` and expose it from `electron/preload/api.ts`.
4. Add safe fallback handlers used by native-failure and E2E modes when the UI can call the capability during startup.
5. Add service/contract integration tests and, for a user-visible critical flow, an E2E assertion.

Never expose generic `ipcRenderer.send`, a raw shell executor, database handles or unrestricted filesystem primitives to the renderer.

## Database changes

Create the next ordered migration; never edit an already released migration. Make migrations transactional where SQLite permits it, specify defaults for existing rows, and update repository/service queries and fixtures together. Validate upgrades from an existing database in addition to fresh creation.

## MCP changes

Treat command, arguments, environment and remote endpoints as executable configuration. Preserve the `enabled && trusted` synchronization invariant. Avoid logging environment values or bridge tokens. Any new internal MCP tool needs a bounded input schema, workspace authorization, deterministic errors and tests for rejection paths.

## UI and Web Preview

UI code should consume typed bridge methods and keep pure transformations in adjacent model modules. Remote preview access must remain a visible user choice; do not restore popup/download sandbox permissions or apply cross-origin response rewriting globally.

## UI copy: state, not explanation

OXESpace is an application, not a tutorial. Interface text states **what
something is**; it does not explain how the feature works internally, restate
what the control above already says, or reassure the user.

Concretely, do not write:
- **Mechanism** — "Probing each agent command with `--version`", "RTK is a
  sidecar binary under userData". The user asked for a result, not a trace.
- **Tutorial** — "Ready CLIs can be bound to a terminal pane". If the button is
  there, it is bindable.
- **Restatement** — a second sentence rephrasing the first ("Alerts only fire
  for terminals you are not watching. While you follow an agent in the focused
  pane, OXESpace stays quiet.").
- **Reassurance** — "audio never leaves your machine", "no separate download".
  State the fact once ("Local recognition") and stop.

Do write: counts and state ("4 ready · 2 not installed"), a single actionable
line when action is required ("Install a CLI, then run Health check"), and
nothing at all when the controls already speak for themselves — a hint that is
read once and scrolled past forever is noise on every later visit.

Prefer removing a line to shortening it. An empty secondary line is better than
a filled one that says nothing new.

## Styling: two systems, one cascade

The renderer runs OXESpace's hand-written CSS (`src/styles/*.css`) alongside the
shadcn/Tailwind foundation (`src/styles/ui-kit.css`, `src/components/ui/`).

**Cascade.** Everything except `tokens.css` is imported into the `oxe-legacy`
cascade layer, ordered `oxe-reset → theme → base → oxe-legacy → components →
utilities`. A Tailwind utility therefore beats a legacy panel class, which is
what lets panels migrate one at a time. `tokens.css` stays unlayered so its
custom properties win everywhere, including all 11 `[data-theme]` palettes.

**Tokens.** shadcn's semantic tokens are namespaced `--sh-*` and bridged onto
OXESpace tokens, so primitives inherit the brand and follow theme switches.
Interactive tokens track `--accent` (which themes retheme), not `--brand`
(the fixed logo emerald). `tests/unit/token-bridge.test.ts` guards this — a
re-run of `npx shadcn add` would otherwise restore the stock gray defaults.

**When to reach for a primitive.** Use one when it brings *behaviour* that
hand-written CSS cannot: focus traps, Escape/outside-click, keyboard menus,
aria wiring. Do **not** convert working bespoke CSS to Tailwind utilities for
its own sake — measured on this codebase, expressing a one-off brand tint as
arbitrary values (`bg-[color-mix(...)]`, `text-[9.5px]`) emits a unique utility
per value and cost ~2 kB for two badges, enough to breach the CSS budget, while
the CSS rule it replaced was smaller and clearer. Utilities pay off on repeated
patterns, not on one-offs.

**Signature surfaces.** Panels whose look is richer than the stock shell (the
Tools hub, the settings and workspace wizards) use `<DialogContent unstyled>`:
Radix supplies the behaviour, the panel's own CSS supplies the appearance.
Such a surface must position itself and declare a `z-index` at least equal to
`LEGACY_MODAL_OVERLAY`'s — content renders after the overlay in the portal, so
a lower value hides the panel behind the blurred scrim.

## Definition of done

A change is complete when TypeScript and ESLint pass, tests cover failure paths, coverage stays above configured thresholds, bundle budgets pass, the relevant native runtime is verified, and the smoke E2E covers important user behavior. Update architecture or security documentation whenever a boundary or invariant changes.
