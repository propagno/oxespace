# Closing and coming back without losing your agents

> Closing or crashing OXESpace never loses your agents or their work: each pane goes back to its session or says why it did not.

<!-- About this page: Slice S2 · Filled by: BACKEND (B17) + FRONTEND (F32) · Items: B17, F32, F19, B2 · draft (skeleton) -->

Also in: [pt-BR](../pt-BR/02-sessoes-que-sobrevivem.md)

## What you can do

- Closing OXESpace with unsaved changes
- What "Session resumed" and "Not resumed" mean
- Turning on resume after a crash (status hooks)
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

### What "Session resumed" and "Not resumed" mean

<!-- TO FILL: Numbered steps, one per action. Screen names in bold, as they appear in the app. -->

1. …

### Turning on resume after a crash (status hooks)

<!-- TO FILL: Numbered steps, one per action. Screen names in bold, as they appear in the app. -->

1. …

### Starting a pane fresh

<!-- TO FILL: Numbered steps, one per action. Screen names in bold, as they appear in the app. -->

1. …

### Splitting panes without squeezing them

<!-- TO FILL: Numbered steps, one per action. Screen names in bold, as they appear in the app. -->

1. …

## What OXESpace guarantees

- Closing with unsaved changes always asks first; if any of them can't be saved, nothing is closed.
- Shutting down the computer and installing an app update don't wait for the question.
- The resume command is built by OXESpace, never typed into your shell.
- A session deleted from disk is not resumed: the pane says so and starts a new one.

## If something goes wrong

- **"1 change could not be saved, so nothing was closed."** OXESpace closed nothing. Open the file or request it names, read the reason (for example, no permission on the folder), save again and close again.

<!-- TO FILL: Each message the person can see (this slice's C3 messages) with what to do. -->

## On the phone

Nothing changes on the phone.

## Known limits

<!-- TO FILL: What does not work yet in 1.4, one line each. -->

<!-- Screenshots: `docs/guide/assets/S2/<name>.en.<light|dark>.png`. -->
