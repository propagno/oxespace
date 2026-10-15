# Privacy and data handling

What OXESpace stores on your machine, what it sends over the network, and to whom. It is written
from the code and the platform specification, not from a policy template, and it covers OXESpace
only: the agent CLIs, the services behind them and the servers you connect have their own policies.

## In short

- There is **no OXESpace account**, and **no analytics or telemetry SDK** is bundled.
- Your repositories stay where they are. OXESpace reads them to show and edit them; it does not
  upload them.
- Agents are the official CLIs you already signed in to. Your conversations go **from the CLI to its
  provider**, not through a service of ours.
- Crash dumps stay on your machine.

## What is stored locally

Everything lives in the per-user application data directory (Electron's `userData` for OXESpace).

| Data | What it holds | Kept |
|---|---|---|
| SQLite database | Workspaces, panes, Thread conversations and history, tasks, settings, MCP server definitions | Until you delete it |
| Database backups | A verified copy taken before an upgrade changes the database | The five most recent |
| Composer drafts | Text you typed in a Thread message box and did not send, as plain text | Seven days after the last edit |
| Thread attachments | Images you attached, in a private store under opaque names | On your machine |
| Project memory | Optional, off by default (Beta); local memory across worktrees | On your machine |
| Semantic index | Embeddings and a text index of your project, built on this machine by a bundled model | On your machine |
| Diagnostics log | A bounded runtime log | Three files of 512 KiB, seven days |
| Crash dumps | Native crash reports | On your machine only; never uploaded (`uploadToServer` is off) |

Project files are never copied: workspaces reference folders on disk.

### Secrets

- **Linear API key and database credentials** (OxeQuery passwords, SSH keys, CA material) are stored
  with the operating system's secure storage (`safeStorage`). If the system cannot encrypt, the
  Linear key is **refused** rather than saved in plain text; a key an earlier version saved
  unencrypted is still read, and the Linear panel asks you to reconnect.
- **MCP server secrets** are stored with the server definition. For a Thread they are passed to the
  agent process through its environment, not on the command line.
- **Composer drafts** are plain text. A secret you paste into a message box and leave unsent stays on
  disk for up to seven days.

## What goes over the network

Only things you turn on or use. OXESpace itself contacts these:

| Destination | When | What is sent |
|---|---|---|
| GitHub Releases (`api.github.com`, `github.com`) for OXESpace | Update checks, on start and periodically, in a packaged build | A request for the latest release; no project data |
| GitHub Releases for the RTK helper (`rtk-ai/rtk`) | When the helper is checked or installed | A request for its latest release; the downloaded archive is verified against the checksum the release publishes |
| `api.linear.app` | Only after you connect Linear | Your key and the queries for your issues |

Other traffic is started by tools you chose, not by OXESpace:

- **Agent CLIs** (Claude Code, Codex and others) talk to their providers with your own sign-in. What
  they send is governed by the CLI and the provider.
- **GitHub CLI (`gh`)** talks to GitHub for the GitHub hub and pull-request status.
- **MCP servers** you add and trust run as you configured them and may reach their own services.
- **OxeQuery** connects to the database and SSH hosts you configure, and to Docker or Podman locally.
- **Web Preview** loads the addresses you open, in an isolated, in-memory browser profile per
  workspace or conversation.

Voice dictation uses a speech model that runs locally (bundled on Windows).

## Diagnostics and support reports

A support report is exported only when you ask for it. It redacts local paths and credential-shaped
values, and it is a file you choose whether to share.

## Deleting your data

Close OXESpace and delete its application data directory (Electron's `userData` directory for
OXESpace) to remove everything above.

## What this document does not promise

- It does not cover what the agent CLIs, model providers, GitHub, Linear or an MCP server do with
  data sent to them.
- It is a description of the current code. When a release changes what is stored or sent, its
  release notes say so.
