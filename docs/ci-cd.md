# CI/CD overview

How a change gets from a commit to users' machines, how to run the same checks locally, and what to do when a
release goes wrong. The job-by-job reference of the main pipeline is [RELEASE_PIPELINE.md](RELEASE_PIPELINE.md);
this page is the map around it.

OXESpace has no servers. "Deploy" means **release**: a version tag → installers (Windows NSIS, Linux AppImage and
`.deb`) → a GitHub Release → the auto-update feed (`latest.yml`, `latest-linux.yml`, `beta*.yml`) that installed
apps read.

## The flow

```
commit ─▶ pull request ─▶ CI and Release (PR)          first red ≈ 3 min (quick), full ≈ 25–40 min
                          + Accessibility (axe), Memory compatibility, Android, Provider contract (by path)
       ─▶ label na-fila ─▶ Merge train                  updates the PR with main, dispatches CI on that head,
                                                        merges when every check is green, one PR at a time
       ─▶ main ─▶ CI and Release (push)                 everything runs, including the OxeQuery live matrices
       ─▶ the release owner pushes the tag vX.Y.Z     package (Windows + Linux, packaged-app E2E)
          on the candidate commit of main               → draft → wait for approval (environment `release`)
                                                        → re-download and verify → publish
       ─▶ installed apps                                electron-updater reads the feed; stable installs get
                                                        stable releases, beta installs also get prereleases
```

## Pipelines

| Workflow | Trigger | What it gates |
|---|---|---|
| `ci.yml` — CI and Release | PR, push to main, `v*.*.*` tag, dispatch | The single pipeline: quick checks, unit (Windows + Linux), E2E (3 shards per OS), perf gate, live DB tests, packaging and release, and the dependency review when a manifest, lockfile or workflow changes (a high or critical advisory fails it). `CI result` is the one check for the run, and the one branch protection requires. A dispatched run (the merge train's) also posts it as a commit status on the commit it tested, since GitHub does not count a `workflow_dispatch` check run toward a pull request's required checks. See [RELEASE_PIPELINE.md](RELEASE_PIPELINE.md#jobs). |
| `merge-train.yml` | `na-fila` label, workflow_run, schedule, dispatch | Merges PRs one at a time ([RELEASE_PIPELINE.md#merge-train](RELEASE_PIPELINE.md#merge-train)). PRs that change `.github/workflows/**` can't be merged by its token and are merged by hand. |
| `a11y-axe.yml` | PR, push, dispatch | axe scan of the screens. |
| `memory-compatibility.yml` | PR (memory paths), called by `ci.yml` | AI Memory contract against pinned upstream versions. |
| `provider-contract.yml` | PR (provider paths), schedule | Claude/Codex CLI contract (no paid calls). |
| `android.yml` | PR, push, dispatch | Android lint, unit tests and build. |
| `android-emulator.yml` | dispatch | Instrumented tests on an emulator (`api-level` input, default 36). From 37 the SDK names levels `37.0`, `37.1`…: `37` means `37.0`. A level with no Google APIs x86_64 image is skipped with a notice, not failed. |
| `acceptance.yml` | dispatch | `e2e/acceptance` specs. They are written before the feature, so red is expected until the item lands. |
| `visual-regression.yml` | push to main | Screenshot comparison of the anchor surfaces. |
| `visual-baselines.yml` | dispatch | Regenerates the baselines, once per batch on main, not per PR, then verifies them in the same job. A verify failure right after a green regeneration means a capture that is not stable, not a stale baseline: rerun the job once and report the shot to the visuals owner (`code-changes-diff` is a known case). |
| `release.yml` | dispatch | Redirect only: forwards to `ci.yml` with `publish_release=true`. Not for a stable release: the `release` environment accepts only tags (see below). |

Useful dispatches of `ci.yml`, all from the branch chosen in **Use workflow from**:

- no inputs: a full check of that branch (what the train uses);
- `packaged_smoke_only=true`: builds the installer layout and runs the packaged-app E2E on both platforms, publishes
  nothing. Use it before any release and on any PR that touches packaging, `electron-builder.yml` or the fuses;
- `publish_release=true` (+ optional `tag`): **not how a stable version is published.** The publish job runs in the
  `release` environment, which accepts only `v*` tags, so a dispatch from `main` stops at that job.

**Publishing a release** is a tag push by the release owner (the user), on the candidate commit of `main`:

```sh
git tag v1.4.0 <candidate sha>     # package.json on that commit says 1.4.0
git push origin v1.4.0
```

The tag's CI run (`Publish vX.Y.Z`) checks the tag matches `package.json` and is on `main`, builds and verifies
everything, then waits on **Review deployments → Approve** (the `release` environment's required reviewer) before it
publishes. Its last step starts `android-release.yml` on the tag (a release published with `GITHUB_TOKEN` fires no
`release` event, so it would not start on its own), which signs and attaches the APK after its own approval.

### Draft pull requests

A push to a draft runs nothing: CI, axe and Memory compatibility skip, and `CI result` is skipped. Marking the PR
ready for review starts the full run. **Mark it ready first, then push**, or push again once it is ready. If you push
and run `gh pr ready` at once, GitHub can handle the ready event before the push: the full run then tests the head
from *before* that push, and the new head has only the skipped run. The merge train requires a `CI result` that
tested the head, so it will not take that PR. Since #429, the draft's skip run has a concurrency group of its own and
can no longer cancel the ready run.

### Batches of docs and tests

When the queue's first car changes only docs and tests, the train batches it on its own (`runBatch` in
`scripts/merge-train.mjs`). Batchable files: `docs/**`, Markdown outside `.github/` and the app's code, `tests/**`,
and spec files under `e2e/`. Never `.github/**`, `package*.json`, `scripts/**`, a Playwright or Vitest config,
`electron/`, `src/`, `shared/` or an `android/` folder.

1. **Build.** From a green main, the train takes the first car and up to four more batchable cars in queue order. It
   leaves out drafts, forks, conflicts, changes requested, `fix-main` and `no-batch`. It creates `train/batch-N` at
   main and merges each head into it (commit `merge-train batch N: #<pr> <head sha>`), then dispatches `ci.yml` on
   the branch. A member that conflicts with an earlier one stays out. With fewer than two members, nothing is built.
2. **Wait.** Nothing else moves while a batch is open. The branch is the batch's whole state.
3. **Green.** For each member in order, the train first checks that main is the commit the batch expects: its base,
   then the merge just made. It posts the `CI result` status on the member's exact tested head (description
   `batch train/batch-N`, link to the batch run) and merges that head. main ends with the tested tree.
4. **Anything else ends the batch** and deletes `train/batch-N`.
   - CI red, never started, or past the timeout; main moved; a merge refused: the members left are labelled
     `no-batch` and go one by one. Remove the label to let a PR batch again.
   - A member closed, unlabelled or given a new head: the others go back unlabelled and may batch again.

`MERGE_TRAIN_BATCHES=false` (repository variable) turns batches off. To see what the train would do without changing
anything: `GITHUB_TOKEN=$(gh auth token) GITHUB_REPOSITORY=<owner/name> node scripts/merge-train.mjs --dry-run`.

`scripts/merge-batch.mjs` is the manual fallback, with the same file list. A maintainer runs it with their own `gh`
login: `--dry-run` prints the batch; without it, the script opens a batch PR labelled `na-fila` and takes the members
out of the queue. If that batch fails, close it and relabel its members.

## Before na-fila: `npm run pr:ready`

No PR is labelled `na-fila` without a green `npm run pr:ready` on its exact head. A hook (`.claude/hooks/pr-ready-gate.mjs`) checks for the marker it writes, `.claude/pr-ready/<HEAD sha>.json` in the main checkout.

- **The checks:** lint and typecheck; the gate tests every PR passes (design-lint, fs-allowlist); and the tests related to the change (`scripts/related-tests.mjs`). Vitest runs under Electron's ABI with 2 workers. When the protocol, the design tokens or a `mobile` catalog changes, `tests/android-generated.test.ts` checks that the committed Kotlin matches (`android:generate --check`).
- **Whole suite:** when a change touches every test (`package.json`, the vitest or TypeScript config, the test setup), the PR's CI unit jobs, green on that head, stand for the whole suite. It doesn't fit in local memory. `--full` runs it locally anyway.
- **Changes that need no `node_modules`:**
  - **Images only** (visual baselines under `e2e/visual/__screenshots__/{linux,win32}/`): proven by a green `visual-baselines.yml` run on that exact head, one per platform touched. Dispatch it on the PR branch first. The marker says `evidence: "images"`.
  - **Packages only** (`package.json` / `package-lock.json`, at the root or in `playground/`), or other snapshot images: proven by the PR's CI unit jobs, with no local step. The marker says `evidence: "ci"`.
- **The `pr:ready` commit status:** on green, `pr:ready` also posts a `pr:ready` success status on that exact sha (the evidence kind and its runs), so GitHub and the merge train can see that the head passed. The head must be pushed first; otherwise the marker stays local and `pr:ready` exits 1, saying so. `pr:ready` is **not** a required check in branch protection: the train's batch branches and its update-branch merges never carry it.
- **Clean tree:** the working tree must be clean, since the marker vouches for HEAD. `--dry-run` prints the plan; `--base <ref>` changes the base.

## Running the checks locally

The machine running the team is memory-starved: prefer CI for anything heavy, and run heavy local jobs one at a
time through the team's heavy-run lock, with enough free memory.

| Check | Command | Notes |
|---|---|---|
| Typecheck, lint | `npm run typecheck`, `npm run lint` | Light. |
| Unit and integration with native SQLite | `npm run test:electron [-- <path>]` | Not `npm test`: system Node has a different ABI and DB tests fail for that reason alone ([DEVELOPMENT_GUIDE.md](DEVELOPMENT_GUIDE.md)). |
| Upgrade rehearsal from an older release | `OXESPACE_UPGRADE_FROM=v1.3.0 npm run test:electron -- tests/integration/upgrade-rehearsal.native.test.ts` | Needs the tags fetched. |
| Linux gate from Windows | `npm run verify:linux` | Docker; heavy. |
| E2E | `npx playwright test <spec>` after `npm run build` | Heavy. Never launch `electron.exe` by hand, and strip `OXESPACE_*` variables from the environment. |
| Android protocol bindings | `npm run android:generate` | Required when `shared/remote/protocol.ts` changes; commit the generated Kotlin. |
| Workflow syntax | `actionlint` | Before pushing a workflow change. |

## Before publishing a release

1. `main` has a **completed green** `CI and Release` run on the commit to release (a cancelled run is not green).
2. A `packaged_smoke_only=true` run on that commit is green on both platforms.
3. `docs/releases/X.Y.Z.md` exists; `PREVIOUS_STABLE` in the upgrade rehearsal points at the last stable tag.
4. Prefer a prerelease first (`vX.Y.Z-rc.N` or `-beta.N`): only beta installs receive it, so it works as a staged
   rollout before the stable tag.

## When a release goes wrong (runbook)

**There is no downgrade.** The updater never installs a lower version (`allowDowngrade` is off,
`electron/main/updater.ts`), and the database is migrated forward with a verified backup taken first. The fix for a
bad release is always a new, higher version. What you can do at once is stop the bad one from spreading.

How the feed is read (electron-updater 6.8.9, `GitHubProvider`): a stable install asks GitHub for
`/releases/latest`, which ignores drafts and prereleases; a beta install reads the releases feed, which also ignores
drafts. Both then download the `latest*.yml` / `beta*.yml` of that release.

### 1. Stop the spread (minutes)

Pick one; both are reversible. Only the release owner (the user) does this.

- **Pause new updates, keep the release visible:** set `stagingPercentage: 0` in the bad release's manifests and
  upload them over the old ones. Installs that check from now on skip the update; the Releases page keeps the
  download.
  ```sh
  gh release download vX.Y.Z -p 'latest*.yml' -D bad-feed     # or beta*.yml for a prerelease
  # add the line  stagingPercentage: 0  to each file
  gh release upload vX.Y.Z bad-feed/latest.yml bad-feed/latest-linux.yml --clobber
  ```
- **Withdraw the release:** `gh release edit vX.Y.Z --draft=true`. `/releases/latest` falls back to the previous
  stable, so installs still on it see nothing new. The tag stays and points at the same commit.

Installs that already updated keep the bad version until the fix ships. If they can't wait for the fix (the app
doesn't start, or a feature they depend on is broken), they can go back to the previous release.

#### Going back to the previous release on one machine

**The order matters.** The previous release does **not** warn on a database from a newer version: it leaves the
file untouched, but it opens **empty** ("No workspaces yet"). A person who opens it before restoring thinks their
data is gone, and anything they create before the restore is lost when they do it. So the restore comes **before**
the first start of the old version:

1. Quit OXESpace completely (also from the tray, if it's there).
2. Install the previous version's installer from the Releases page over the current one (Windows: run the `.exe`;
   Linux: install the previous `.deb`, or use the previous AppImage). **Don't open it yet.** Untick "Run OXESpace" at
   the end of the installer.
3. In the user data folder (Windows `%APPDATA%\OXESpace`; Linux `~/.config/oxespace`, lowercase, for both the
   `.deb` and the AppImage; measured on the CI runners), delete `oxespace.sqlite3`,
   `oxespace.sqlite3-wal` and `oxespace.sqlite3-shm`, then copy the newest
   `db-backups/oxespace-v<old schema>-*.sqlite3` there as `oxespace.sqlite3`. For 1.3.3 that's
   `oxespace-v77-*.sqlite3`. The upgrade took this backup just before migrating.
4. Open OXESpace: the previous release starts on the data it had before the update.

Windows, in PowerShell, for a rollback to 1.3.3:

```powershell
Get-Process OXESpace -ErrorAction SilentlyContinue | Stop-Process -Force
$data = "$env:APPDATA\OXESpace"
Remove-Item "$data\oxespace.sqlite3", "$data\oxespace.sqlite3-wal", "$data\oxespace.sqlite3-shm" -ErrorAction SilentlyContinue
$backup = Get-ChildItem "$data\db-backups" -Filter 'oxespace-v77-*.sqlite3' | Sort-Object LastWriteTime -Descending | Select-Object -First 1
Copy-Item $backup.FullName "$data\oxespace.sqlite3"
```

What changed after the update (new workspaces, threads, settings) is not in the backup. When the fixed version
ships, it upgrades the restored data again, with a new backup.

**Tested:** the `Install over the last stable` workflow (`.github/workflows/install-over.yml`) does exactly these
steps on a clean Windows runner. It installs 1.3.3, creates data, installs the candidate over it, checks the upgrade,
reinstalls 1.3.3, checks that it leaves the upgraded database byte-identical, restores the backup, and checks that
1.3.3 opens it with the workspace. First green run: 1.4.0-rc.0 over 1.3.3,
[41318110576](https://github.com/propagno/oxespace/actions/runs/41318110576). That a "pause" in the manifest stops
updates is tested in `tests/unit/update-feed-pause.test.ts`, against the electron-updater version we ship.

### 2. Fix forward (hours)

1. Fix on a branch, merge through the train, and wait for a completed green `main` run.
2. Release **X.Y.(Z+1)** with the steps above. If you withdrew the bad release, leave it as a draft, or delete it
   once the fix is out.
3. In the notes (`docs/releases/X.Y.(Z+1).md`), say what was wrong, who was affected and whether they need to act.

### 3. Afterwards

- Record the incident in the release notes and add the missing check to CI (a packaged-smoke case, an upgrade
  rehearsal case or an E2E spec), so the same failure can't ship twice.
- Watch adoption of the fix through the asset download counts:
  `gh release view vX.Y.Z --json assets --jq '.assets[]|"\(.downloadCount) \(.name)"'`.

## Rolling back a CI or workflow change

Workflow changes are ordinary commits: revert the PR (`git revert -m 1 <merge sha>` on a branch, then a PR). A
revert of a `.github/workflows/**` change is merged by hand, like the change itself.
