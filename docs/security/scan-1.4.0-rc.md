# Secrets and dependency scan — 1.4.0 RC (release gate G7)

Date: 2026-11-01 · commit scanned: `origin/main@abe6f62c` · owner: SRE/DEVOPS. Gate: "secrets and dependency scan
with no critical finding" (`.claude/roadmap-1.4/team/release-gate.md`, G7). **Rerun on the candidate commit** before
the RC: the commands are below.

## Result

**No critical or high finding.** One medium finding, a local MCP token in the public history. Removing the tracked
file is done in this PR; rotating the token is the user's.

| Area | Tool | Result |
|---|---|---|
| Secrets, current alerts | GitHub secret scanning + push protection (on) | 0 alerts, open or closed |
| Secrets, whole history | gitleaks 8.30.1 over the 1,176 commits of main | 12 hits: **7 are one real token** (S-1), **5 are test fixtures** (S-2) |
| npm, production dependencies | `npm audit --package-lock-only --omit=dev` | 0 vulnerabilities |
| npm, all (dev included) | `npm audit --package-lock-only` | 26 moderate, 0 high, 0 critical (dev and build tools only, not shipped) |
| Dependabot alerts | GitHub | **off** for the repository (`Dependabot alerts are disabled`, HTTP 403): no continuous alerts |
| Dependency review on PRs | `dependency-review.yml` (#393) | advisory until the Dependency graph is on |
| Android (Gradle) | — | **Não verificável** here: no Gradle scanner ran. Turning on the Dependency graph and Dependabot covers it (decisions.md #13). |
| Code scanning (CodeQL) | — | not set up (wave 2) |

## Findings

**S-1 · Medium · `OXESPACE_MCP_TOKEN` in the history.** `.mcp.json` (commits `543c9ad5`, `2418c6cf`, `53db19ab`,
`02347129`, `24427af3`, `7322a134`, June 2026) and `scripts/.mcp.json` (`543c9ad5`, still tracked on main) hold the
internal MCP server's bearer token from a dev machine, next to its port and a dev path.
- *What it opens:* the internal MCP server of that one installation, which listens on localhost only. Someone would
  need to run code on that machine to use it, and such code can already read the token from the app's database.
- *Why it still matters:* the token lives in the database (`internal_mcp_meta`) until it is regenerated
  (`electron/main/mcp-internal/bootstrap.ts`, `regenerateToken`), so a token from June may still be valid there.
  Whether it is: **Não verificável** (reading the live database is off limits).
- *Fix:* this PR removes `scripts/.mcp.json` from the repository. `.gitignore` already ignores `.mcp.json` in every
  folder; this copy was committed before that rule. **User:** regenerate the internal MCP token once in the app, which makes every copy
  in the history useless. Rewriting history isn't worth it for a token that is rotated this way.

**S-2 · None · test fixtures.** `tests/diagnostics-bundle.test.ts`, `tests/secrets.test.ts`,
`tests/unit/remote-gateway-parts.test.ts`, `tests/unit/oxepost-import.test.ts`,
`tests/integration/memory-control.test.ts`: fake keys built in the test (e.g. `'sk-ant-api03-' + 'Q7'.repeat(24)`),
used to prove that redaction works. No action.

## How to rerun (read-only, no secrets needed)

```sh
# history: gitleaks from its GitHub release, checksum checked against the release's checksums.txt
gitleaks git --no-banner --redact --report-format json --report-path gitleaks.json --log-opts="<candidate sha>" .
npm audit --package-lock-only --omit=dev          # shipped dependencies: must be 0 high/critical
npm audit --package-lock-only                     # all: high/critical must be 0
gh api repos/propagno/oxespace/secret-scanning/alerts --jq 'map(select(.state=="open"))|length'   # must be 0
```

## User decisions this depends on (decisions.md)
- #13: turn on the Dependency graph, Dependabot alerts and Dependabot security updates. Then the dependency review
  becomes a blocking check (one-line PR) and Gradle dependencies are covered.
- S-1: regenerate the internal MCP token once.
