# Tool groups on demand: cost (T8, 1.4)

What OXESpace's MCP tools cost a session after B7.2 (groups on demand) and B2.2 (the same groups in Code terminals).
The CI part is `tests/integration/thread-mcp-budget.test.ts`, which uses the same measure as Settings › Tools
(`toolDefinitionChars` and `toolNameChars` in `electron/main/mcp-internal/tool-cost.ts`).

## Measured in CI (characters; tokens ≈ characters / 4, an estimate)

| Group | Tools | Definitions | Names only |
|---|---:|---:|---:|
| core | 12 | 5,978 | 295 |
| orchestration | 21 | 12,187 | 551 |
| data | 12 | 6,033 | 290 |
| docs | 10 | 3,931 | 311 |
| app | 17 | 19,286 | 376 |
| team (role) | 4 | 1,639 | 98 |
| worker (role) | 13 | 4,515 | 365 |
| code (Code terminal) | 16 | 10,332 | 395 |

Measured on 2026-10-30 on `be/mcp/b7-2-tools-on-demand` (B7.2 and B2.2).

| Session | What it is offered at start | Fixed cost (CI, characters) | Checked in CI |
|---|---|---|---|
| OxeChat, Claude with tool search (default `ENABLE_TOOL_SEARCH=true`) | every group not off, 72 tools, by name | 3,691 (names with the `mcp__oxespace-delegation__` prefix) | less than core's definitions (5,978) |
| Code terminal, Claude with tool search | the same plus the code group | names only | less than core + code definitions |
| OxeChat, Codex, nothing turned on | core and `oxespace_tools_enable` | 6,386 | ≤ 9,000 (as in 1.3) |
| Codex, a group turned on | that group's definitions | per group, above | per-group budget in the test |

## Real session (T6 method), 2026-10-30

How it was measured:
- **Isolation.** A temporary folder, with no MCP server of the person's (`--strict-mcp-config`). The OXESpace bridge ran with the exact arguments the app passes, against a local stub that serves the real `TOOL_REGISTRY` definitions, so no app data was involved.
- **Versions.** Claude Code 2.1.314 and Codex CLI 0.155.1, signed in as the person, with their consent.
- **What is counted.** Input tokens of the first model call, including cache writes and reads. The prompt was "Reply with exactly: OK" unless stated.
- **Codex model.** Codex ran with `-m gpt-6-luna`. The default in the person's config (`gpt-6-astra`) is refused for a ChatGPT account, and the config itself was not changed.

### Claude

| Run | Input tokens | Difference |
|---|---:|---|
| No OXESpace tools, `ENABLE_TOOL_SEARCH=auto:5` | 45,396 | baseline |
| 1.3 behaviour: core loaded (12 tools) | 48,124 | **+2,728** (5,978 chars → 2.19 chars/token) |
| Every group, tool search off | 65,271 | +19,875 (47,411 chars → **2.39 chars/token**) |
| Every group, `auto:5` | 67,124 | **+21,728: nothing was deferred** |
| No OXESpace tools, `ENABLE_TOOL_SEARCH=true` | 30,079 | baseline with search on |
| Every group, `ENABLE_TOOL_SEARCH=true` | 31,765 | **+1,686** for the 72 deferred names (3,691 chars → 2.19 chars/token) |
| Five tools from five groups, loaded by search and called, `true` | 98,761 in 7 calls | cumulative input of the whole task |
| The same task with `auto:5` | 135,075 in 6 calls | the model said the tools "were already loaded" |

**What this changed:**
- **The default is now `true`, not `auto:5`.** `auto:N` defers only above N % of the context window, and on today's large windows our 20 k tokens of definitions never reach it. A plain conversation would have paid about 21.7 k tokens instead of 2.7 k.
- **What `true` costs.** It offers every group for 1,686 tokens, less than 1.3 paid for core alone.
- **Who it applies to.** A value the person sets is kept. `auto:N` and `false` get the plan without tool search: `always` groups at start, the others through `oxespace_tools_enable`.
- **Tokens versus characters.** The estimate in Settings › Tools (characters / 4) is low. Definitions run at **2.4 characters per token**, and the deferred names at **2.2**.
- **Side effect of `true`.** Claude Code also defers some of its own tools, so a plain conversation dropped from 45,396 to 30,079 input tokens.

### Codex

| Run | Input tokens | Note |
|---|---:|---|
| No OXESpace tools | 19,958 | baseline |
| Core and `oxespace_tools_enable` | 19,880 | no increase: this Codex version does not send MCP definitions up front |
| "Turn on data, then list containers" | 80,482 across the turn | the enable call was **refused**: "MCP tool call requires approval, but approval policy is never" |

**Second run, with `oxespace_tools_enable` marked `readOnlyHint: true`:**
- Codex ran the enable call **without asking for approval**. It is read-only for real: it changes nothing outside the session, and the tools it lists keep their own level and approval.
- Codex **did not reload its tool list** after `notifications/tools/list_changed`, so `oxespace_containers_list` stayed out of reach in that session (126,080 input tokens across the turn, 82,432 of them cached).
- So in this Codex version, turning a group on in the middle of a session does not work yet. Since Codex also sends no MCP definitions up front (the plain run above), offering every group that is not off costs Codex nothing at start. That is the proposed plan for Codex, pending the coordinator's decision.

**What the first run showed:**
- **Turning a group on needs approval.** Codex asks the person to approve each MCP call, `oxespace_tools_enable` included, even though it only changes the tool list. So the cost of one group turned on could not be measured without loosening approvals, and that was not done.
- **Follow-up for B7.2.** Mark `oxespace_tools_enable` read-only for Codex, through the `readOnlyHint` annotation, if Codex honours it, or document that it asks for approval. Then repeat the "data on" run.
