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
       ─▶ Run workflow "CI and Release" from main,      package (Windows + Linux, packaged-app E2E)
          publish_release=true (the release owner)      → tag → draft → re-download and verify → publish
       ─▶ installed apps                                electron-updater reads the feed; stable installs get
                                                        stable releases, beta installs also get prereleases
```

## Pipelines

| Workflow | Trigger | What it gates |
|---|---|---|
| `ci.yml` — CI and Release | PR, push to main, `v*.*.*` tag, dispatch | The single pipeline: quick checks, unit (Windows + Linux), E2E (3 shards per OS), perf gate, live DB tests, packaging and release. `CI result` is the one check for the run. See [RELEASE_PIPELINE.md](RELEASE_PIPELINE.md#jobs). |
| `merge-train.yml` | `na-fila` label, workflow_run, schedule, dispatch | Merges PRs one at a time ([RELEASE_PIPELINE.md#merge-train](RELEASE_PIPELINE.md#merge-train)). PRs that change `.github/workflows/**` can't be merged by its token and are merged by hand. |
| `a11y-axe.yml` | PR, push, dispatch | axe scan of the screens. |
| `memory-compatibility.yml` | PR (memory paths), called by `ci.yml` | AI Memory contract against pinned upstream versions. |
| `provider-contract.yml` | PR (provider paths), schedule | Claude/Codex CLI contract (no paid calls). |
| `android.yml` | PR, push, dispatch | Android lint, unit tests and build. |
| `android-emulator.yml` | dispatch | Instrumented tests on an emulator. |
| `acceptance.yml` | dispatch | `e2e/acceptance` specs. They are written before the feature, so red is expected until the item lands. |
| `visual-regression.yml` | push to main | Screenshot comparison of the anchor surfaces. |
| `visual-baselines.yml` | dispatch | Regenerates the baselines, once per batch on main, not per PR. |
| `release.yml` | dispatch | Redirect only: forwards to `ci.yml` with `publish_release=true`. |

Useful dispatches of `ci.yml`, all from the branch chosen in **Use workflow from**:

- no inputs: a full check of that branch (what the train uses);
- `packaged_smoke_only=true`: builds the installer layout and runs the packaged-app E2E on both platforms, publishes
  nothing. Use it before any release and on any PR that touches packaging, `electron-builder.yml` or the fuses;
- `publish_release=true` (+ optional `tag`): a real release. Stable versions only from `main`; the job refuses a
  commit that is not on main (`ci.yml`, "Plan build vs release").

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

Installs that already updated keep the bad version until the fix ships. If it can't open its database or start,
tell those users to install the previous version's installer from the Releases page **and** restore the backup that
the upgrade took (in the app's `db-backups/` folder). The upgrade rehearsal proves that this path works.

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
