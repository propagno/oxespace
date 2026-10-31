# Release pipeline

OXESpace uses a **single GitHub Actions workflow** — **CI and Release**
(`.github/workflows/ci.yml`) — so packaging and publish never start until
typecheck, tests, build and E2E have succeeded on the same commit.

The workflow uses the repository's built-in GitHub Actions token and needs no
release secrets or protected Environment configuration.

## Jobs

| Job | When | What |
|-----|------|------|
| **build** (matrix: `windows-x64`, `linux-x64`) | Always | Dependency and build-tool audits → Electron support window → typecheck → lint → unit/integration tests → build → native verify → E2E and performance gate. If a release is planned, also builds the platform packages (NSIS installer; AppImage and `.deb`), runs the packaged-build smoke test, and produces the SBOM, checksums and uploads artifacts. The two legs never cancel each other. |
| **release** | Only if `build` succeeds **and** a release was planned | Ensures the `vX.Y.Z` tag points at the verified SHA → draft release + assets → re-download verify → publish → **confirm the release is live** (not draft, required assets present). |

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

Before opening the PR, dispatch **CI and Release** on the release branch with
**packaged_smoke_only = true**. It runs the full checks and the installed-app smoke without
publishing. Regenerate visual baselines there if the UI changed.

**Required before every release: repeat the real tool-cost measurement (T8).** What OXESpace's MCP tools cost
depends on the agents' own behaviour, which changes between versions of Claude Code and Codex. With the versions the
release ships against, repeat the runs in `docs/validation/tool-groups-cost-1.4.md` (plain conversation and every
group on demand with Claude, plain and one group used with Codex), with the person's consent since they use their
account. Record the versions and numbers there. If an agent now sends MCP definitions up front, or no longer defers
them, fix the session plan in `electron/main/services/conversation/tool-groups.ts` before releasing.

### 2. Open the PR `release/X.Y.Z` → `main` and merge it when CI is green

The push to `main` runs CI once more on the merged commit.

### 3. Actions → CI and Release → Run workflow, from `main`

| Field in the dialog | What to set |
|---------------------|-------------|
| **Use workflow from** | `main` |
| **branch** (optional input) | Leave **empty** |
| **publish_release** | `true` |
| **tag** | Leave empty → uses `v{package.json version}` |

Rules the pipeline enforces:

- `package.json` version must be `X.Y.Z`
- Release tag will be `vX.Y.Z` (or the value you pass in **tag**)
- If `vX.Y.Z` already exists, it must point at **this** commit
- A stable release must be a commit on `main`; any other ref stops in the plan step, before the
  build. Prereleases (`X.Y.Z-beta.N`) may still be published from any branch.

### Run names

Each run says what it is, in the Actions list:

| Run name | Started by |
|---|---|
| `Publish · main` | Run workflow with **publish_release** (`Publish vX.Y.Z · main` when **tag** is set) |
| `Publish vX.Y.Z` | A tag push |
| `Packaged smoke · <branch>` | Run workflow with **packaged_smoke_only** |
| `Full check · <branch>` | Run workflow with neither |
| `PR #N · <title>` | A pull request to `main` |
| `Push · main` | A push to `main` |
| `Visual baselines · <platform> · <branch>` | Visual baselines |

### 3. What the pipeline does

```text
build (typecheck → test → build → e2e)
   │
   ├─ publish_release=false  → stop (green CI only)
   │
   └─ publish_release=true
         → dist + SBOM + checksums
         → create tag vX.Y.Z on the verified SHA (if missing)
         → draft GitHub Release + assets
         → re-download & verify
         → publish (draft=false)
         → confirm live assets
```

### 4. Confirm

- Actions run is green (both jobs when publishing)
- https://github.com/propagno/oxespace/releases/tag/vX.Y.Z is **not** draft
- Assets: see [Published release payload](#published-release-payload)

---

## Alternative: automatic on tag push

```powershell
# After the version bump is merged to main:
git fetch origin && git tag vX.Y.Z origin/main
git push origin vX.Y.Z
```

Same pipeline: **build → release** (no manual Run workflow). Tag must match `package.json` and the commit, and a stable tag must point at a commit on `main`.

---

## CI only (no release)

| Trigger | Result |
|---------|--------|
| Push / PR to `main` | build only |
| Run workflow with **publish_release = false** | build only on the selected branch |
| Run workflow with **packaged_smoke_only = true** | build + installers + installed-app smoke, nothing published |
| Dispatched by the merge train | build on the PR branch it updated, or on `main` after it merged (see below) |

---

## Merge train

Nobody merges to `main` by hand. Label a ready PR **`na-fila`** and the **Merge train** workflow
(`.github/workflows/merge-train.yml`, logic in `scripts/merge-train.mjs`) takes it from there, one PR at a
time, oldest labelling first. Each run moves the PR at the head of the queue one step:

| PR state | What the train does |
|----------|---------------------|
| Draft, conflicting, changes requested, or from a fork | Removes the label and says why |
| Behind `main` | Updates the branch (merges `main` into it), then dispatches CI on the new head |
| CI on the current head not started or still running | Waits; a later run continues |
| A check on the current head failed | Removes the label, naming the job, its link and the first failing step |
| Green on the current head and 0 commits behind `main` | Merges with a merge commit, pinned to the tested SHA, then serves the next PR |
| Waited more than 60 minutes for CI on one head | Removes the label (`MERGE_TRAIN_TIMEOUT_MINUTES` variable or the dispatch input changes the limit) |

The train keeps one `merge-train:` comment per PR and edits it. A check counts when branch protection
requires it, or, while protection requires none, every check run on the head except skipped ones.

**GITHUB_TOKEN.** The train uses the workflow's built-in token, and what that token does starts no
other workflow: a branch update fires no `pull_request` run and a merge fires no `push` run on `main`. So the
train dispatches `ci.yml` itself, on the updated branch (with `a11y-axe.yml`, `memory-compatibility.yml` or
`android.yml` when they had run on the PR) and on `main` after each merge. The same token may not push a
change to `.github/workflows`: when GitHub refuses a merge (or a branch update) for that, the PR leaves the
queue with that cause and the coordinator merges it.

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
statement that the file was built by this repository's `CI and Release`
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
4. **Release** with the recommended pattern above (commit → push → Run workflow
   with `publish_release=true`), then confirm the green run and the live release.

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

- The workflow file must exist on the branch selected in **Use workflow from**
  (usually keep `ci.yml` in sync on `main` and feature branches).
- A thin **Release (redirect)** workflow only forwards old bookmarks to this
  pipeline with `publish_release=true`.
