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

## How to trigger

### Automatic (tag push)

1. Update `package.json` / `package-lock.json` to `X.Y.Z` on the branch you will ship.
2. Merge to the commit you want to release.
3. Create and push a matching tag:

```powershell
git tag vX.Y.Z
git push origin vX.Y.Z
```

The workflow rejects a tag that does not match `package.json` or the commit it
points at. **Release runs only after build succeeds.**

### Manual (choose branch)

**Actions → CI and Release → Run workflow**

| Input | Meaning |
|-------|---------|
| **branch** | Branch to check out and build (e.g. `main`, `feat/...`) |
| **publish_release** | `true` → after a green build, package and publish a GitHub Release |
| **tag** | Optional. Empty uses `v{package.json version}` |

If the tag does not exist yet, the **release** job creates it on the verified
build SHA and pushes it before publishing.

A thin **Release (redirect)** workflow remains only for old bookmarks: it
forwards to the unified pipeline with `publish_release=true`.

### CI only (no release)

- Push or open a PR against `main` → **build** only.
- Manual run with **publish_release = false** → **build** only on the chosen branch.

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
