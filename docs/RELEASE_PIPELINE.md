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
| Behind `main` | Updates the branch (merges `main` into it, with `[skip ci]` in that merge commit), dispatches CI on the new head, then cancels that PR's runs still queued or running on its superseded heads |
| CI on the current head not started or still running | Waits; a later run continues |
| A check on the current head failed | Removes the label, naming the job, its link and the first failing step |
| Green on the current head and 0 commits behind `main` | Merges with a merge commit, pinned to the tested SHA, then serves the next PR |
| Waited more than 60 minutes for CI on one head | Removes the label (`MERGE_TRAIN_TIMEOUT_MINUTES` variable or the dispatch input changes the limit) |

The train keeps one `merge-train:` comment per PR and edits it. A check counts when branch protection
requires it, or, while protection requires none, every check run on the head except skipped ones.

**GITHUB_TOKEN.** The train uses the workflow's built-in token, and what that token does starts no
usable workflow run: a merge fires no `push` run on `main`, and a branch update's `pull_request` runs only
wait for an approval nobody gives (they end `action_required` with no jobs, because the approval gate comes
before any job's `if:`). So the train makes its branch update a merge commit whose message carries
`[skip ci]`, which keeps GitHub from creating those `push`/`pull_request` runs at all, and it dispatches
`ci.yml` itself, on the updated branch (with `a11y-axe.yml`, `memory-compatibility.yml` or `android.yml` when
they had run on the PR) and on `main` after each merge. `[skip ci]` never touches a dispatched run, and it
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

When a head has no runs at all (an author's own `[skip ci]`), the train dispatches all four workflows (`ci.yml`,
`a11y-axe.yml`, `memory-compatibility.yml`, `android.yml`), and an `Android` run on the head gates the merge
like CI, axe and memory compatibility. The update itself is check-then-act (read the head, then merge `main`
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
protection would refuse, and it follows protection's required checks as soon as there are any.

### Batches (train v2, off by default)

The repository variable `MERGE_TRAIN_BATCH` picks the batch size. `1` (the default) is everything above,
unchanged. `2` or `3` makes the train test up to that many consecutive cars together
(`scripts/merge-train-batch.mjs`):

1. **Plan.** It takes cars from the head of the queue, in order, never overtaking. A car that is not ready
   ends the batch before it. When the first car cannot be batched, it goes through the single-car path above.
   A batch stops before:
   - a car that changes a workflow file, or whose file list is cut short (never batched);
   - a car that changes a gate: `package.json`, a `tsconfig`, the vitest, playwright, eslint or
     electron-vite/builder configs, `scripts/**`, `.github/**` or the test setup. Such a car runs alone, so it
     can only weaken its own checks;
   - a `release/*` branch (also alone);
   - a second car that touches the Android generator inputs (`shared/remote/**`, `src/design/tokens/**`,
     `shared/locales/*/mobile.json`, `scripts/android/**`; `tests/android-generated.test.ts` checks them);
   - a second migration car.

   A migration car is batchable only when it adds exactly one `NNN_*.sql` (or the `_posix`/`_win` pair), with
   `NNN` = `LATEST_DB_VERSION` on main + 1, sets `LATEST_DB_VERSION` to `NNN`, and changes no existing
   migration. With the wrong number it leaves the queue with "renumber the migration".
2. **Build.** It merges each car's head SHA onto a `merge-train/batch-<run>-<attempt>` ref made at main (the
   merges API). A conflict at car *i* ends the batch at cars 1..*i*-1, and car *i* waits. A tip commit with the
   same tree carries the manifest (base, cars, heads).
3. **Test.** It dispatches every gate the batch's paths need, from one table that a test keeps equal to the
   workflow files: `ci.yml` always (it runs memory compatibility too), axe and Android when their path
   filters match. Green means all of them passed on the tip, latest attempt.
4. **Verify (R1).** Nothing in a `merge-train/*` ref is trusted. Before a verdict counts, and again before
   merging, the train merges the same heads onto the same base on a scratch `merge-train/verify-*` ref, and
   requires every tree, and the tip, to match.
5. **Merge (R6).** Car by car, with the pull request merge API pinned to the tested head. Before each merge it
   checks again that the car is open, still labelled, not a draft, has no changes requested and is still on
   the tested head, and that main is still where the last merge left it. After each merge it checks that main's
   new commit has parents [previous main, car head] and the tree the train derived. Each merge commit carries
   `Merge-Train-Batch: <id> <i>/<k>` and `Tested-Run: <run>`. The last one gets an informational `merge-train`
   commit status (never a required check). Then `ci.yml` is dispatched on main.
6. **Stop the line.** A batch that stops after merging some of its cars leaves main on an untested tree, so the
   train dispatches main's CI on it and pauses until that run is green. Any red completed main CI run also
   pauses the train.
7. **Red (R8).** An infrastructure failure (cancelled, timed out, a lost runner) or a nondeterministic step
   (E2E, the performance gate, OxeQuery live, axe) is retried once with "re-run failed jobs". It is never
   retried a second time for the same tree, and never when the same job also flaked in the previous batch.
   A confirmed red batch falls back linearly:
   - car 1 is tested alone on main. Red: it leaves the queue, and the rest are planned again. Green: it merges,
     and the next car is tested alone on the new main;
   - a car whose tree on main is the red batch's tree leaves the queue without a new run (verdicts are reused
     by tree, after checking the failed run).

   With three cars, that is the batch plus at most two runs.
8. **State (R7).** The state is the one live batch ref. More than one live ref aborts them all. Scratch refs
   from a run that died are removed. A batch that waits more than the timeout for CI goes linear: every car stays in
   the queue, labelled, and they are tested one at a time. Only a car that times out on its own (alone, or in
   linear mode) leaves the queue, as in v1.

**Rollout, with the ARCHITECT's gates.**
1. **Shadow:** `MERGE_TRAIN_BATCH=1` with `MERGE_TRAIN_BATCH_SHADOW=1`. The train builds and tests the batch it
   would make, under `merge-train/shadow-*`, only while fewer than 4 runs are active. It never merges, comments,
   labels, retries or cancels. It logs one `merge-train-shadow {...}` line per verdict. Gate: at least 10
   multi-car shadow batches or one week, whichever is later, with:
   - zero false greens (shadow green, but v1 red on one of the cars);
   - every `tree(T)` matching the final main tree;
   - the false-red rate recorded;
   - no stuck state;
   - queue time p50/p95 measured.
2. **Size 2:** at least 10 real batches with zero tree or parent mismatches, a green main run after every batch,
   no stop-the-line event that is not explained, and no increase in runner-queue saturation.
3. **Size 3:** the same gates. Rollback is `MERGE_TRAIN_BATCH=1`.

With size 1, the branch update stays check-then-act (see "Superseded runs" below), which is accepted. Batches
never push to a PR branch at all.

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
