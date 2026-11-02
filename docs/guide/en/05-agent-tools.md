# OXESpace's tools for your agents

> Claude and Codex use OXESpace's tools when they help, and you see which are on and what they cost.

<!-- About this page: Slice S5 · Filled by: BACKEND · Items: B7.2, B7.3, F10, B7, T8, B24, B25 · partial: written from what is on main on 11/01 (groups and modes in oxe.yaml, on demand, semantic search per project). Settings › Tools (F10, #210), the turned-off group refusal (B24, #358) and the Node.js-not-found notice (B25) join when they reach main. -->

Also in: [pt-BR](../pt-BR/05-ferramentas-dos-agentes.md)

## What you can do

- Which tools each conversation gets
- Turning groups on, on demand or off per project in oxe.yaml
- Settings › Tools: seeing and controlling them
- Semantic search per project
- What an agent can and can't do with them

## How to

### Which tools each conversation gets

Every OxeChat conversation and every agent in an OxeCode terminal gets the **core** tools: project context, memory and
code search (semantic, structural and hybrid). The rest comes in groups:

| Group | What the agent can do |
|---|---|
| `orchestration` | start other agents and conversations, delegate tasks and follow Agent Work |
| `data` | read and change databases and containers through OxeQuery and OxePod |
| `docs` | open and capture web previews and create documentation |
| `app` | Git, GitHub, conversations, skills, automations, Linear, MCP servers and the app's settings |

Roles add what they need: a Project team member gets the team tools, and one running a delegation or an Agent Work
task gets the tools to report back.

### Turning groups on, on demand or off per project in oxe.yaml

Each group has a mode per project:

- **always**: offered from the start;
- **on demand** (`on-demand`, the default): the agent gets only the names and loads a tool when it needs it. Codex
  already loads on demand; so does Claude with tool search on; without it, the agent asks for the group with
  `oxespace_tools_enable`;
- **off**: never offered, not in OxeChat, not in OxeCode terminals, not through the workspace's `.mcp.json`, and the
  agent can't turn it back on.

1. Open `oxe.yaml` at the project root (create it if it isn't there).
2. Under `thread.tools`, give the mode of each group you want to change:

   ```yaml
   thread:
     tools:
       orchestration: always
       data: off
       docs: on-demand
   ```

3. Save. It applies to conversations and agents started afterwards.

The 1.3 form (`tools: [orchestration, data]`, a list) still works: the listed groups are **always**, and the others
**on demand**.

### Settings › Tools: seeing and controlling them

<!-- TO FILL when F10 (#210) lands: the page with the groups, each one's mode, the token cost (Claude and Codex) and
the per-tool rules. Copy the strings from shared/locales. -->

1. …

### Semantic search per project

Semantic search lets agents find files by meaning, not only by name.

1. In the OxeChat sidebar, open the project's **…** menu and choose **Project settings**.
2. Under **Semantic search**, turn on **Index this project so agents can search it by meaning**.
3. The line shows the progress (**Indexing… N files so far**), then **N files indexed**.

The index stays on this computer.

### What an agent can and can't do with them

- **Can**, in the groups the project offers: read the project and memory, search code, and, with groups on, delegate,
  query data, open previews and work with the app.
- **Asks you** before anything that changes something important: a risky command, a write to a production database,
  a link outside the app. The request shows in OXESpace (see [Approving what agents ask for](01-trustworthy-actions.md)).
- **Never can**: answer approvals, see or change accounts, secrets and policy, or turn on a group the project turned
  off.
<!-- Joins with B24 (#358): "If an agent calls a tool from a group that is off, the call is refused even if it edits
the MCP configuration, and Diagnostics records: «An agent called an OXESpace tool from a group turned off in Settings ›
Tools. It was refused.»" -->

## What OXESpace guarantees

- A conversation gets only the core tools and the groups the project offers; a group that is off is never offered.
- What is only yours (approvals, accounts, secrets, policy) never becomes an agent tool.
- The semantic search index stays on this computer.

## If something goes wrong

- **"Could not change semantic search."** Try again. If it keeps happening, report it from **Help › Report a
  problem**.
- **The agent says it doesn't have an OXESpace tool.** Check the group's mode in `oxe.yaml`: off is never offered.
  Changes apply to conversations and agents started afterwards.

<!-- TO FILL with F10 (#210), B24 (#358: incident.mcp.toolGroupOff in Diagnostics) and B25 (Node.js not found:
docs/design/b25-node-missing.md). -->

## On the phone

Nothing changes on the phone.

## Known limits

- Changing a mode in `oxe.yaml` doesn't change a session that's already open: it applies to the next one.

<!-- Screenshots: `docs/guide/assets/S5/<name>.en.<light|dark>.png`. -->
