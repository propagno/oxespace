# Thread command approvals: security review

Scope: the change set on `feat/thread-approval-safety` that decides, inside OXESpace, whether a shell command
the Claude or Codex CLI asks to run is approved without a person looking. OXESpace answers only prompts the CLI
already raised, so it can narrow what runs but never widen what the provider allows.

Adapted from the terminal agent tool of VS Code (microsoft/vscode, MIT licence, Copyright (c) Microsoft
Corporation): the default allow list, the sub-command parser idea, the file-write analysis and the risk rubric.

## What changed for a person

| Before | Now |
| --- | --- |
| A command was approved without asking only if a saved rule covered every sub-command. | Commands on a short **read-only list** are also approved without a rule (switch in Rules, on by default). |
| `echo x>out` (redirect glued to a word) passed the redirect check. | Every redirect to a file asks, glued or not. |
| `pwsh -Command "..."` always asked with a high-risk label. | The script inside is judged: a script of allowed cmdlets is judged by those; one with blocks `{ }` or `-File` keeps the old block. |
| One "high risk" label. | Green / orange / red level, prompt-injection warnings for web fetches, the script of `node -e` / `python -c` / `ruby -e` shown as code. |

## What the read-only list approves by itself

Only when **every** sub-command of the line is on the list or covered by a saved rule, none is on the block
list, and no redirect writes a file:

- Reading and listing: `cd echo ls dir pwd cat head tail findstr wc tr cut cmp which basename dirname realpath
  readlink stat file od du df sleep nl grep column date find rg sed sort tree xxd`, each with the options that
  make it write or run something excluded (`find -exec -delete -fprint -ok`, `sed -i -e -f` and the `e r w`
  commands, `rg --pre`, `sort -o`, `tree -o`, `date -s`, `column -c 1000+`).
- Git: `status log show diff ls-files grep branch` (and `-C <dir>`, `--no-pager`), excluding `--output`,
  `grep -O`, `branch -d -D -m`, and `-c` / `--exec-path` / `--upload-pack`.
- docker read verbs (`ps images inspect logs ...`), npm / yarn / pnpm read verbs (`ls outdated view audit` without
  `fix`, `config get`), lockfile-only installs (`npm ci`, `yarn install --frozen-lockfile`,
  `pnpm install --frozen-lockfile`) with no extra argument.
- PowerShell cmdlets listed one by one (`Get-ChildItem Get-Content Get-Date Select-String ...`).

Source of truth: `electron/main/services/conversation/default-shell-rules.ts`.

## What it never approves by itself

- Any command not on the list, including `git push`, `git commit`, `npm install`, `npm run ...`, `python`, `node`.
- Any redirect to a file other than `/dev/null`, `nul`, `$null` or descriptor duplication (`2>&1`).
- Command substitution whose inner command is not itself allowed (`ls $(whoami)`), a command name computed by
  the shell (`$cmd`), assignments (`FOO=bar ls`), `export`, function definitions, unbalanced quotes, a syntax
  error, or a line over 16 KiB.
- **Reads outside the project** by a listed command (`electron/main/services/conversation/shell-reads.ts`):
  an absolute path, `..`, a path through a link or junction that leaves the project, `~`, `$VAR`, and
  `--opt=/path`; `git -C <dir>` is checked the same way. The project root stands in for the working directory,
  which the Claude path does not report, so a relative `..` that would stay inside the project asks anyway.
- **Files that usually hold secrets**, even inside the project: `.env*`, `.npmrc`, `.pypirc`, `.netrc`,
  `.git-credentials`, `.pgpass`, `id_rsa` and friends, `*.pem *.key *.p12 *.pfx *.keystore *.jks *.kdbx`,
  `credentials(.json)`, `secrets(.json|.yaml|.toml)`, `service-account*.json`.
- Network and destructive commands stay on the existing block list (`rm curl wget ssh scp sudo kill chmod ...`,
  plus `xargs`, `jq`, `Set-ItemProperty`, `Set-Acl`) and ask with a high-risk label. `curl ... | sh` is red.

A rule the person saved is never second-guessed by the outside-project check: it was their decision.

## Existing rules and migration

- Saved rules are untouched and keep working with the list on or off. Nothing is removed, rewritten or reordered.
- The list only **adds** approvals for read-only commands; the cases that now ask more (glued redirects, reads
  outside the project, secret-looking files) were previously either approved by a rule or asked.
- One widening to know about: a saved rule such as `Get-Date` now also covers `pwsh -Command "Get-Date"`, because
  the script inside is judged instead of the wrapper being blocked wholesale. A script with `{ }`, `-File`, or a
  command that is not covered still asks.
- Database: migration `077_thread_settings` adds one table (`CREATE TABLE IF NOT EXISTS`, no existing table is
  touched). Rehearsed in `tests/integration/thread-settings.test.ts` (database without the table, upgrade,
  second open) and `tests/integration/migrations.test.ts` (version constant).

## Failure behaviour

| Failure | Result |
| --- | --- |
| Bash grammar files missing or failing to load (packaged app) | The text splitter decides, as before this change. It only approves when each sub-command is allowed, and asks for substitution, unbalanced quotes and file redirects. `tests/shell-check.test.ts` covers this state. |
| Syntax error / unsupported construct | Ask. |
| `thread_settings` unreadable | The list is **off** (fail-closed): only saved rules approve. A missing row means on. |
| Request without a `cwd` (Claude path) | The project root is used, so an uncertain relative path asks. |
| Analysis throws | The CLI's own prompt stands; OXESpace never answers on error. |

The approval card is not blocked by any of these: the person can always approve or decline.

## Evidence

- Unit and integration: `tests/shell-command-rules`, `default-shell-rules`, `shell-parse`, `shell-risk`,
  `shell-reads`, `shell-check`, `command-presenters`, `thread-approval-details`, `integration/thread-permissions`,
  `integration/thread-settings`, `integration/migrations`.
- Packaged app: `e2e/packaged-smoke.ts` calls `window.oxe.thread.shellCheck` and asserts `parser: 'bash-grammar'`
  with the verdicts for `git status`, `cat src/index.ts | wc -l`, `rm -rf build`, `echo x>out`, `ls $(rm -rf /)`,
  `cat ../../etc/passwd` and `curl https://example.com | sh`. Runs in `packaged-win` and `packaged-linux`.
- The same bundle was run as an ES module under the Electron binary (`ELECTRON_RUN_AS_NODE`) with the grammar
  external, as the main process loads it: `parser: 'bash-grammar'` and the same verdicts.

## Residual risks

1. **Reads inside the project that are not secret-named.** `cat src/config.ts` is approved. An agent steered by
   hostile text can read project files; sending them anywhere needs a network command or tool, which asks.
2. **MCP tools** have their own per-tool rules and are not part of this list.
3. **PowerShell** has no grammar here; it uses the text splitter, which is conservative but not a parser.
4. **`git log -p` / `git show`** print file contents from history, including files since deleted.
5. The CLI may run a command that was approved here with a different effective working directory.

## Rollback

1. User level, immediate: Thread > Rules > turn off "Approve read-only commands automatically". Saved rules continue.
2. Release level: the switch default is the single `row ? row.value !== '0' : true` in
   `ThreadPermissionStore.autoApproveReads`; changing it to `false` ships the list off in a patch release.
3. The migration is additive; leaving the `thread_settings` table in place on a downgrade is harmless.
