# Security model

OXESpace intentionally gives local development agents powerful access. Its security boundary is therefore the selected workspace plus explicit user trust, not an assumption that agent input is safe.

## Trust boundaries

- The renderer is untrusted web content relative to the Electron main process. Browser windows run with context isolation and sandboxing; privileged operations use the typed preload bridge.
- A workspace ID is authoritative. Filesystem requests cannot substitute an arbitrary root, and canonical real paths are checked to prevent `..`, symlink and junction escapes.
- MCP configurations are executable integration settings. Only servers marked both enabled and trusted are synchronized to clients.
- Web Preview is local-only by default. Remote HTTP(S) origins require an explicit opt-in and receive a warning. Electron response-header rewriting is limited to loopback traffic.
- Web Preview renders in a `<webview>` guest, not an iframe — Design Mode has to inject a preload into the previewed page, which a cross-origin iframe cannot carry. The guest is strictly more powerful than the iframe it replaced, so its restrictions are explicit rather than inherited:
  - `will-attach-webview` pins the guest preload, forces `nodeIntegration: false` / `contextIsolation: true` / `sandbox: true`, and rejects any `src` that is not `http(s)`.
  - The guest is forced into an in-memory partition (`oxe-webpreview`), so preview cookies and storage never touch the app session. The partition is set in the main process, not trusted from the renderer.
  - That session grants no permissions, blocks downloads, and strips the `Referer` header — preserving the `no-referrer` guarantee the previous sandboxed iframe had.
  - Guests cannot open windows; `window.open` is denied and safe external URLs are handed to the OS browser.
- The Design Mode guest script only reads from the previewed page and posts the selection to the host. Nothing reaches an agent until the user reviews the captured payload in the confirmation sheet and sends it explicitly.
- Third-party integration credentials (Linear) are encrypted with Electron `safeStorage` in the `secure_credentials` table and never cross IPC back to the renderer; when OS encryption is unavailable the row is flagged and the UI warns instead of silently storing plaintext.
- The local RPC bus (F3) listens on a per-user named pipe / unix socket — never a TCP port — requires a bearer token compared in constant time, and publishes its endpoint only to `<userData>/rpc-endpoint.json`.
- External URLs are accepted only through explicit protocol/host validation and are opened by the main process.

## Filesystem invariant

For every filesystem operation:

1. Resolve the workspace ID from SQLite.
2. Reject a caller-provided root that differs from the stored root.
3. Resolve the requested path relative to that root.
4. Canonicalize existing path segments using `realpath`.
5. Reject the operation unless the canonical target is the root or a descendant.

Do not add direct `fs` access to renderer code or bypass `FileSystemService` from a new IPC handler.

## Secrets and diagnostics

Internal MCP bridge tokens are local secrets. Generated `.mcp.json` files are ignored by Git. Logs and exported diagnostic reports must not include tokens, authorization headers, or an absolute user-home prefix. `DiagnosticsService` applies bounded log reads and redaction before export; add new secret formats to its tests when integrations evolve.

## Dependency and release controls

Production dependency advisories are checked with `npm audit --omit=dev`. Transitive security fixes may be pinned through `overrides`, with the lockfile committed. CI builds from a fixed commit, verifies native binaries, enforces bundle budgets, and generates checksums and an SBOM for releases.

## Reporting a vulnerability

Do not place credentials, exploit details or private workspace data in a public issue. Contact the maintainers privately through the repository security channel and include the affected version, reproduction conditions and expected impact.
