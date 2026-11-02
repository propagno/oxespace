# Compatibility policy for 1.0

> **Status: draft.** This is a proposal written from what the code does today. Nothing
> here is a promise until it is approved and the status line is changed. Items marked
> **Decision** need an owner's answer before 1.0.

Today the project follows semantic versioning with major version `0`: a minor release
may change behaviour and storage, and the release notes say so
([Platform specification](PLATFORM_SPEC.md#11-versioning)). A `1.0` is the point where
the rules below start to bind.

## 1. What counts as a breaking change

After `1.0`, a change is breaking, and needs a new major version, when it does any of
these for an installation that works today:

| Surface | Breaking means |
|---|---|
| Local database | An upgrade that loses or rewrites user data without a verified backup, or a migration that cannot run on a database created by any `1.x` release |
| Internal MCP tools (`oxespace_*`) | Removing or renaming a tool, removing an input field, or changing the meaning of a result field. Adding a tool or an optional field is not breaking |
| Permission rules (`/rules`) | A stored rule that stops matching what it matched before, or starts allowing more |
| Settings and workspace layouts | A stored setting or layout that no longer loads |
| Exported files (CSV, JSON, NDJSON, SQL, documentation export) | A change to the format without a documented migration |

Not covered: visual design, copy, keyboard shortcuts that are not documented as stable,
and anything labelled **Beta** or **Initial** in the
[maturity table](PLATFORM_SPEC.md#4-capabilities). Beta features may change in a minor
release, and the release notes say so.

## 2. Database

What the code guarantees now (`electron/main/db/index.ts`):

- Migrations only move forward.
- A verified backup (`integrity_check` passed) is taken before every migration, the five
  most recent are kept, and the upgrade stops if a backup cannot be made.
- A database written by a newer version is refused, not opened.

Proposed for `1.0`:

- Keep all of the above.
- **Decision:** whether a user-facing "restore a backup" action ships with `1.0`. Today the
  backup exists but restoring it is a manual file operation.
- Downgrades stay unsupported. The documented path is to restore the pre-upgrade backup
  with the older version.

## 3. Support window

**Decision:** how long an old `1.x` receives fixes. Suggested starting point: only the
latest minor of the latest major receives fixes, and security fixes are applied to the
previous minor for 90 days. Update checks are the delivery mechanism
([Updates and channels](PLATFORM_SPEC.md#8-updates-and-channels)).

The Electron runtime must stay inside its support window, which CI already enforces
(`scripts/check-runtime-support.mjs`). That check is the reason a security-only release
can force a runtime bump.

## 4. Supported agent CLI versions

OxeChat talks to the Claude Code and Codex CLIs, which change independently of OXESpace.

What has been verified, with the date and the report:

| CLI | Version | What was checked | Report |
|---|---|---|---|
| Claude Code | 2.1.296 | Protocol probe (`verify:claude-protocol`) | [Thread release readiness, 2026-10-12](validation/thread-release-readiness-2026-10-12.md) |
| Codex | 0.155.1 | Resume pilot with short turns and restarts | [Release 0.16.0-beta.6](validation/release-0.16.0-beta.6.md) |

Neither covers a full authenticated session across a long run on the installed build.

Proposed for `1.0`:

- State in each release note the CLI versions that were verified for that release.
- Treat a newer CLI as unverified rather than unsupported: OXESpace shows a notice and
  keeps working where the protocol still matches.
- **Decision:** the minimum supported version of each CLI, and who re-runs the probe when
  a CLI releases.

## 5. Platforms

`1.0` as drafted covers **Windows 10 or later (x64)** and **Linux x64** (AppImage and
`.deb`). macOS and ARM are not published.

**Decision:** keep that as the `1.0` statement, or hold `1.0` until macOS exists.

## 6. What `1.0` does not promise

- That the Windows installer is code-signed. Today it is not; the README and the
  platform specification say so.
- That Beta features (project memory, OxeQuery, Agent Work) are stable.
- Behaviour that comes from a provider: rate limits, tool rules and authentication
  refresh are outside OXESpace's control.

## 7. Change log of this document

| Date | Change |
|---|---|
| 2026-10-14 | First draft. |
