# Release pipeline

The GitHub Actions release workflow is intentionally stricter than a local
development build. A tag only becomes public after validation, artifact
verification, a draft-release download check, and explicit release publication.
It uses the repository's built-in GitHub Actions token and needs no release
secrets or protected Environment configuration.

## Release procedure

1. Update `package.json` and `package-lock.json` to `X.Y.Z`.
2. Commit the release changes and create the matching tag: `vX.Y.Z`.
3. Push the tag. The workflow rejects a tag that does not match the package
   version or checkout commit.
4. The workflow creates a draft release, downloads it again, validates the
   installer, updater manifest and SHA-256 checksums, then publishes it.

For prereleases, use a semver prerelease tag such as `vX.Y.Z-beta.1`. The
builder produces a channel-specific updater manifest (`beta.yml`) instead of
replacing the stable `latest.yml` feed.

## Published release payload

Every Windows release contains:

- `OXESpace-X.Y.Z-x64.exe`
- `OXESpace-X.Y.Z-x64.exe.blockmap`
- `latest.yml` for stable releases or `<channel>.yml` for prereleases
- `SHA256SUMS.txt`
- `sbom.spdx.json` with production dependencies

Consumers can independently compare `SHA256SUMS.txt` before installation.
