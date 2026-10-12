# Security policy

## Supported versions

Security fixes are made on the latest **stable** release and, while one exists,
the latest **beta**. Older versions are not patched; update through the
application or the [Releases](https://github.com/propagno/oxespace/releases) page.

## Reporting a vulnerability

Please **do not open a public issue** for a security problem.

Use GitHub's private reporting: open the repository's **Security** tab and choose
**Report a vulnerability**. Include:

- the OXESpace version and platform (the installer name or the version shown next to the title bar);
- what you did, what you expected and what happened;
- the impact you believe it has (for example *reads files outside a workspace*);
- a minimal reproduction, if you have one.

Do not include real credentials, tokens or private repository contents. If a
secret was exposed while reproducing the issue, rotate it.

You can expect an acknowledgement within a few days and a fix or a clear
mitigation plan for confirmed issues. Reporters are credited in the release
notes unless they prefer otherwise.

## Scope

In scope: the OXESpace application and its release artifacts — the renderer and
preload boundary, file access confinement, terminal and agent launch, MCP
export and trust, the updater, Web Preview isolation and the internal MCP bridge.

Out of scope: vulnerabilities in the agent CLIs (Claude Code, Codex), in
third-party MCP servers you add, or in GitHub itself — report those to their
owners. Issues that require an already-compromised user account or machine are
generally out of scope.

## How the application defends itself

The trust boundaries, the file-system invariant, how secrets and diagnostics
are handled and the controls applied to dependencies and releases are described
in [docs/SECURITY_MODEL.md](docs/SECURITY_MODEL.md).
