# Competitive teardown for S7 (agents) and S5 (tools)

Status: draft · Owner: DESIGN/PRODUCT · Date: 2026-10-31 · Feeds: S7 (#313 on main), S5, S1, S4

How five tools show many agents, costs and approvals, and how their agents find tools. The goal is the IDEAs in §2,
ranked for 1.4/1.5. **Source quality is uneven:** official docs are marked *(docs)*; the rest are third-party
reviews, forums or news. Facts from those are stated as reported, and each IDEA stands on OXESpace's own reasons
too.

## 1. What each tool does

| Tool | Many agents | States and approvals | Cost | Tool discovery |
|---|---|---|---|---|
| **Cursor 3** (Agents Window, Apr 2026) | One sidebar panel collects every active agent session; reported up to 8 parallel background agents [1][2] | Each subagent reports its status separately and can be cancelled alone [2]. A forum report (Jul 2026) shows rows stuck on "Starting up" after the work ended, and a "Stop All" that didn't clear them [3] | — | — |
| **Warp** (Agent Management Panel) | One panel, top right, for local and cloud agents *(docs)* [4][5] | Working, blocked, failed, succeeded, cancelled *(docs)* [5]; agents notify when they need input, for example to approve a command or a diff [4]. Notifications reportedly work only for Claude Code, Codex and OpenCode [6] | — | — |
| **Zed** (Agent Panel) | Threads in a recent dropdown plus a full history *(docs)* [7] | `always_allow_tool_actions: false` asks before edits and MCP calls; an **Ask** profile has read-only tools *(docs)* [7] | **Tokens of the current thread shown next to the profile selector** in the composer *(docs)* [7] | "No tools" label when the model can't call tools [7] |
| **Claude Code Desktop** (redesign, Apr 2026) | A sidebar of parallel sessions and drag-and-drop panes [8][9]; **Agent View (May 2026) groups sessions by state, including "Needs input"** [10] | One developer reports missed approvals costing about 35 % of compute time in a week; anecdotal [11] | Parallel sessions burn the plan quota proportionally faster [12] | **MCP Tool Search**: a light index, with full definitions loaded on demand once MCP tools would take > 10 % of context; the server's `instructions` field becomes the signal for *when* to search [13][14] |
| **Codex app** (macOS, Feb 2026) | Threads by project; **a git worktree per agent**, so they work in parallel without conflicts [15][16] | Sandboxed to folders and branches; network and other elevated actions ask first [16]; **each agent's result is a reviewable diff** to compare, edit, merge or discard; automations deliver into a **review queue** [15][17] | — | — |

## 2. IDEAs, ranked (impact ÷ cost)

| Rank | IDEA | Evidence | Slice | Impact | Cost |
|---|---|---|---|---|---|
| 1 | **Tell agents *when* to use OXESpace's tools, in the MCP server `instructions`.** Claude Code's tool search decides whether to look for a server's tools from that field [13][14]. OXESpace already turns on tool search (1.3.3), **but its MCP bridge answers `initialize` with no `instructions` at all** (`resources/mcp-bridge/oxespace-mcp.cjs:197`; only the vendored codegraph server sends them, `vendor/codegraph/mcp/server-instructions.ts`). One paragraph per group ("use `oxespace_hybrid_explore` before grepping a large repo; `oxespace_code_impact` before a refactor") should raise S5's own exit metric (hybrid/codegraph called > 0 in a recorded task) at no token cost, since instructions load once. | [13][14]; S5 exit check | S5 | **H** | **S** |
| 2 | **A waiting timer, then escalation, for needs-you.** Agent View and Warp both put "needs input" first [5][10]; the missed-approval report [11] shows the cost of a request nobody sees. In the S7 central the needs-you row shows "esperando há 3 min" (already in #313 §5.2). After a set time (default 2 min, with the window not focused) it sends a desktop notification, and a phone push (M6) if a phone is paired. Never an answer, only a nudge. | [5][10][11] | S7 + S4 | **H** | **S** |
| 3 | **Finished = a review, not a dot.** The Codex app turns each agent's result into a diff to merge or discard, and automations land in a review queue [15][17]. In S7, a *finished* row's primary action becomes **Revisar** / **Review**: a drawer with the turn's changes (the existing Changes/ThreadDockChanges view), plus **Abrir no editor** (F33) and, for a worktree, **Integrar** / **Descartar** (existing finish dialog). The central becomes the morning review queue. | [15][17] | S7 (S7.3) | **H** | **M** |
| 4 | **Quota forecast across parallel agents.** Parallel sessions burn the plan proportionally faster [12]; Zed shows per-thread tokens in the composer [7]. The S7 header's "reported" total adds the plan window from the existing "context window and plan allowance" capability: "Com 5 agentes trabalhando, a janela de 5 h acaba em ~40 min" / "With 5 agents working, the 5 h window runs out in about 40 min". A warning state at < 20 %. | [7][12]; capability map | S7 + S5 | **M–H** | **M** |
| 5 | **No stuck rows: state has to be confirmed or say it isn't.** Cursor's reported "Starting up" rows that never clear, and a Stop All that did nothing [3], are exactly what the S7 "Not confirmed" state and the per-source status (#313 §3, §5.3) prevent. Make it an acceptance test: a row with no report within 10 s of a stop shows "Não confirmado", and bulk Stop (v1.1) reports per row. | [3] | S7 (acceptance) | **M** | **S** |
| 6 | **Tool profiles visible in the composer.** Zed's **Ask** profile (read-only tools) and its ask-before-edit switch [7] map onto OXESpace's tool groups (S5) and per-tool rules (B7.3). A chip in the composer, "Perguntar (só leitura)" · "Construir" · "Personalizado", sets both at once and shows what the conversation can do. | [7] | S5 + S1 | **M** | **M** |
| 7 | **One worktree per new agent, by default, from the central.** The Codex app's parallel-without-conflicts rests on a worktree per agent [15][16]; OXESpace already has worktrees and B19's `worktree.include`. "Novo agente" in the S7 central offers "em uma worktree nova" checked by default when another agent already works in the same folder, and the row shows the branch. | [15][16] | S7 + S3 | **M** | **M** |

Rank 1, 2 and 5 fit 1.4 (S, inside slices already planned). 3 fits S7.3 if time allows, else 1.5. 4, 6 and 7 are 1.5
candidates.

## 3. What OXESpace already does better (keep saying it)

- **The person's own Claude and Codex, side by side, locally**, with the phone over local Wi-Fi and no cloud. None
  of the five combines both providers and a phone without a cloud relay.
- **Approvals in-app with risk computed by main** (B10/F18) and a critical hold. The others show approvals, but
  none of these sources documents risk levels.
- **One state vocabulary across modes and the phone** (#313), including an honest "Not confirmed".

## Sources

1. [Cursor 3 review: background agents (DEV)](https://dev.to/jangwook_kim_e31e7291ad98/cursor-3-review-background-agents-and-the-agent-first-ide-7me)
2. [Cursor AI v3 guide: background agents and subagents](https://tutorials.technology/tutorials/cursor-ai-v3-complete-guide-2026.html)
3. [Cursor forum: subagent panel stuck on "Starting up"; Stop All does nothing](https://forum.cursor.com/t/subagent-panel-stuck-on-starting-up-stop-all-does-nothing/166041)
4. [Warp docs: Agents in Warp](https://docs.warp.dev/getting-started/readme/agents-in-warp)
5. [Warp docs: Managing agents](https://docs.warp.dev/platform/managing-cloud-agents/)
6. [The missing layer between you and your AI agent (DEV)](https://dev.to/rohittcodes/the-missing-layer-between-you-and-your-ai-agent-1m01)
7. [Zed docs: Agent Panel](https://git.secluded.site/zed/blob/nightly/docs/src/ai/agent-panel.md?source=1)
8. [MacRumors: Anthropic rebuilds Claude Code desktop app around parallel sessions](https://forums.macrumors.com/threads/anthropic-rebuilds-claude-code-desktop-app-around-parallel-sessions.2481016/)
9. [DEV: Claude Code redesigned its desktop app for parallel sessions](https://dev.to/devtoolpicks/claude-code-just-redesigned-its-desktop-app-for-parallel-sessions-what-changed-and-is-it-worth-it-22d0)
10. [Claude Code desktop redesign review (Agent View)](https://findskill.ai/blog/claude-code-desktop-redesign-review/)
11. [The hidden cost of missed approvals](https://claudepulse-5bw.pages.dev/blog/hidden-cost-of-missed-approvals)
12. [MindStudio: Claude Code usage limits and parallel sessions](https://www.mindstudio.ai/blog/claude-code-usage-limits-parallel-sessions)
13. [VentureBeat: Claude Code gets MCP Tool Search](https://venturebeat.com/orchestration/claude-code-just-got-updated-with-one-of-the-most-requested-user-features)
14. [MCP Tool Search explained](https://claudefa.st/blog/tools/mcp-extensions/mcp-tool-search)
15. [Heise: orchestrating multiple agents with the Codex app](https://heise.de/-11165126)
16. [Interesting Engineering: OpenAI Codex app for multi-agent development](https://interestingengineering.com/ai-robotics/openai-codex-app-multi-agent-software-development)
17. [Gend: OpenAI Codex app, multi-agent command centre](https://www.gend.co/fr/blog/openai-codex-app-multi%E2%80%91agent-command-centre-for-devs)
