# Release pipeline

OXESpace separates pure read-only verification (**CI**, `.github/workflows/ci.yml`) from Desktop + Android
publishing (**Release**, `.github/workflows/release.yml`, which invokes `ci.yml` via `workflow_call` with
`strict_perf_gate: true`) — so packaging and publish never start until typecheck, tests, build, E2E and
`acceptance-release` have succeeded on the exact tagged commit.

Desktop publishing uses the repository's built-in GitHub Actions token and needs no release secrets. The
**`publish-desktop`** job runs in the protected `release` environment (`ubuntu-24.04`), and the isolated
**`sign-android`** job runs in the protected `android-release` environment (`ubuntu-24.04`, holding the Android
keystore secrets per `SECURITY #231`). Everything is built and verified first — including unsigned Android APK
build + minified emulator smoke in parallel (`android-build`, zero secrets) — then both environments enter
**Review deployments → Approve** simultaneously (one approval modal, two isolated environments per `SRE-04`).

## Jobs

### CI (`.github/workflows/ci.yml`)

| Job | When | What |
|-----|------|------|
| **changes** | Always (not on a draft PR) | Classifies a PR's files (docs-only, a11y, OxeQuery, deps) and resolves the single commit SHA every job checks out. |
| **quick** (`Quick checks (linux-x64)`) | Unless the PR is docs-only | Fast-gate (`<2 min`): typecheck, lint (file-size guard + ESLint), fast guardrail tests (`workflow-governance`, `css-classes-guard`, `design-lint`, `design-lint-target-size`, `i18n-catalog`, `migration-numbering`), notices, Electron support window, and dependency/tool/bundled audits. Gates heavy job fan-out. |
| **build** (matrix: `linux-x64`, `windows-x64`) | After `quick` passes | Compiles `out/` **once per OS** with bundle budgets and `check-bundle-imports.mjs`; uploads `app-build-<platform>` (reused by downstream E2E, brand, a11y, OxeQuery live, and packaging jobs) and `main-sourcemaps-<platform>`. |
| **unit-shard** + **unit** (5 Windows / 4 Linux shards) | After `quick` passes | Unit and integration tests in Node/Vitest (no Electron/Xvfb download; CI `retry: 1` for transient flakes), merged per OS with coverage floors (`coverage-summary-<platform>`). |
| **brand-conformance** (`windows-x64`, `linux-x64`) | After `build` passes | Dedicated, unmasked OXE-149 brand fidelity test (`playwright.brand.config.ts`) posting `marca/conformidade` status. |
| **e2e-impacted** (`linux-x64`) | On PRs touching code, after `build` passes | Targeted smoke + acceptance E2E specs selected by `scripts/related-e2e.mjs` so UI/IPC regressions fail on the PR instead of post-merge. |
| **e2e** (matrix: `windows-x64`, `linux-x64` × shards 1–4) | On `main`, dispatches, and `workflow_call` (after `build`) | Full E2E suite across 4 shards per OS, reusing `app-build-<platform>`. Shard 1 also runs upgrade rehearsal and OxeQuery coverage; shard 4 runs the performance gate (soft + `perf-plan`/`perf-recheck` on `main`, hard when `strict_perf_gate=true` from `release.yml`). |
| **a11y** (`ubuntu-22.04`, `windows-2022`) | PRs touching UI/renderer; `main`/dispatches always | Strict axe scan (`npm run test:a11y`), reusing `app-build-<platform>`. |
| **oxequery-live** / **oxequery-live-versions** | PRs touching OxeQuery; `main`/dispatches always | Live PostgreSQL/MongoDB/SSH container suites reusing `app-build-linux-x64`. |
| **package** (`windows-x64`, `linux-x64`) | Only when `packaged_smoke_only=true` (manual dispatch or `nightly.yml` via `workflow_call`) | Packages installers via `.github/actions/package-electron` and runs packaged-app E2E without publishing. |
| **CI result** | Every non-draft run, after everything | Single required branch-protection check: merges E2E blob reports, verifies every required job succeeded, and posts `CI result` / `marca/conformidade` statuses. |

### Release (`.github/workflows/release.yml`)

| Job | When | What |
|-----|------|------|
| **plan** | `v*.*.*` tag push or `workflow_dispatch(target=full\|android-only)` | Validates tag format, `package.json` version parity, and `origin/main` ancestry for stable releases. |
| **verify** | `target=full` | Calls `.github/workflows/ci.yml` (`strict_perf_gate: true`) on the verified tag SHA. |
| **acceptance-release** | `target=full` (parallel with `verify` & `android-build`) | Full `e2e/acceptance` suite on Linux against the verified tag SHA. |
| **android-build** | Stable tags (parallel with `verify` & `acceptance-release`) | Zero secrets, `contents: read` (`SECURITY #231`): builds unsigned release APK + runs `ReleaseSmokeTest` on minified emulator build. |
| **package-desktop** | After `verify` + `acceptance-release` | Reuses `app-build-*` from `verify`, packages Windows NSIS and Linux AppImage/`.deb`, checks fuses + `.deb` `chrome-sandbox`, runs packaged E2E, generates SBOMs and checksums. |
| **publish-desktop** (`environment: release`, `ubuntu-24.04`) | After `package-desktop` + `android-build` + approval | Combines checksums, attests build provenance, creates/refreshes draft release, re-downloads & verifies every asset, publishes (`draft=false`), and confirms the release is live. |
| **sign-android** (`environment: android-release`, `ubuntu-24.04`) | Enters `waiting` simultaneously with `publish-desktop` | Signs unsigned APK with `apksigner`, verifies v2/v3 cert, attests provenance, waits up to 3 min for live release, and attaches APK + `.sha256` without `--clobber`. |

---

## Recommended pattern: release PR → merge to main → publish from main

A stable release is published from `main` only, so `main` is always the last published version
plus whatever is merged after it.

### 1. Prepare the version on a release branch

```powershell
git switch -c release/X.Y.Z origin/<integration branch>
# Bump package.json + package-lock.json to X.Y.Z (must not already be a published tag)
# and add docs/releases/X.Y.Z.md
git add package.json package-lock.json docs/releases/X.Y.Z.md
git commit -m "chore(release): X.Y.Z"
git push -u origin HEAD
```

Before opening the PR, dispatch **CI** (`ci.yml`) on the release branch with
**packaged_smoke_only = true**. It runs the full checks and the installed-app smoke without
publishing. Regenerate visual baselines via `visual.yml` (`mode=baselines`) if the UI changed.

**Required before every release: repeat the real tool-cost measurement (T8).** What OXESpace's MCP tools cost
depends on the agents' own behaviour, which changes between versions of Claude Code and Codex. With the versions the
release ships against, repeat the runs in `docs/validation/tool-groups-cost-1.4.md` (plain conversation and every
group on demand with Claude, plain and one group used with Codex), with the person's consent since they use their
account. Record the versions and numbers there. If an agent now sends MCP definitions up front, or no longer defers
them, fix the session plan in `electron/main/services/conversation/tool-groups.ts` before releasing.

### 2. Open the PR `release/X.Y.Z` → `main` and merge it when CI is green

The push to `main` runs CI once more on the merged commit.

### 3. Push the tag `vX.Y.Z` on that commit of `main`

The release owner tags the candidate commit and pushes the tag; that push starts the release run (`Publish vX.Y.Z`):

```sh
git tag vX.Y.Z <candidate sha>
git push origin vX.Y.Z
```

The `release` and `android-release` environments accept only `v*` tags. Always publish by pushing a tag (or use
`npm run release -- tag X.Y.Z --run` followed by `npm run release -- approve X.Y.Z --run`).

Rules the pipeline enforces:

- `package.json` version must match the `vX.Y.Z` tag
- A stable release must be a commit on `main`; any other ref stops in `plan`, before building. Prereleases
  (`X.Y.Z-beta.N`) may still be published from any branch (Desktop only).

### Run names

Each run says what it is, in the Actions list:

| Run name | Started by |
|---|---|
| `Publish vX.Y.Z` | Tag push to `release.yml` (`Publish vX.Y.Z (Android only)` when `target=android-only`) |
| `Packaged smoke · <branch>` | `ci.yml` Run workflow with **packaged_smoke_only** |
| `Full check · <branch>` | `ci.yml` Run workflow without **packaged_smoke_only** |
| `PR #N · <title>` | A pull request to `main` (`ci.yml`) |
| `Push · main` | A push to `main` (`ci.yml`) |
| `Visual baselines · <platform> · <branch>` | `visual.yml` with `mode=baselines` |
| `Visual regression · <branch>` | `visual.yml` PR or `mode=compare` |

### 3. What the pipeline does

```text
vX.Y.Z tag push → release.yml (plan)
   ├─ verify (workflow_call → ci.yml, strict_perf_gate=true)
   ├─ acceptance-release (e2e/acceptance on Linux)
   └─ android-build (unsigned APK + minified emulator smoke, zero secrets)
         │
         ▼
   package-desktop (Windows + Linux installers, fuses, packaged E2E, SBOM, checksums)
         │
         ▼ (simultaneous approval modal: release + android-release)
   ├─ publish-desktop (ubuntu-24.04) → draft → re-download & verify → publish → confirm live
   └─ sign-android    (ubuntu-24.04) → apksigner → attest → wait for live release → attach APK
```

### 4. Confirm

- Actions run is green (`publish-desktop` and `sign-android`)
- https://github.com/propagno/oxespace/releases/tag/vX.Y.Z is **not** draft
- Assets: see [Published release payload](#published-release-payload)

---

## Alternative: automatic on tag push

```powershell
# After the version bump is merged to main:
git fetch origin && git tag vX.Y.Z origin/main
git push origin vX.Y.Z
```

Same pipeline: **plan → verify + acceptance-release + android-build → package-desktop → simultaneous approval → publish-desktop + sign-android**. Tag must match `package.json` and the commit, and a stable tag must point at a commit on `main`.

---

## CI only (no release)

| Trigger | Result |
|---------|--------|
| Push / PR to `main` | verification only (`ci.yml`) |
| `ci.yml` Run workflow (`packaged_smoke_only = false`) | full verification on the selected branch |
| `ci.yml` Run workflow (`packaged_smoke_only = true`) | full verification + installers + installed-app smoke, nothing published |
| Dispatched by the merge train | verification on the PR branch it updated, or on `main` after it merged (see below) |

---

## Merge train

Nobody merges to `main` by hand. Label a ready PR **`na-fila`** and the **Merge train** workflow
(`.github/workflows/merge-train.yml`, logic in `scripts/merge-train.mjs`) takes it from there, one PR at a
time, oldest labelling first. Each run moves the PR at the head of the queue one step:

| PR state | What the train does |
|----------|---------------------|
| Draft, conflicting, changes requested, or from a fork | Removes the label and says why |
| Behind `main` | Updates the branch (merges `main` into it, with `[skip ci]` in that merge commit), dispatches CI on the new head, then cancels that PR's runs still queued or running on its superseded heads |
| CI on the current head not started or still running | Waits; a later run continues |
| A check on the current head failed | Removes the label, naming the job, its link and the first failing step |
| Green on the current head and 0 commits behind `main` | Merges with a merge commit, pinned to the tested SHA, then serves the next PR |
| Waited more than 60 minutes for CI on one head | Removes the label (`MERGE_TRAIN_TIMEOUT_MINUTES` variable or the dispatch input changes the limit) |

The train keeps one `merge-train:` comment per PR and edits it. Every check run on the head counts except
skipped ones, and a few must have run and passed: the train's own `TRAIN_REQUIRED_CHECKS` (`CI result`, the
summary job of `ci.yml`) plus whatever branch protection requires. Protection only adds names; turning
required checks on in the settings never narrows what the train looks at. A required check that was
skipped counts as not passed.

**Hold while `main` is red.** With the repository variable `MERGE_TRAIN_HOLD_WHEN_MAIN_RED` set to `true`
(off by default), the train merges nothing while none of `main`'s 3 latest completed `ci.yml` runs passed
(pushes and the train's "Full check · main" dispatches; cancelled and skipped runs don't count; runs it
cannot read count as red). The run summary says `held: main red since <sha> (<run>)`, and the waiting cars
get no comment. The one exception is a car labelled **`fix-main`** by a maintainer or an admin: it goes
first, through the same checks as any car, and the train removes `fix-main` after merging it.

**Release hold.** While any open issue or PR carries the label **`release-hold`** (a release, or a gate being
run on `main`), the train makes no move at all: no merge, branch update, dispatch or batch, `fix-main` included.
The run summary says `held by release-hold: #<n> (<title>)`, and the cars keep their `na-fila` labels, so the
queue goes on in the same order once the label comes off (the 10-minute schedule picks that up). If the label
cannot be read, the train holds as well and reads it again on the next run. Put the label on the release PR or a
tracking issue when the release starts, and take it off when the release is published.

**Batches of docs and tests.** When the car at the head of the queue changes only docs and tests, the train
takes it and up to four more such cars, merges them on `train/batch-N` from `main` and runs CI there once. Green,
it posts `CI result` (description `batch train/batch-N`) on each member's tested head and merges them in order,
each only while `main` is still the commit the batch expects. Anything else ends the batch, and its members go
one by one, labelled `no-batch`. The repository variable `MERGE_TRAIN_BATCHES=false` turns batches off. The file
list and every rule are in [ci-cd.md](ci-cd.md#batches-of-docs-and-tests).

**Batches of code** (user OK on 09/11). When the first car changes code, the train takes it and up to two more cars
that are each **ready** (the latest `pr:ready` status and the latest `CI result` on their own head both passed) and
**independent**: no file in common with an earlier member, at most one member with a file under
`electron/main/db/migrations/` (the order guard, #730), and none that changes `.github/`, since only a person
merges a workflow change. A car that fails a rule stays out with the reason in the run log; the batch is built
from those that pass, and needs two. Its commits end in ` code`, which keeps the kind for the merge-time check
(a member that changes a workflow by then gets no status). Green, the members merge in order, each with its own
merge commit, as above. Red, each member goes back on its own with `no-batch`: the serial train tests it alone, the
one that breaks leaves the queue with its comment, and the others merge.

**GITHUB_TOKEN.** The train uses the workflow's built-in token, and what that token does starts no
usable workflow run: a merge fires no `push` run on `main`, and a branch update's `pull_request` runs only
wait for an approval nobody gives (they end `action_required` with no jobs, because the approval gate comes
before any job's `if:`). So the train makes its branch update a merge commit whose message carries
`[skip ci]`, which keeps GitHub from creating those `push`/`pull_request` runs at all, and it dispatches
`ci.yml` itself, on the updated branch (with `android.yml` when
it had run on the PR; the axe scan is a job of `ci.yml` since 09/11) and on `main` after each merge. `[skip ci]` never touches a dispatched run, and it
only applies while that merge commit is the PR's head: a person's next push runs CI as usual. A run that
ended `action_required` or with every job skipped never stands for CI on a head.

**Behind only by docs.** A green car is not updated again when every commit `main` gained since the car's
merge base (GitHub's compare, each commit's own files plus the net diff, renames' old paths included) only
adds or edits docs-only paths: `docs/**`, `.claude/**` or `*.md`, outside `src/`, `electron/`, `shared/`,
`tests/` and `e2e/`, and not a doc that a test or a CI gate reads. Those read docs are listed once in
`scripts/merge-train.mjs` (`TEST_READ_DOCS`: `README.md`, `SECURITY.md`, `THIRD_PARTY_NOTICES.md` and every
Markdown file under `docs/` except `docs/plans/` and `docs/audits/`, because `tests/unit/docs-links.test.ts` checks their links),
and a unit test greps `tests/` and `e2e/` for doc paths and fails when a read one is missing. A removal or a
rename, more than 20 commits, or a list GitHub cuts short always means an update. The merge still pins the
CI-tested head, so `main` gets exactly the tested tree plus those docs.

**Superseded runs.** Right after an update, the train cancels the runs that only hold runner slots: runs of
its dispatchable workflows, from this repository, on that PR's branch, still queued or running, on exactly
the head the train replaced, not tied to another PR, and started either by the PR (`pull_request`) or by the
train's own dispatch. It never cancels a run on the current head or a later push, on `main`, of another PR, a
person's manual dispatch (Full check, Packaged smoke, publish), a push or tag run, or any other workflow.

When a head has no runs at all (an author's own `[skip ci]`), the train dispatches both workflows (`ci.yml`,
`android.yml`), and an `Android` run on the head gates the merge
like CI. The update itself is check-then-act (read the head, then merge `main`
into the branch by name); a push in that window only gets `main` merged on top of it, which changes the head
and sends it through CI again, so this is accepted while batches are of size 1. The same token may not push a
change to `.github/workflows`: when GitHub refuses a merge (or a branch update) for that, the PR leaves the
queue with that cause and the coordinator merges it.

**Trust boundary.** Only a label added by someone with write, maintain or admin access counts; the train
checks the labeler's role and otherwise removes the label. It counts only GitHub Actions check runs and this
repository's own `push`, `pull_request` and `workflow_dispatch` runs on the head, and it only trusts its own
`github-actions[bot]` comment, whose state marker it validates. Still, the CI it dispatches runs the PR
branch's own scripts, so a PR could make its CI pass by changing them. The real gate is branch protection
on `main` (required reviews and required checks, with no bypass for Actions): the train never merges what
protection would refuse, and it adds protection's required checks to its own as soon as there are any.

---

## Prereleases

Use a semver prerelease version/tag such as `vX.Y.Z-beta.1`. The builder
produces a channel-specific updater manifest (`beta.yml`) instead of replacing
the stable `latest.yml` feed. The published GitHub Release is marked
prerelease.

Who receives a beta: an install with **Settings › Updates › Receive beta
versions** on. A pre-release install starts with it on. Turning it off
never downgrades: the app keeps its version until a newer stable release is
out (`allowDowngrade` stays off). Installs from before this switch existed
(1.3.3 and earlier) get their first beta from the Releases page.

## Published release payload

Every release contains:

| Asset | Platform | Purpose |
|---|---|---|
| `OXESpace-X.Y.Z-x64.exe` | Windows | NSIS installer |
| `OXESpace-X.Y.Z-x64.exe.blockmap` | Windows | Differential updates |
| `latest.yml` (stable) or `<channel>.yml` | Windows | Updater manifest |
| `OXESpace-X.Y.Z-x64.AppImage` | Linux | Portable package, self-updating |
| `OXESpace-X.Y.Z-amd64.deb` | Ubuntu / Debian | Package-manager install |
| `latest-linux.yml` (stable) or `<channel>-linux.yml` | Linux | Updater manifest |
| `sbom-windows-x64.spdx.json`, `sbom-linux-x64.spdx.json` | both | Production-dependency SBOMs |
| `SHA256SUMS.txt` | both | Checksums of every asset |

Consumers can compare `SHA256SUMS.txt` before installation. The installers and
`SHA256SUMS.txt` also carry a GitHub build-provenance attestation, a signed
statement that the file was built by this repository's `Release`
workflow. To check a download:

```sh
gh attestation verify OXESpace-X.Y.Z-x64.exe --repo propagno/oxespace
```

The Windows installer is not code-signed yet: Windows SmartScreen still shows
"unknown publisher" until the SignPath signing (roadmap cycle A2) is active.

The release body is
`docs/releases/X.Y.Z.md` when that file exists on the released commit;
otherwise GitHub generates notes using the categories in `.github/release.yml`.

## Promoting a beta line to stable

1. **Decide the version.** Drop the prerelease suffix: `0.16.0-beta.N` → `0.16.0`.
   The pipeline derives the channel from the version, so `0.16.0` publishes
   `latest.yml` / `latest-linux.yml` and a non-prerelease GitHub Release.
2. **Write `docs/releases/0.16.0.md`** — what is new since the last stable, the
   upgrade note (database migrations are forward-only; a verified backup is taken
   first) and known limitations.
3. **Run the readiness checklist** in
   [the stable-readiness study](audits/2026-10-11-stable-readiness.md).
4. **Release** with the recommended pattern above (commit → merge to `main` → push the tag
   `vX.Y.Z` on that commit), approve the run's deployment, then confirm the green run and the live release.

What users see:

- A **beta** install updates to the stable release automatically. The updater
  looks for `beta.yml` first and falls back to `latest.yml` when the release has
  no beta manifest (verified in `electron-updater` 6.8.9, `GitHubProvider`).
- A **stable** install never receives pre-releases.
- The `.deb` does not self-update; its users install the new package.

## Upgrade rehearsal

Every CI run (Windows and Linux) runs `tests/integration/upgrade-rehearsal.native.test.ts` under the Electron
runtime. It reads the previous stable release's `electron/main/db` from its git tag (`v1.3.3`), lets that code
create a real database, fills it with user data, and upgrades it with the current build. It checks that every
value survived, that integrity and foreign keys hold, that exactly one verified backup of the old version was
taken, and that reopening takes no second one. It then rehearses the way back: the old release must refuse the
upgraded file without changing it (a database from a newer version is never downgraded), and restoring the
backup from `db-backups/` must give the old release a database it opens with all its data, which the current
build can upgrade again. The latest schema version is read from `LATEST_DB_VERSION`, never hardcoded.

When a release becomes the latest stable, change `PREVIOUS_STABLE` in the test. To rehearse another release
locally: `OXESPACE_UPGRADE_FROM=v1.3.0 npm run test:electron -- tests/integration/upgrade-rehearsal.native.test.ts`.
CI sets `OXESPACE_REQUIRE_UPGRADE_TAG=1`, so a missing tag fails the job instead of skipping the test.

## Guarantee that the release shipped

The **release** job fails the workflow unless all of the following hold after
`gh release edit --draft=false`:

1. `gh release view` succeeds for the tag.
2. `isDraft` is `false`.
3. `isPrerelease` matches the version channel.
4. Required assets are present on the live release.

If publish is incomplete, the workflow is red — there is no silent draft-only
success path.

## Notes

- All 8 canonical workflows are governed by `tests/unit/workflow-governance.test.ts` and `.github/CODEOWNERS`.
- Reusable setup/build/packaging steps live in `.github/actions/{setup-oxespace,build-oxespace,package-electron,setup-android}`.
