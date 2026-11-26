# CI/CD overview

How a change gets from a commit to users' machines, how to run the same checks locally, and what to do when a
release goes wrong. The job-by-job reference of the main pipeline is [RELEASE_PIPELINE.md](RELEASE_PIPELINE.md);
this page is the map around it.

OXESpace has no servers. "Deploy" means **release**: a version tag → installers (Windows NSIS, Linux AppImage and
`.deb`) → a GitHub Release → the auto-update feed (`latest.yml`, `latest-linux.yml`, `beta*.yml`) that installed
apps read.

## The flow

```
commit ─▶ pull request ─▶ CI (PR)                       first red < 2 min (fast-gate), full ≈ 12–18 min
                          + Visual (Linux + Windows, informative), Android, Nightly provider-probe (by path)
       ─▶ label na-fila ─▶ Merge train                  updates the PR with main, dispatches CI on that head,
                                                        merges when every check is green, one PR at a time
       ─▶ main ─▶ CI (push)                             everything runs (4 E2E shards/OS + OxeQuery live matrices)
       ─▶ the release owner pushes the tag vX.Y.Z       Release (release.yml): CI + acceptance-release + unsigned Android APK
          on the candidate commit of main               in parallel → package-desktop → simultaneous approval gate
                                                        (`release` + `android-release`) → publish Desktop + attach signed APK
       ─▶ installed apps                                electron-updater reads the feed; stable installs get
                                                        stable releases, beta installs also get prereleases
```

## Pipelines (8 canonical workflows)

| Workflow | Trigger | What it gates |
|---|---|---|
| `ci.yml` — **CI** | PR, push to main, dispatch, `workflow_call` | Pure read-only verification: `fast-gate` (`Quick checks (linux-x64)`), single build per OS (`build`), unit shards (5 Windows / 4 Linux), dedicated `brand-conformance`, targeted `e2e-impacted` on PRs, 4-shard full E2E + perf gate on `main`/tags, `a11y`, live DB matrices, dependency review, and optional `packaged_smoke_only`. `CI result` is the required status check in branch protection. See [RELEASE_PIPELINE.md](RELEASE_PIPELINE.md#jobs). |
| `release.yml` — **Release** | `v*.*.*` tag push, dispatch (`target=full\|android-only`) | Unified Desktop + Android release: calls `ci.yml` (`strict_perf_gate=true`), runs `acceptance-release` and unsigned `android-build` (zero secrets, `SECURITY #231`) in parallel, packages Windows/Linux installers, then pauses on simultaneous `release` + `android-release` environment approvals (`SRE-04`) before publishing Desktop (`ubuntu-24.04`) and signing/attaching the Android APK. |
| `android.yml` — **Android** | PR (not a draft), push, dispatch (`run_emulator`, `api_level`) | Default: Android lint, unit tests, screenshot goldens (Paparazzi) and debug APK build. With `run_emulator=true`: instrumented tests on a KVM emulator (`api_level` default `36`; `37` resolves `37.0`). |
| `nightly.yml` — **Nightly** | Schedule (`05:00 UTC`), PR (provider probe paths), dispatch (`suite`) | Consolidated nightly health: Claude/Codex CLI `provider-contract`, `packaged-smoke` (via native `workflow_call` to `ci.yml`), full `acceptance` e2e suite (with issue sync), and `perf-load` (Windows + Linux with cached Electron). |
| `visual.yml` — **Visual** | PR touching `src/`, locales or visual specs (not a draft); dispatch (`mode=compare\|baselines`) | `compare` (automatic Linux + Windows on PRs, informative/read-only; on dispatch opens per-platform issues from an isolated write job) and `baselines` (regenerates, verifies twice, optionally commits ONLY `e2e/visual/__screenshots__/<platform>/` to `test/visual-baselines-*`). |
| `manual-ops.yml` — **Manual ops** | dispatch (`operation=acceptance\|hml-packaged-pass\|install-over\|perf-gate`), PR (`e2e/release/**`) | On-demand QA/release operations: single `acceptance` spec across refs (no npm cache), `hml-packaged-pass`, `install-over` (G4/G8/B13 upgrade/rollback/uninstall against `latest-stable`), and `perf-gate` (OXE-105/OXE-163 3-way A/B/C comparison against the previous 2 stable tags). |
| `merge-train.yml` — **Merge train** | `na-fila` label, `workflow_run` (`CI`), schedule, dispatch | Merges PRs one at a time ([RELEASE_PIPELINE.md#merge-train](RELEASE_PIPELINE.md#merge-train)). PRs that change `.github/workflows/**` can't be merged by its token and are merged by hand. |
| `jira-sync.yml` — **Jira sync** | PR opened/closed/reopened/ready/edited | Links PRs and syncs card status with Jira. |

Shared setup/build/packaging boilerplate lives in 4 local composite actions under `.github/actions/` (`setup-oxespace`, `build-oxespace`, `package-electron`, `setup-android`), enforced by `tests/unit/workflow-governance.test.ts` and `.github/CODEOWNERS`.

Useful dispatches of `ci.yml`, all from the branch chosen in **Use workflow from**:

- no inputs: a full check of that branch (what the train uses);
- `packaged_smoke_only=true`: builds the installer layout and runs the packaged-app E2E on both platforms, publishes
  nothing. Use it before any release and on any PR that touches packaging, `electron-builder.yml` or the fuses.

**Publishing a release** is a tag push by the release owner (the user), on the candidate commit of `main`:

```sh
git tag v1.6.2 <candidate sha>     # package.json on that commit says 1.6.2
git push origin v1.6.2
```

The tag push triggers **`Release`** (`.github/workflows/release.yml`, run title `Publish vX.Y.Z`): it validates the tag
matches `package.json` and is on `main`, runs Desktop CI + `acceptance-release` + unsigned `android-build` in parallel,
packages Windows & Linux installers, then enters **Review deployments → Approve** for both `release` and
`android-release` simultaneously (one modal, two isolated protected environments). Once approved, `publish-desktop` and
`sign-android` complete in parallel (~90 seconds). To re-attach only the Android APK on an already-live release,
dispatch `release.yml` from the `vX.Y.Z` tag with `target=android-only`.

### Draft pull requests

A push to a draft runs nothing: CI and axe skip, and `CI result` is skipped. Marking the PR
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
  - **Images only** (visual baselines under `e2e/visual/__screenshots__/{linux,win32}/`): proven by a green `visual.yml` (`mode=baselines`) run on that exact head, one per platform touched. Dispatch it on the PR branch first. The marker says `evidence: "images"`.
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

1. `main` has a **completed green** `CI` run on the commit to release (a cancelled run is not green).
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

**Tested:** the `Manual ops` workflow (`.github/workflows/manual-ops.yml`, `operation=install-over`) does exactly these
steps on clean Windows and Linux runners (against `latest-stable` by default, or an explicit `from_tag`). It installs
the previous release, creates data, installs the candidate over it, checks the upgrade, reinstalls the previous release,
checks that it leaves the upgraded database byte-identical, restores the backup, and checks that the previous release
opens it with the workspace. First green run: 1.4.0-rc.0 over 1.3.3,
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
