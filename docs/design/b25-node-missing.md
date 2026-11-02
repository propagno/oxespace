# B25 · Node.js not found, said where it matters

> Copy and placement for the "Node.js not found" status. Slice S5 · Owner: BACKEND (check, codes) + FRONTEND (the
> three surfaces) · Copy gate: [glossary](glossary.md).

## 1. What the person must understand

OXESpace itself works without Node.js. **Agents lose two things:**
- the OXESpace tools: the internal MCP bridge (`resources/mcp-bridge/oxespace-mcp.cjs`), and the delegation bridge, which is started with `node`;
- the status hooks (`agent-hooks/installer.ts` writes `command: 'node'`), so the agent's state falls back to reading the terminal.

Nothing says so today: the agent simply has no OXESpace tools, and the hooks never report. The status tells the person:
- what doesn't work;
- why;
- how to fix it on their OS;
- that the rest of the app is fine.

## 2. The check (BACKEND)

- **What "found" means:** run `node --version` with the **same PATH the agent terminals get** (the shell profile's,
  `shell-profile.defaults.ts`), not Electron's own `process.env.PATH`. A macOS app started from the Dock doesn't see
  Homebrew's PATH, so checking Electron's PATH would raise a false alarm, or a false "found".
- **When:** at start (deferred, off the boot path), when an agent pane opens or a conversation starts its provider,
  and on **Check again**. The result is cached until one of those runs again.
- **States:**
  - `ok`: shows the version;
  - `missing`: `node` isn't found, or doesn't run;
  - `tooOld`: older than the bridge's minimum, `{{min}}` (BACKEND sets it; CI uses 22).
- A failure is never a crash or a silent `false`: each state is a C3 message.

## 3. Install instruction per OS

`main:node.install.<os>`, picked by the platform. Commands are in code style, with a copy button. The link opens
through the B15 external-link confirmation like any other.

| OS | en | pt-BR |
|---|---|---|
| `windows` | Install Node.js LTS from nodejs.org, or run `winget install OpenJS.NodeJS.LTS`. Then restart OXESpace. | Instale o Node.js LTS pelo site nodejs.org ou rode `winget install OpenJS.NodeJS.LTS`. Depois reinicie o OXESpace. |
| `macos` | Install Node.js LTS from nodejs.org, or run `brew install node`. Then restart OXESpace. | Instale o Node.js LTS pelo site nodejs.org ou rode `brew install node`. Depois reinicie o OXESpace. |
| `linux` | Install Node.js LTS from nodejs.org or your distribution's package manager (version {{min}} or newer). Then restart OXESpace. | Instale o Node.js LTS pelo site nodejs.org ou pelo gerenciador de pacotes da sua distribuição (versão {{min}} ou mais nova). Depois reinicie o OXESpace. |

- **"Restart"** is because the agent terminals inherit OXESpace's environment, so a new PATH only reaches them after a
  restart. **Check again** still re-runs the check at once. If the check finds Node.js, the surfaces clear and the
  restart line stays, so new agents get the tools.
- **Linux** gives no `apt` command on purpose: Ubuntu and Debian packages can be older than `{{min}}`.

## 4. Where it shows

### 4.1 Settings › Diagnostics (the check row)

Diagnostics checks are English strings today (`diagnostics.service.ts`). This one is the first that follows C3: its
label and detail are `MainMessage`s, and the row renders them like the others.

| State | Tone | Label | Detail (en / pt-BR) |
|---|---|---|---|
| `ok` | ok | Node.js | `node.check.ok`: "{{version}} · used by the OXESpace tools and the status hooks" / "{{version}} · usado pelas ferramentas do OXESpace e pelos hooks de status" |
| `missing` | warning | Node.js | `node.check.missing`: "Not found. Agents won't have the OXESpace tools, and the status hooks won't report. The rest of OXESpace works." / "Não encontrado. Os agentes ficam sem as ferramentas do OXESpace e os hooks de status não informam. O resto do OXESpace funciona." + the OS line (§3) |
| `tooOld` | warning | Node.js | `node.check.tooOld`: "{{version}} is older than {{min}}. Agents won't have the OXESpace tools, and the status hooks won't report." / "{{version}} é mais antigo que {{min}}. Os agentes ficam sem as ferramentas do OXESpace e os hooks de status não informam." + the OS line |

- The tone is a warning, not an error, because the app works.
- The existing **Refresh** re-runs the check.
- The summary "N warning" counts it.

### 4.2 Settings › Notifications › Agent status hooks

- A `Notice` (intent `warning`) above the switches, only when the state is `missing` or `tooOld`:
  `node.hooks.notice`: "The status hooks need Node.js, which wasn't found. Until it is installed, the agents' status
  comes from reading the terminal." / "Os hooks de status precisam do Node.js, que não foi encontrado. Até ele ser
  instalado, o status dos agentes vem da leitura do terminal."
  Below it go the OS line (§3) and **Check again** / **Verificar de novo**.
- **Turning a hook on** is disabled with that reason (`aria-disabled` plus the reason in the row's hint, as in the F35
  rule), so nobody installs a hook that can't run. **Turning one off** stays available.

### 4.3 The MCP surface (MCP panel, the OXESpace server row)

- The OXESpace server row shows a warning state, not "connected":
  `node.mcp.unavailable`: "Not available to agents: Node.js wasn't found." / "Indisponível para os agentes: o Node.js
  não foi encontrado."
- **How to install** / **Como instalar** opens Settings › Diagnostics at the Node.js row.
- The internal MCP server itself keeps running. Only the agents' way in, the bridge, is missing, so the text names the
  agents, not the server.

### 4.4 When an agent starts

- **Once per app session**, when an agent pane opens or a conversation starts its provider, and only while the state
  is `missing` or `tooOld`: a toast (warning; it stays until dismissed, because it explains a missing capability):
  `node.agent.notice`: "Node.js not found: this agent runs, but without the OXESpace tools or the status hooks." /
  "Node.js não encontrado: este agente roda, mas sem as ferramentas do OXESpace e sem os hooks de status."
  The action is **How to install** / **Como instalar** (Settings › Diagnostics).
- Not per pane, and not again after it's dismissed in this session. It is also an F30 activity entry, so it can be
  found later.

## 5. For agents

The agent can't get the OXESpace tools without Node, so there is no tool to answer with. Nothing to add for the agent;
the person is told on the surfaces above.

## 6. Acceptance (design)

1. With a PATH without `node`:
   - the Diagnostics row says `missing` with this OS's line;
   - the hooks section shows the notice, and turning a hook on is disabled with a reason that the keyboard can reach;
   - the MCP panel's OXESpace row says "Not available to agents";
   - the first agent pane shows the toast once.
2. On macOS with Node from Homebrew and OXESpace started from the Dock: `ok`, because the check uses the terminals'
   PATH.
3. Check again after installing clears every surface.
4. pt-BR and en, with no concatenated strings, and commands in code style with a copy button.
