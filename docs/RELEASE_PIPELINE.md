# Release pipeline

OXESpace uses a **single GitHub Actions workflow** — **CI and Release**
(`.github/workflows/ci.yml`) — so packaging and publish never start until
typecheck, tests, build and E2E have succeeded on the same commit.

The workflow uses the repository's built-in GitHub Actions token and needs no
release secrets or protected Environment configuration.

## Jobs

| Job | When | What |
|-----|------|------|
| **build** | Always | Typecheck → unit/integration tests → build → native verify → E2E. If a release is planned, also builds the NSIS installer, SBOM, checksums and uploads artifacts. |
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
- Assets: `OXESpace-X.Y.Z-x64.exe`, `.blockmap`, `latest.yml` (or channel yml), `SHA256SUMS.txt`, `sbom.spdx.json`

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

Every Windows release contains:

- `OXESpace-X.Y.Z-x64.exe`
- `OXESpace-X.Y.Z-x64.exe.blockmap`
- `latest.yml` for stable releases or `<channel>.yml` for prereleases
- `SHA256SUMS.txt`
- `sbom.spdx.json` with production dependencies

Consumers can independently compare `SHA256SUMS.txt` before installation.

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
