<!--
Release notes for 1.4.0, kept as _template-1.4.0.md on purpose: ci.yml publishes docs/releases/<version>.md as the
release body when that file exists, so this file must never be named 1.4.0.md before the cut. At the cut the release
session copies it to 1.4.0.md, removes these comments and DESIGN reviews the voice.
Written from what is on main as of 2026-10-31 (d71a8c4f), v1.3.3..main; brought up to date on 2026-11-01 for gate G9. House style of 1.3.x: English, outcome first,
bold lead-in per bullet, no internal ids, PR numbers or codes. The pt-BR version is _template-1.4.0.pt-BR.md.
Items that land later are listed in comments under their section ("add when …"); move them up when they merge.
-->
# OXESpace 1.4.0

A workspace that feels like one product: Portuguese and English throughout, approvals that never wait forever,
nothing lost when you close, your agents on your phone, and two new modes, OxePod for containers and OxePost for
APIs. Installs of 1.3.x on Windows update automatically; on Linux, install the new package (the AppImage
updates itself).

## Approving what agents ask for

<!-- S1 · guide: docs/guide/en/01-trustworthy-actions.md -->
- **Requests never wait forever.** A request from an agent or from the app that nobody answers is denied when it
  expires, and a critical one can't be allowed in its first seconds.
- **Commands that rewrite Git or touch protected files always ask.** `checkout`, `reset`, `clean`, `rebase` and the
  like, any command that mentions OXESpace's protected files, and any command that changes Git's configuration
  (yours, the system's or the repository's) are never approved by a saved rule.
- **Rules you can trust.** An allow rule approves only when it covers every command of a line; read-only commands
  inside the project can be approved automatically (**Permissions** in a conversation). A denied MCP tool is removed
  from the agent's tools at its next session.
- **Organization policy in simple rules**, enforced for providers, tools, MCP servers, skills, databases and shared
  memory, and shown in Settings.
- **Links and previews are confirmed.** A link opens outside the app only after you see its real host; previews of
  URLs with a user or password are refused.
- **MCP servers that change after you trusted them are quarantined**, are hard to miss (a count on the MCP button),
  list no tools, and are trusted again only on purpose.
- **Safer databases.** A production write in MongoDB asks you to type the name; risky SQL (`COPY … PROGRAM`, `DO`
  blocks, row locks) is flagged; an agent's read never closes your session.
- **A request ends with whoever asked.** Closing a pane or ending an agent's session withdraws the approval requests
  and permissions it left waiting; they show as cancelled, not answered.
- **An agent can't pose as the app or your system.** A name an agent picks for itself is refused when it imitates
  OXESpace, its modes or tabs, your operating system or its vendor ("Windows Security", "System Administrator").
- **Approvals in the app, not in a system dialog.** Every request opens inside the window and says who asks, the
  risk in words (Low, Medium, High, Critical) and what will happen. The agent's own text is kept apart from the
  app's notes. **Deny** is the default, a critical request can't be allowed with Enter, and you can look back at this
  session's decisions.

## Closing and coming back without losing your agents

<!-- S2 · guide: docs/guide/en/02-sessions-that-survive.md -->
- **Nothing lost on close.** Closing the window or quitting with unsaved editor files or OxePost requests lists them
  first: save all, close without saving, or cancel. If a save fails, nothing closes. A window that stops responding
  still closes after a few seconds.
- **A crash doesn't repeat what an agent did.** Tools that were running when the app closed come back as
  *Interrupted*, with **Continue** (asks the agent to check first) or **Dismiss**; nothing is run again.
- **Splitting panes past the layout no longer brings the window down**, and a split with no room says why.
- **Agent panes come back to their earlier Claude or Codex session** after a restart or a crash, including projects
  opened through a link or a short Windows path.
<!-- add when F32 (#311) merges: append to the bullet above ", or say why they couldn't". -->

## Organizing many conversations

<!-- S3 · guide: docs/guide/en/03-conversations.md -->
- **Sections in the conversation list**, kept by the app: create, rename, collapse, drag conversations in or use the
  menu.
- **A side chat about a conversation** (`Ctrl+.`): ask about it in a drawer beside it; nothing reaches the
  conversation.
- **One isolated worktree per conversation**, if you want: the conversation works on its own branch and the worktree
  is cleaned up when it ends.
- **The activity center** (the bell, `Ctrl+Shift+A`) lists what needs you, what finished and what's new, and keeps
  it across restarts.
- **Usage per turn**: context and steps in the usage panel; a running step says when it is slower than usual.
- **OxeCode and OxeChat**: the two agent modes have one family of names, and conversations are called conversations.
- **Conversation details**, from the conversation's header: its environment (project, worktree, branch, agent,
  model), context in detail with **Compact**, the MCP servers and tools it used, the files it changed, and its
  background work. Reorder the sections by dragging or from each section's menu.
<!-- nested conversations and the project coordinator (B1.3/B1.4, #287/#290) are 1.4.1: scope cut by the user; never list them here. -->

## Your phone

<!-- S4 · guide: docs/guide/en/04-phone.md -->
- **Follow and answer your agents from an Android phone.** Turn on the phone connection in **Settings › Devices**,
  then pair by scanning a code over your local Wi-Fi. It's off by default, uses an encrypted connection the phone
  checks against your computer's certificate, and nothing goes through the cloud.
- **Live conversations and terminals**, resumed exactly where you left them; send a message, steer or stop a turn,
  and answer requests with your fingerprint. What only the computer may answer says so on the phone.
- **Up to 5 phones per computer**, each removable at once from **Settings › Devices**.
<!-- add at the cut: where to get the Android app (M8). -->
- **Notifications when an agent needs you, finishes or fails**, with the phone in your pocket; it reconnects on its
  own when the Wi-Fi comes back.
- **What's secret stays on the screen.** Requests, terminals and the pairing code are kept out of Recents,
  screenshots and screen recordings. On Android 13 and later, the app can have its own language
  (Android Settings › Apps › OXESpace › Language).
<!-- add when M10/M11 (#384/#386) merge: "The phone's conversation in the Mandacaru design: a turn bar with its time,
grouped steps with inline diffs, a visible queue, the pending request docked above the message box, and a key row
with Esc, Tab, Ctrl+C and arrows for the terminal." -->

## OXESpace's tools for your agents

<!-- S5 · guide: docs/guide/en/05-agent-tools.md -->
- **Every OXESpace feature an agent may use is reachable over MCP**, and what is only yours (approvals, accounts,
  secrets, policy) never is.
- **Tool groups on demand.** Building on 1.3.3's per-project groups, each group can be off, on demand or always on
  per project in `oxe.yaml`; a group that is off is never offered to an agent. Long tool results are cut, with the
  full text kept in a file.
- **A group that is off stays off.** OXESpace refuses its tools on every call, even if an agent edits its own MCP
  configuration, and records it in **Settings › Diagnostics**.
- **Settings › Tools** shows each group, its mode in this project and its token cost, and changes the mode.
  If `oxe.yaml` has an error, the page says so and agents keep the last modes that could be read until you fix it.
<!-- add when #336 merges: "**Fewer tokens at the start of a Code agent.** An agent OXESpace starts in a terminal
begins with about 9,000 characters of tool definitions instead of 64,600, and is told when OXESpace's code search
beats grep." Measured numbers: 64,574 → 8,965 chars. -->
- **Code search you can turn on per project**: semantic search per OxeChat project, with one switch.

## OxePod and OxePost

- **OxePod is its own mode** (`Ctrl+4`): containers, images, volumes and networks, logs and stats, with Docker or
  Podman. OxeQuery keeps databases, and connects to a database container in one click.
- **OxePost, an API client** (`Ctrl+5`): requests saved as files in the project, environments and secrets, and
  import from cURL or OpenAPI.
- **OxeQuery**: schema-aware autocomplete, a grid with filter, pin and a JSON viewer, **Load more** for long
  results, SQL lint, and safe production connections.

## OXESpace your way

<!-- S6 · guide: docs/guide/en/06-your-way.md -->
- **Portuguese and English** across the app, switched in Settings without a restart.
- **A keyboard you can live in**: a command palette for everything (`Ctrl+K`), a shortcut guide and
  **Settings › Keyboard**, F6 to move between regions, and a mode where Tab leaves the terminal.
- **Accessibility**: WCAG 2.2 AA checks on Windows and Linux, forced colours, 24 px targets, and keyboard paths for
  every list.
- **Interface scale, density and motion** (System, Reduced, Full) for the whole app.
- **A new look**: the Mandacaru design (lighter shell, settings inside the window, one set of states for empty,
  loading, error and offline), and the new brand from the boot splash to the icons.
- **Updates your way**: automatic, notify me, or off; stay on a version; or opt in to beta versions.
- **Report a problem…** (the menu button beside the logo › **Help**, or the command palette) builds a redacted
  report for you to review; diagnostics measure only while open.
- **A lighter start**: what the first screen doesn't need now loads only when you open it.
<!-- no memory claim: no measurement on main backs "a quarter less memory in a long conversation"; add one only with
its run or test. -->

## What moved or was removed

- **Containers moved from OxeQuery to OxePod.**
- **Mode names**: Code is now OxeCode and Thread is now OxeChat.
<!-- add when F34/F35 merge: "OXEVoice was removed. OXESpace no longer records speech; your operating system's
dictation still types into any field, and the downloaded voice model is deleted on the first start." and "Team moved
off the title bar: Tools › Project team…, the command palette or Ctrl+Shift+T." -->
<!-- add when #387 merges: "**Git actions started from OXESpace skip the repository's hooks.** Push, switching
branches and creating worktrees run without them; use the terminal when a flow depends on hooks. Agents can't reach
the network through Git: when a task needs the latest remote branch, you fetch it in the Git panel or the terminal." -->
- **Closing a pane ends what it started.** Jobs sent to the background with `nohup` or `disown`, and apps launched
  from the pane (`gedit &`, `notepad x`), now close with it. To keep something running, start it outside OXESpace or
  as a system service.

## Security

<!-- Electron 44.9.3, fast-uri, undici and dompurify shipped in 1.3.3; list only dependency updates made after it, at the cut. -->
- **One secret redaction** wherever text leaves the app, and an audit export as JSONL.
- **Untrusted text is fenced**: program output, remote text and memory reach agents marked as data, not
  instructions; agent configuration edits are guarded.
- **The main window opens no link by itself**, and every inter-process call checks that it comes from the app's own
  window.
- **The installed app carries less to read.** The main process's source maps are no longer packaged.
<!-- add when #387 merges: "**Git runs through one guard.** OXESpace won't run network Git in a repository whose
own settings change how Git connects or authenticates (`core.sshCommand`, `credential.helper` and the like); run those
commands in the terminal. Your global Git settings never trigger this." -->
- **The packaged app can't be borrowed as a plain Node.js runtime**, so other programs can't use it to run their own
  code.

## Known limits

- The limits listed in [1.3.0](1.3.0.md) still apply unless a section above says otherwise.
<!-- fill from the guide pages' "Known limits" at the cut. -->
- **On Windows, a graphical program used as a pane's command shows as exited right away.** Run it from the pane's
  shell instead. Shells, Claude Code and Codex are not affected.
- **On Linux and macOS, a real daemon (a process that detaches twice) keeps running after its pane closes.**
<!-- add when #387 merges (B26 closes it in 1.4.1): "**A Git filter added to a repository's settings at the moment an
action starts can run once** before OXESpace notices it." -->
- **Going back to 1.3.3 needs the automatic backup, restored before you open 1.3.3.** 1.4.0 updates your data the
  first time it opens, after saving a verified copy. 1.3.3 can't read the updated data: it shows "No workspaces yet",
  with no warning, though nothing is lost. To go back: close OXESpace, install 1.3.3 from the Releases page, and
  **before opening it**, put the newest `oxespace-v77-…sqlite3` from the `db-backups` folder in place of
  `oxespace.sqlite3`. The folder is `%APPDATA%\OXESpace` on Windows and `~/.config/oxespace` on Linux. Then open 1.3.3.
  The full steps are in
  [Going back to the previous release on one machine](https://github.com/propagno/oxespace/blob/main/docs/ci-cd.md#going-back-to-the-previous-release-on-one-machine).
  <!-- folders measured by SRE on the install-over CI runs 41318110576 and 41319224178. -->
- **The phone and the computer must be on the same local network**; there is no access over the internet, and the
  phone app is Android only.
