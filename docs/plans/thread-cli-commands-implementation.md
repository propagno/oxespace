# Thread CLI commands — 2026-09-17

Correction after the user's real screenshot: embedding the native terminal as
the main Thread content defeated the requested conversation view. Slash commands
now preserve the timeline and composer. `/model` renders a visual selector with
the real provider catalog; model choices and Codex effort persist across reconnects.
Codex skills use structured App Server input and Claude SDK commands/skills use
its conversation adapter. TUI-only commands offer an explicit auxiliary action.
The actual installed CLI remains available in a separate tools dialog and never
automatically replaces the Thread surface.

The composer discovers Claude commands/aliases through SDK initialization and
Codex skills through `skills/list`. A baseline of interactive command names is
available immediately; unknown slash commands offer an auxiliary tool action.
Platform, version, account and experimental availability are determined by that
CLI. Its `/` menu is authoritative; a baseline menu entry does not enable an
unsupported provider feature.

Discovery loads once per selected Thread context, independently of popup state,
typing and cursor movement. The main process shares concurrent discovery requests
and retains up to 32 scoped native catalogs for 60 seconds, with a 5-second failure
backoff. **Refresh commands** explicitly reloads; stale results from other threads
are ignored. OXE prompt files are still read on dispatch. On Windows, headless
Codex requests resolve directly to the installed native executable with
`windowsHide: true`, bypassing its npm launcher's child spawn without that flag.

| Input | Execution |
| --- | --- |
| Claude `/context`, `/compact [focus]`, `/model <name>` | Existing persistent native conversation adapter |
| Codex `/compact`, `/model <id> [effort]`, `/review <instructions>` | Existing App Server operations |
| Bare `/model` (both providers) | Visual selector in the Thread timeline, no model inference |
| Bare Codex `/review` and `/status` | Existing conversation adapter |
| Native Claude SDK commands/skills and Codex skills | Conversation adapters; Codex receives structured skill input |
| TUI-only/unknown commands | Action card, then auxiliary CLI dialog only on explicit Open advanced tools |
| OXE markdown prompts | Main-process argument expansion; native names take priority |

Choosing a command inserts it in the composer. Sending a TUI-only command adds
an action card. Choose **Open advanced tools** to open its CLI dialog if needed.
Complete any sign-in/trust prompt,
choose **Insert command**, then press Enter in the CLI. Insertion uses bracketed
paste without submitting Enter, so startup menus cannot receive unintended
confirmation. The header **Tools** button opens the same auxiliary interface.
The composer and timeline stay mounted. Closing the dialog keeps its process
available through Show tools; Return closes it and permits ordinary sends.

## Ownership and session recovery

`ThreadManager` grants one execution lease per thread. It closes an idle
conversation adapter before opening the CLI and rejects overlapping turns.
Thread PTYs use dedicated IPC channels and the reusable xterm renderer; they
never create, attach, resize or restart Code panes. Global Code shortcuts and
Code voice input do not intercept Thread CLI input. At most eight native Thread
CLIs run simultaneously.

The CLI starts in the exact registered thread directory with an explicit native
resume ID when available, without a shell or API environment credential overrides.
Windows npm Codex shims resolve directly to their installed Rust executable:
Electron-as-Node under ConPTY produced no interactive output. The Windows bridge
uses the packaged ConPTY DLL; this avoids the node-pty console-enumeration race
observed while closing the original ConPTY implementation.

Exit with `/quit`, then choose **Return to thread**. Provider resume footers
update the selected native ID. **Saved session → Link session** also accepts an
explicit saved UUID when a session picker/fork did not emit a recognized footer;
linking works after the CLI exits. The backend verifies that this session belongs
to the exact thread directory. It never guesses by selecting the newest session.

Return imports public user/assistant text from the selected native session:
Codex uses `thread/read`; Claude uses its exact native JSONL file and active
parent chain after rewind. Tool payloads, sidechain sessions, private thinking
and raw CLI output are not imported into conversation history. Files, tools,
approvals and session confirmations remain available in the native CLI.
Import failures block ordinary conversation until recovery, preventing stale
context from being continued. Restart marks an active CLI interrupted and never
automatically restarts commands. Ordinary conversation retains its existing
planning/read-only restrictions; interactive execution follows native permissions.

## Verification

- 98 targeted unit/component/Electron integration tests passed, covering
  command routing, aliases, native priority, keyboard input, history, rewind,
  visual model selection with draft preservation, model/effort persistence,
  no automatic CLI launch, separate terminal transport, lease ownership and linking after native exit,
  shared scoped discovery, refresh/backoff, stale catalog suppression, continued typing/focus,
  direct hidden Windows Codex launch and dismissible voice input with cancellation recovery.
- Six installed-CLI checks passed without inference or account changes:
  sanitized account protocols, Codex initialization, both providers' discovery,
  both real model catalogs, persistent Claude local commands and real Claude/Codex interactive PTYs.
  The PTY test uses isolated native homes, never submits a command to startup
  menus, and confirms the native processes stop on Return.
- Typecheck, production build and bundle budgets passed. Lint: zero errors,
  32 existing warnings.

The Electron UI test passed and covers voice AbortError recovery by close button,
Escape and Ctrl+Shift+V, catalog reuse while reopening the slash menu, slash entry, selection, native pending command
insertion, CLI focus, shortcut isolation, scroll/viewport bounds at 900/1280 px,
conversation return, authentication fixtures and Code terminal retention.
Captures: `test-results/thread-model-picker-900.png` for the actual Thread selector
and `test-results/thread-native-cli-900.png` for the optional auxiliary dialog.

Real browser login completion, paid model execution, authenticated native
fork/resume and Linux interactive PTYs still require a separate account/platform
pilot. See [Thread behavior](../thread-view.md), the official
[Claude interactive contract](https://code.claude.com/docs/en/interactive-mode)
and [Codex CLI commands](https://developers.openai.com/codex/cli/slash-commands).
