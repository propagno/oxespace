# Threat model: OWASP Agentic Top 10 (ASI01 to ASI10)

Roadmap S10. Target: OXESpace 1.4. Part of [SECURITY_MODEL.md](../SECURITY_MODEL.md).

The ASI names below follow the OWASP Top 10 for Agentic Applications as the author recalls it; check them against the
current OWASP text before quoting this page outside the repository. Every file path written in code font in this page
is checked to exist by `tests/threat-model-refs.test.ts`. A control marked "not on main" lives in an open pull request and
is written without code font so that check does not pass for it.

## What OXESpace is, for this model

OXESpace does not run a model. It starts the Claude Code and Codex CLIs (Code panes, Thread mode), hooks, and MCP
servers, and it exposes its own MCP server to them. The agent has the same OS user as the app. So:

- The boundary OXESpace can enforce is **what it launches, what it answers on the agent's behalf, and what its own
  tools and IPC accept**. It cannot see inside a CLI (what the CLI reads, runs without asking, or sends over the network).
- There is **no OS-level sandbox and no network control today**. Anything an agent CLI runs without raising an approval
  runs with the user's rights. That is the largest residual risk and the reason S3 and S4 exist.

## Summary

| ID | Risk | Strongest control today | Residual gap | Next |
|---|---|---|---|---|
| ASI01 | Agent goal hijack | Approvals, fenced untrusted output, guarded steering files (not on main) | The CLI reads untrusted text with its own tools | Test below; S3 |
| ASI02 | Tool misuse | Policy `tool.use`, shell risk, internal MCP levels | Tools a CLI runs without asking are unseen | S3 |
| ASI03 | Identity and privilege abuse | Env scrubber, per-execution tokens, user-only approvals | Provider credentials stay in the CLI's reach | S7 (this PR is slice 1) |
| ASI04 | Supply chain | MCP trust and `trusted` sync filter; quarantine (not on main) | Floating `npx` versions, skills | S5/S6 PR; policy `mcp:` |
| ASI05 | Unexpected code execution | Shell parsing and risk, path safety | No sandbox; hooks run repository scripts | S3 |
| ASI06 | Memory and context poisoning | Memory fence, redaction before capture, `memory` policy | The fence is heuristic | `tests/unit/memory-fence.test.ts` |
| ASI07 | Insecure inter-agent communication | Coordinator authorization, per-execution lease | Bindings are in memory only | `coordination.authorization.test.ts` |
| ASI08 | Cascading failures | Rate limits, bounded results, idle suspension | No global spend or fan-out cap | Gap, no item yet |
| ASI09 | Human-agent trust exploitation | Approval cards carry the reason; user-only capabilities | Wording is not tested adversarially | Gap, no item yet |
| ASI10 | Rogue agents | Audit export, policy `provider.use`, stop controls | No behavioral detection | Gap, no item yet |

## ASI01 Agent goal hijack

Threat: text the agent reads (web page, issue, repository file, MCP result) redirects it.

Controls in the repository:
- Approvals for edits and commands raised by the CLI are answered by OXESpace only toward "ask" or "deny", never
  widened: `electron/main/services/conversation/kernel/permission-policy.ts` (comment: "can narrow what runs but never widen it").
- Output of OXESpace's own MCP tools that comes from outside the project is bounded: `electron/main/mcp-internal/tool-result-bound.ts`.
  Database rows returned to an agent are labelled untrusted, bounded and masked: `electron/main/services/oxequery/agent-output.ts`.
- Memory text is neutralized and fenced before reaching a prompt: `shared/memory-fence.ts` (`looksLikeInstruction`, `fenceMemory`).
- Not on main (PR #144): protected-config.ts always asks before an agent edits AGENTS.md, CLAUDE.md, .mcp.json and similar,
  and untrusted-output.ts fences background job, terminal and preview output.

Gap: a CLI reading a hostile web page or file with its own tools is not visible to OXESpace. Fences are advisory text,
not a boundary. Tests: `tests/shell-risk.test.ts`, `tests/thread-permissions-panel.test.tsx`; the S5 tests arrive with PR #144.
Roadmap: S3 limits the damage when a hijack succeeds; nothing prevents the hijack itself.

## ASI02 Tool misuse and exploitation

Controls:
- Policy `tool.use`, `provider.use`, `integration.use` (`mcp:`, `skill:`, `db:`, `memory`, and now `env:` and `net:`), `db.write`:
  `shared/policy.ts`, `electron/main/services/policy/policy-store.ts`, `docs/POLICY.md`. The managed layer has the last word.
  Claude also gets exact tool denials as `--disallowedTools`.
- Shell commands are parsed and graded green, orange or red; risky ones always ask: `electron/main/services/conversation/shell-parse.ts`,
  `electron/main/services/conversation/shell-risk.ts`, `electron/main/services/conversation/shell-command-rules.ts`.
- The internal MCP server gives every capability a level (`read`, `write`, `confirm`) and a registry that must cover
  every app capability: `shared/mcp-coverage.ts`, test `tests/mcp-coverage.test.ts`. OxeQuery calls go through one gateway with
  per-connection access (off by default), per-call approval bound to the SQL hash, and a rate limit of 30 per minute:
  `electron/main/services/oxequery/agent-gateway.ts`.

Gap: built-in CLI tools that run without asking (Codex, or Claude in an accept-edits mode) are not seen; POLICY.md says so.
Tests: `tests/policy.test.ts`, `tests/shell-risk.test.ts`, `tests/integration/oxequery-agent.test.ts`. Roadmap: S3.

## ASI03 Identity and privilege abuse

Controls:
- Approvals, access level, sign-in, tokens, secrets and MCP trust are user-only. `shared/mcp-coverage.ts` lists
  `FORBIDDEN_CAPABILITIES` and the name and argument patterns (`FORBIDDEN_NAME`, `FORBIDDEN_ARGUMENT`) that keep them out of MCP tools.
- Internal MCP and local RPC use bearer tokens compared in constant time: `electron/main/mcp-internal/local-rpc-server.ts`,
  `electron/main/services/execution-registry.ts` (per-execution, per-workspace tokens that vanish on restart).
- Third-party secrets use `safeStorage` (`secure_credentials`); logs, diagnostics and exports pass `redactSecrets` in `shared/secrets.ts`
  (test `tests/secrets.test.ts`).
- Thread subprocesses never inherit the host's provider API variables or OXESPACE_ context: `subscriptionEnvironment` in
  `electron/main/services/conversation/process-transport.ts` (test `tests/native-account.test.ts`).
- **New (S7 slice 1):** Code panes that launch `claude` or `codex`, repository hooks and MCP servers started by the app no longer inherit
  secret-looking variables (names with TOKEN, SECRET, KEY, PASSWORD, CREDENTIAL, AUTH, and known cloud and CI names). A provider keeps only
  its own auth variables. The person opts a variable in with a policy rule `allow integration.use env:<NAME>`. Names withheld show in
  diagnostics (names only). Code: `shared/env-scrub.ts`, `electron/main/services/policy/index.ts` (`inheritedEnvironment`).
  Tests: `tests/env-scrub.test.ts`, `tests/integration/terminal.service.test.ts`.

Gap: the provider's own credentials stay in the environment of its CLI, and the agent can read them. Plain shell panes and other agent
CLIs (Gemini, Copilot and so on) keep the full environment because that is the person's own shell. Delivering secrets per task from the OS
vault is not done. Roadmap: S7 (remaining slices).

## ASI04 Agentic supply chain

Controls: only servers marked enabled and trusted are synchronized to clients (`electron/main/services/mcp-sync.service.ts`); an untrusted
server cannot carry sensitive env (`electron/main/services/mcp.service.ts`, `validateConfig` rejecting token, secret and key names); policy
`mcp:` and `skill:` rules. Not on main (PR #144): pinning by hash, tool fingerprint, quarantine, description scan.

Gap: a trusted server started with `npx` without an exact version changes with each release. Agent skills loaded by the CLI itself are
only blocked via `tool.use Skill`. Tests: `tests/policy.test.ts`; S6 tests with PR #144. Roadmap: S5/S6.

## ASI05 Unexpected code execution

Controls: shell command analysis as in ASI02; every path an approval touches is checked against the workspace root with symlink and
junction resolution: `electron/main/services/conversation/path-safety.ts` (test `tests/path-safety.test.ts`) and, for the file API,
`electron/main/services/file-system.service.ts`. Raw `fs` imports are allowlisted with a reason per file:
`tests/integration/fs-allowlist.test.ts`. Containers run through `execFile` with argument arrays, never shell strings.

Gap: repository hooks (`electron/main/services/repo-config/hook-runner.ts`) run scripts with the user's rights; they are gated by a
person's approval and, since this PR, receive a scrubbed environment, but they are not sandboxed. Nothing sandboxes commands an agent
runs. Roadmap: S3 (macOS seatbelt, Linux Landlock, Windows job objects or AppContainer).

## ASI06 Memory and context poisoning

Controls: `shared/memory-fence.ts` neutralizes instruction-like text and caps each item; shared memory is captured after `redactSecrets`;
the `memory` policy resource turns it off per project, user or machine; erase-all in Settings. Tests: `tests/secrets.test.ts` plus `tests/unit/memory-fence.test.ts`.

Gap: the fence is a heuristic; a well-phrased note passes. Project steering files are covered only by the PR #144 guard. Roadmap: none
beyond S5.

## ASI07 Insecure inter-agent communication

Controls: delegation and team messaging go through the coordinator, which checks authorization before binding an execution to a task
(`electron/main/services/coordination/authorization.ts`, `electron/main/services/coordination/team-access.ts`). Bindings vanish on restart and a
native conversation id confers no access. Tests: `tests/integration/coordination.authorization.test.ts`, `tests/integration/delegation.test.ts`.

Gap: messages between agents are text and are not fenced as untrusted data when they reach another agent. Roadmap: add the S5 fence to
inbox reads (not scheduled).

## ASI08 Cascading failures

Controls: bounded tool results, message size limits (`shared/threadLimits.ts`), the OxeQuery rate limit and row caps, idle suspension of
Threads, and a runtime flight recorder with bounded size (`electron/main/services/runtime-diagnostics.ts`).

Gap: no cap on delegation fan-out depth or on total spend per project. Roadmap: none yet.

## ASI09 Human-agent trust exploitation

Controls: approval cards state the reason and the narrowest rule to remember; protected files allow a single approval only (PR #144);
Full access never answers a protected-file approval. Approval is never an MCP tool (`FORBIDDEN_CAPABILITIES`).

Gap: an agent can still write a persuasive justification in its own message. No adversarial wording test exists. Roadmap: none yet.

## ASI10 Rogue agents

Controls: the audit export (`electron/main/services/oxequery/audit-log.ts`, Thread permission decisions, agent action audit) with 90 days'
retention; `provider.use` blocks a provider; stop and cancel controls on every pane and Thread.

Gap: no detection of unusual behavior; the audit is read after the fact. Network egress is unrestricted until S4 is enforced.

## S4 slice 1: what exists for network control

- Policy resource `net:<domain>` (action `integration.use`) is parsed and evaluated: `shared/net-policy.ts` (`decideNet`). The default is
  **allow**, as before. `decideNet(policy, host, 'deny')` already implements the default-deny rule (only an explicit `allow` reaches a host),
  but nothing calls it with `'deny'`.
- `classifyNetworkUse(command)` reports whether a command line is likely to use the network (curl, wget, `git clone/fetch/pull/push`,
  `npm|pnpm|yarn install`, `pip install`, ssh and similar) and the literal hosts it names. It is a classifier for a future prompt, not a
  parser: `none` means "not recognized", not "safe". Tests: `tests/net-policy.test.ts`.
- **Nothing is enforced.** A rule `deny net:evil.test` changes no behavior yet. Enforcement needs S3: an application-level check cannot
  see what a CLI's own tools connect to. The order of work is S3 (sandbox), then S4 enforcement using this classifier for the prompt and
  `decideNet` for the decision, then more of S7.

## Remote gateway (B9): what reaches the phone

- Text sent to the phone is filtered on the desktop: `electron/main/services/remote/filters.ts`, `electron/main/services/remote/text.ts`.
  Secrets are redacted with the shared patterns (`shared/secrets.ts`). A path under a registered workspace or project root goes out relative;
  every other absolute path (POSIX, another drive, UNC, `~`, `file:`) is replaced. Tests: `tests/unit/remote-text-filters.test.ts`.
- Terminal output is redacted over a sliding window per subscription, so a secret split across two output batches is still caught. Output
  is held until it can be released safely, at most 250 ms (the flush timeout). The phone's terminal is read only and the M4 target is
  under 300 ms on the LAN, so this latency is accepted in exchange for the redaction.
- **Accepted risk:** a secret whose two halves are printed more than 250 ms apart is flushed in two parts, and each part may not match a
  pattern alone. Holding output longer would leave the phone's terminal stuck. Decided by the 1.4 coordinator; revisit if a stream
  format that prints secrets slowly (for example, character by character) turns up.
- The first terminal snapshot can be empty while output is held; the phone shows it as loading, not as an empty terminal.

## Open items

1. S3 sandbox (the single largest gap: ASI01, ASI02, ASI05, ASI10).
2. S4 enforcement and prompt.
3. S7: vault delivery per task; opt-in UI (today the opt-in is a rule in `policy.json`, and Settings › Policy lists it read only).
4. ASI07 fencing of inter-agent messages; ASI08 fan-out and spend caps; ASI09 adversarial wording tests; ASI10 detection.
