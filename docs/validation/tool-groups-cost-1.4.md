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

| Session | What it is offered at start | Fixed cost | Limit in CI |
|---|---|---|---|
| OxeChat, Claude with tool search (default) | every group not off, 72 tools, by name | 3,691 chars, ≈ 923 tokens (names with the `mcp__oxespace-delegation__` prefix) | ≤ 1,500 tokens |
| Code terminal, Claude with tool search | the same plus the code group | under 1,500 tokens | ≤ 1,500 tokens |
| OxeChat, Codex, nothing turned on | core and `oxespace_tools_enable` | under 9,000 chars | ≤ 9,000 chars (as in 1.3) |
| Codex, a group turned on | that group's definitions | per group, above | per-group budget in the test |

**Change from 1.3.** A plain conversation used to receive the core definitions (≈ 6 k characters). Now, with tool search, it
receives every group's names instead, and Claude loads a definition only when it needs it.

## Real session (T6 method), still to run

The CI numbers estimate what is sent. The token counts come from a real session, and that session uses the person's Claude
account, so it is run only with their consent:

1. Start OXESpace from this build and open a project with no `thread.tools` in `oxe.yaml`.
2. In a new OxeChat conversation (Claude), send "Reply OK" and note the first turn's input tokens. They appear in the
   conversation's usage panel (`thread.usageSummary`).
3. In a new conversation, ask for one tool from each group in turn, for example `oxespace_containers_list`,
   `oxespace_documentation_list`, `oxespace_git` and `oxespace_list_agents`. Note each turn's input tokens and the tokens
   added by each loaded definition.
4. Repeat 2 and 3 with Codex. There, each group is turned on with `oxespace_tools_enable`.
5. Record the observed factor of tokens to characters here, next to the estimate above.

| Run | Provider | Plain turn (input tokens) | All groups used (input tokens) | Factor vs estimate |
|---|---|---:|---:|---:|
| _pending_ | Claude | | | |
| _pending_ | Codex | | | |
