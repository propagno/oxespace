# Closing and coming back without losing your agents

> Closing or crashing OXESpace never loses your agents or their work: each pane goes back to its session or says why it did not.

<!-- About this page: Slice S2 · Filled by: BACKEND (B17) + FRONTEND (F32) · Items: B17, F32, F19, B2 · partial: written from what is on main on 10/31 (close guard, Interrupted tools, Resume agent sessions, status hooks, refused split). "Session resumed" / "Not resumed" and starting a pane fresh join with B17 (#309) and F32 (#311). -->

Also in: [pt-BR](../pt-BR/02-sessoes-que-sobrevivem.md)

## What you can do

- Closing OXESpace with unsaved changes
- Deciding what to do with an Interrupted tool
- Making agent panes go back to their session after a restart
- Turning on status hooks
- What "Session resumed" and "Not resumed" mean
- Starting a pane fresh
- Splitting panes without squeezing them

## How to

### Closing OXESpace with unsaved changes

If a file in the OxeCode editor or an OxePost request has unsaved changes, closing the window or quitting the app
asks first.

1. Read the **Unsaved changes** list: each item says where it is (for example **OxeCode editor · src** or **OxePost
   request**).
2. Choose:
   - **Save all and close** (or **Save all and quit**): saves each change and closes;
   - **Close without saving** (or **Quit without saving**): closes and loses the listed changes;
   - **Cancel**: goes back to work without closing anything. It has the focus when the question opens.

### Deciding what to do with an Interrupted tool

If OxeChat was running a tool when the app closed or crashed, the conversation shows that tool as **Interrupted** when
you come back. It may or may not have taken effect, and nothing is run again on its own.

1. Open the conversation and find the tool marked **Interrupted**.
2. Choose:
   - **Continue**: the agent is asked to check what happened before going on. The conversation says **Continued: the
     agent was asked to check what happened first.**
   - **Dismiss**: the tool stays as it is and nothing runs again. The conversation says **Dismissed. Nothing was run
     again.**

### Making agent panes go back to their session after a restart

1. Open **Settings › Terminal**.
2. Turn on **Resume agent sessions**.

With it on, after OXESpace restarts, Claude Code and Codex panes reopen the session they were in.

### Turning on status hooks

With hooks, Claude Code and Codex report working, waiting or done themselves, instead of OXESpace guessing from the
terminal output.

1. Open **Settings › Notifications**.
2. Under **Agent status hooks**, turn on **Report Claude Code status through hooks** (and the same for Codex).
3. The line now says **Installed.**

OXESpace writes to the agent's own config and keeps the hooks you already have. To remove them, turn the same switch
off.

### What "Session resumed" and "Not resumed" mean

<!-- TO FILL when F32 (#311) lands: the pane's notice and what each "not resumed" reason asks for. Copy the strings
from shared/locales, not from the PR. -->

1. …

### Starting a pane fresh

<!-- TO FILL when B17 (#309) / F32 (#311) land: the action that opens a new session instead of resuming. -->

1. …

### Splitting panes without squeezing them

A layout has a fixed number of places. When they are all taken, splitting doesn't squeeze the panes: OXESpace tells
you.

1. Split a pane (**Split pane right** or **Split pane down**).
2. If **This pane cannot be split here** shows, choose a larger layout, or turn on the split layout to add panes
   freely.

## What OXESpace guarantees

- Closing with unsaved changes always asks first; if any of them can't be saved, nothing is closed.
- Shutting down the computer and installing an app update don't wait for the question.
- A tool that was running when the app closed is never run again on its own: you choose **Continue** or **Dismiss**.
- The resume command is built by OXESpace, never typed into your shell.
<!-- Joins with B17 (#309): "A session deleted from disk is not resumed: the pane says so and starts a new one." -->

## If something goes wrong

- **"1 change could not be saved, so nothing was closed."** OXESpace closed nothing. Open the file or request it
  names, read the reason (for example, no permission on the folder), save again and close again.
- **"Cannot update: …"** on status hooks: OXESpace couldn't write to the agent's config. Read the reason, fix it (for
  example, the file's permission) and turn the switch on again.
- **"Partially installed (missing: …)"**: turn the switch off and on again to install what is missing.
- **"Not installed — using output heuristics."**: hooks are off; the status comes from reading the terminal.

<!-- TO FILL with F32 (#311): the "Not resumed" reasons and what to do for each. -->

## On the phone

Nothing changes on the phone.

## Known limits

- Resume covers Claude Code and Codex panes; other agents and plain shells start a new session.
- On Windows, a Claude Code pane whose shell was opened through a short `~1` path (for example `C:\Users\RUNNER~1\…`)
  may not find its saved session when the project was added under the full path. The pane says the session was not
  resumed and starts fresh; the saved conversation stays on disk.

<!-- Screenshots: `docs/guide/assets/S2/<name>.en.<light|dark>.png`. -->
