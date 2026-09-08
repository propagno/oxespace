# Shared Project Memory

Project memory is optional infrastructure. Worktrees own code changes, Git owns
committed history, and each Claude/Codex process keeps its own native session.
Persistent knowledge belongs to the project, not to a terminal or worktree path.

## Enable in OXESpace

1. Open Workspace Settings → Shared Project Memory.
2. Choose a native AI Memory executable, or explicitly download the pinned 2.1.0
   release. Downloads are verified against the release SHA-256 before extraction.
3. Enable project memory. Separately opt into automatic capture and context.
4. Apply memory settings. The managed service uses authenticated loopback HTTP.
5. Configure Claude / Codex, then open new agent terminals. Review the CLI's hook
   and MCP trust requests. Existing agents do not dynamically reload settings.

Node must be available on the agent's PATH for the lightweight hook/MCP bridges.
No AI Memory browser UI is required. Memory is disabled by default; provider
outages cannot prevent PTY startup. Optional launch setup has a three-second
deadline and does not wait for the memory server. The service starts in the
background and retries startup periodically if its child has exited.

An existing local server can be selected instead. Supply its bearer token and
review its model/provider settings first: OXESpace does **not** control an external
server's privacy policy or terminate that server. Changing the shared runtime
requires closing memory-enabled terminals first. Project toggles are independent.

## Boundaries and ownership

```text
Workspace / related worktrees
  ├─ Git common directory → persistent project UUID in OXESpace SQLite
  ├─ Terminal A → execution capability → native Claude session A
  └─ Terminal B → execution capability → native Codex session B
                         │
                  optional MemoryManager
                         │
                    MemoryProvider
                         │
                   AiMemoryProvider
                         │
               one authenticated local service
```

`memory_projects` maps the canonical `git rev-parse --git-common-dir` to a UUID.
The AI Memory scope is explicitly `oxespace-local/p-<UUID>` on every operation.
Linked worktrees converge on the same identity; unrelated repositories with the
same basename do not. Non-Git folders use their canonical directory. Git errors
other than “not a git repository” fail closed instead of creating a new identity.
Mappings survive workspace deletion, but moving a repository's common directory
or opening an independent clone is not an automatic migration of its knowledge.

An OXESpace execution capability identifies a PTY lifetime; it is **not** an agent
session ID. Native hooks report their own IDs. No active-workspace fallback is
allowed for memory tools. Duplicate native ID claims across executions are
rejected, including a short late-exit grace period. Do not concurrently resume
the same native conversation in two terminals; create independent sessions.

`MemoryManager` provides bounded operations and disabled/unavailable results.
`AiMemoryProvider` contains provider-specific HTTP/MCP contracts. TerminalManager
only exposes generic optional environment/exit callbacks. UI and MCP handlers use
the facade, not AI Memory HTTP directly. Future providers can implement the same
interface; their lifecycle and agent adapters belong in the optional memory layer.

## Capture, context and handoff

The official `install-hooks` command supplies supported event schemas. OXESpace
merges its wrapper into the user's Claude settings and Codex hooks configuration,
preserving unrelated entries and making backups when modifying existing files.
An existing unmanaged AI Memory hook is treated as a migration conflict, not
silently duplicated. Hooks are inert outside an OXESpace execution.

The wrapper forwards **metadata only** to OXESpace. When the project allows
capture, the official `ai-memory hook` helper receives the native payload and
owns sanitization, allowlist policy, durable spool, deduplication, capture and
consolidation. OXESpace does not scrape PTY output or copy transcript files.
Claude assistant capture uses AI Memory's double opt-in mechanism. Codex assistant
final-output capture is not supported by that mechanism; prompt/tool/boundary
events are captured, and agent guidance asks for concise verified learnings at
milestones. Automatic extraction is not a guarantee that every decision or failed
attempt will be retained. No cloud summarizer is configured in managed mode.

Each opted-in checkout receives `.ai-memory.toml` with the explicit scope. Treat
this as machine-local configuration; do not commit it or copy it between unrelated
clones. Existing custom policies are preserved, not overwritten. Nested foreign,
global-recall or ambiguous settings markers fail closed. Simple capture-only
exclusions remain transparent to scope validation. Native capture rules may keep
metadata or drop events; they are not a general secret-detection guarantee.

SessionStart supplies a bounded historical briefing (at most 4,000 characters of
retrieved project context, plus bounded native context). Native startup handoff
delivery is allowed only when both capture and automatic context are enabled:
the upstream `GET /handoff` **consumes** a handoff. With automatic context off,
the wrapper omits native SessionStart; later substantive native events create the
session normally. Routine refresh and context reads use non-consuming history.

Tools exposed through the existing OXESpace MCP bridge:

| Tool | Purpose |
| --- | --- |
| `oxespace_memory_search` | Explicit project-scoped query, at most 8 results |
| `oxespace_memory_remember` | Concise learning, unique page per write |
| `oxespace_memory_sessions` | Recent sessions including open sessions |
| `oxespace_memory_handoffs` | History, questions, next steps and touched files; does not consume |
| `oxespace_memory_accept_handoff` | Explicit acceptance of next eligible checkout handoff |
| `oxespace_project_context` | Relevant memory plus CodeGraph for the execution's checkout |

CodeGraph remains authoritative for the current code; memory is historical,
untrusted evidence. The combined tool has independent source failure handling and
bounded output. It does not build another code index. Handoff history may describe
another worktree: verify changes in Git and explicitly merge/cherry-pick as needed.
Reading a handoff does not transfer code. Native single-use acceptance still obeys
AI Memory's ownership and cwd eligibility; it is not project-wide broadcast.

On PTY exit, native boundary events get a short grace period. The fallback uses
official `finalize-session --session-id <exact observed ID>` with explicit scope
and agent, never `--all`, `--all-owners`, or “latest”. Native non-UUID IDs use the
upstream UUIDv5/OID mapping; actual agent IDs are not rewritten. Failure remains
best effort. A hard app/OS crash can leave sessions open. Windows process shutdown
does not guarantee Unix-style graceful SIGINT; queued native hooks can recover on
later boundaries, but finalization/consolidation is not guaranteed after a crash.

## Privacy and operational limits

- Managed mode uses a dedicated configuration/data directory under
  `<userData>/memory`, strips inherited `AI_MEMORY_*` configuration, disables
  embeddings (`embedding_provider = "none"`) and the auto-improvement scheduler.
  It configures no external model provider. Search is lexical without embeddings.
- Only explicit loopback HTTP URLs are accepted. Tokens are encrypted in OXESpace
  SQLite using Electron safeStorage; native hooks require a plaintext token file
  in the local data directory. Native spool entries can also contain credentials
  and captured content. Protect the entire application data directory with OS
  permissions and disk encryption. Windows permissions use the inherited user
  directory ACL; POSIX file mode alone is not a Windows security boundary.
- The integration does not send project contents during installation. Downloading
  executables contacts GitHub. Explicit context retrieval supplies private content
  to the chosen agent: a cloud-backed Claude/Codex session may send it to its
  vendor. Enabling automatic context is consent for that agent-context flow, not
  for silently adding an external memory summarizer/embedding provider.
- Disabling memory prevents new integration operations; it does not delete past
  knowledge or withdraw events already admitted to the native spool. Hooks and
  marker files remain inert until re-enabled. Runtime files and knowledge are
  retained on disable. No destructive “reset memory” UI is implemented.
- This first integration targets local native Claude Code and Codex. Windows is
  experimental upstream. WSL, SSH/remote execution, automatic identity migration,
  shared multi-user authentication, and managed workstream leases are not enabled.
- Agent CLIs and hooks must be trusted local processes, not hostile tenants.
  OXESpace's existing authenticated local MCP service is not a per-agent OS sandbox.

## Validated contracts and sources

Source review: AI Memory commit
[`f616c764baef85eb3a9d8743ba33832726fb7260`](https://github.com/akitaonrails/ai-memory/tree/f616c764baef85eb3a9d8743ba33832726fb7260).
Executable contract tests use the published
[`v2.1.0`](https://github.com/akitaonrails/ai-memory/releases/tag/v2.1.0) release.
The reviewed tree reports 2.1.1; binary tests are necessary because the tree and
published executable are not assumed identical.

- CLI: `serve --transport http --bind ... --enable-web`, `install-hooks`, `hook`,
  and `finalize-session`; see
  [CLI implementation](https://github.com/akitaonrails/ai-memory/blob/f616c764baef85eb3a9d8743ba33832726fb7260/crates/ai-memory-cli/src/cli.rs).
- Health: `/admin/status`; MCP: `/mcp`, tools `memory_write_page`, `memory_query`,
  `memory_recent`, `memory_handoff_accept`. No invented `/health` endpoint.
- REST: `/api/v1/workspaces/{workspace}/projects/{project}/sessions` with
  `include_open=true`, and `/handoffs`; see
  [web API implementation](https://github.com/akitaonrails/ai-memory/blob/f616c764baef85eb3a9d8743ba33832726fb7260/crates/ai-memory-web/src/routes/api.rs).
- Codex's MCP `env_vars` allowlist forwards invocation variables rather than
  baking one project's credentials/identity into global config, as specified by
  [official OpenAI MCP documentation](https://learn.chatgpt.com/docs/extend/mcp?surface=cli).

## Verification

Use Electron's native-module ABI for tests:

```powershell
npm run typecheck
npm run test:electron
npm run build

# Optional: checksum-verify/download the native release first; never points at a live user server.
$env:OXESPACE_AI_MEMORY_TEST_BINARY = 'C:/path/to/ai-memory.exe'
npm run test:electron -- tests/integration/ai-memory.native.test.ts tests/integration/memory-runtime.native.test.ts tests/integration/memory-adapters.native.test.ts
```

Fixtures use temporary projects, private temporary databases, loopback servers and
synthetic prompts. Tests cover JWT continuity from Claude to Codex, simultaneous
native sessions, real Git worktree identity, project/global isolation, unavailable
providers and PTY fail-open behavior, hook config preservation, exact-session
finalization, non-consuming handoff reads, and owned/external runtime lifecycle.
These are real AI Memory protocol/hook tests, **not** full paid/model-driven Claude
and Codex conversations. CLI permission/trust UX still needs an interactive smoke
test on each supported agent/environment.

### Validation snapshot — 2026-09-08

The full Electron test suite passed: **112 files, 717 tests passed, 4 skipped**,
including opt-in tests against AI Memory 2.1.0. TypeScript checking and ESLint on
the integration files passed. Production builds passed the bundle-size budgets.
The CSS minifier still reports an unrelated `:visible:is()` selector warning.
The real native wrapper, authenticated service lifecycle, persistence across a
server restart, and cross-project concurrent automatic capture were exercised
with synthetic data. No real agent conversations or user home hook configurations
were used by these tests.
