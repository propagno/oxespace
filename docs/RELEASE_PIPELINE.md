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

## Recommended pattern: commit → push → Run workflow

This is the day-to-day path (matches the GitHub **Run workflow** dialog).

### 1. Prepare the version on your branch

```powershell
# On any branch (main or feat/…)
# 1) Bump package.json + package-lock.json to X.Y.Z (must not already be a published tag)
# 2) Commit and push
git add package.json package-lock.json   # + your product changes
git commit -m "release: vX.Y.Z — short summary"
git push -u origin HEAD
```

Rules the pipeline enforces:

- `package.json` version must be `X.Y.Z`
- Release tag will be `vX.Y.Z` (or the value you pass in **tag**)
- If `vX.Y.Z` already exists, it must point at **this** commit

### 2. Actions → CI and Release → Run workflow

| Field in the dialog | What to set |
|---------------------|-------------|
| **Use workflow from** | The **same branch you just pushed** (this is the code + workflow file GitHub will use) |
| **branch** (optional input) | Leave **empty** unless you need to build a different ref than “Use workflow from” |
| **publish_release** | `true` to ship; `false` for CI-only on that branch |
| **tag** | Leave empty → uses `v{package.json version}` |

Click **Run workflow**.

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
# After version bump is on the commit you want:
git tag vX.Y.Z
git push origin vX.Y.Z
```

Same pipeline: **build → release** (no manual Run workflow). Tag must match `package.json` and the commit.

---

## CI only (no release)

| Trigger | Result |
|---------|--------|
| Push / PR to `main` | build only |
| Run workflow with **publish_release = false** | build only on the selected branch |

---

## Prereleases

Use a semver prerelease version/tag such as `vX.Y.Z-beta.1`. The builder
produces a channel-specific updater manifest (`beta.yml`) instead of replacing
the stable `latest.yml` feed. The published GitHub Release is marked
prerelease.

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

Consumers can compare `SHA256SUMS.txt` before installation. The release body is
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
