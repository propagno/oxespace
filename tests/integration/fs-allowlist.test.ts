import { readFile, readdir } from 'node:fs/promises'
import { join, relative } from 'node:path'
import { describe, expect, test } from 'vitest'

const ALLOWED_FS_IMPORTS = new Set([
  // B18: realpaths and stats only to authorize a workspace path and check an editor executable; reads and writes
  // only <userData>/open-in.json.
  'electron/main/services/open-in.ts',
  'electron/main/services/file-system.service.ts',
  'electron/main/services/agent.service.ts',
  'electron/main/services/background.service.ts',
  'electron/main/services/git.service.ts',
  // Narrower than it used to be: the whole 1124-line github.service.ts held
  // this exemption, but after the split only the execution kernel touches raw
  // fs — existsSync, to locate the gh binary. The four collaborators above it
  // cannot reach the filesystem at all.
  'electron/main/services/github/gh-exec.ts',
  'electron/main/services/integration.service.ts',
  // safe-git's stamps: stats the files git read for a repository's config (and HEAD, `.git`, `commondir`) to know
  // when git must find the dirs or read the config again, and resolves the cwd's real path. Reads and writes nothing.
  'electron/main/utils/git-dir.ts',
  'electron/main/services/mcp-sync.service.ts',
  // Reads the user-level MCP config files of Claude Desktop, Cursor and Windsurf at their fixed locations
  // (512 KiB at most, JSON only); the renderer never supplies a path.
  'electron/main/services/mcp-import.service.ts',
  // Project identity (R0a, out of memory): realpath of the folder and of its Git common dir only. Never reads or
  // writes file contents.
  'electron/main/services/project-identity.ts',
  // Owner-only JSON (R0a, out of memory): reads and writes, by temp file and rename (mode 0600), the app's own config
  // files its callers name (agent hook configs, memory runtime files); never a path from the renderer.
  'electron/main/services/private-json.ts',
  // F7 A26 (SECURITY S2): reads and atomically writes only <project>/.claude/settings.local.json (temp file + rename),
  // after lstat/realpath checks confirm neither .claude nor settings.local.json links outside the project root.
  'electron/main/services/approvals/always-allow.ts',
  // Reads one small JSON flag file (<userData>/experimental.json); no workspace path involved.
  'electron/main/services/experimental-features.ts',
  // Reads the app's own translation catalogs (locales/<language>/main.json next to the bundle); fixed names only.
  'electron/main/i18n.ts',
  // The English catalog (locales/en/main.json), for the C3 refusals agents read (B10); a fixed name only.
  'electron/main/agent-text.ts',
  // Stat only: confirms that a project root sent by the renderer is an existing directory before a process
  // (the oxe CLI, a dashboard server) starts in it. Reads, lists and writes nothing.
  'electron/main/ipc/ipc-guards.ts',
  // Stat and one directory open only: confirms that a workspace root is an absolute path to a folder that
  // exists and can be listed, before `workspace:create` writes anything. Reads, lists and writes nothing.
  'electron/main/services/workspace-root.ts',
  // Preview captures are app-owned PNGs under <userData>/web-preview-captures.
  // The store validates owner and basename and refuses to overwrite a file.
  'electron/main/services/browser-preview/preview-capture-store.ts',
  'electron/main/services/session.service.ts',
  // Conversation transports probe installed executables only. Native history
  // reads UUID-selected ~/.claude session logs, never arbitrary source paths.
  // Command discovery reads only bounded configured skill/command Markdown;
  // renderer callers provide Thread IDs and command names, not read paths.
  'electron/main/services/conversation/process-transport.ts',
  'electron/main/services/conversation/thread-cli.ts',
  'electron/main/services/conversation/native-session-history.ts',
  'electron/main/services/conversation/thread-commands.ts',
  // Claude's transport materializes a bounded temporary MCP config and removes
  // it after the process exits. Thread attachments live in the app's private
  // userData area under opaque IDs; neither accepts arbitrary workspace paths.
  'electron/main/services/conversation/claude-conversation.ts',
  'electron/main/services/conversation/thread-attachments.ts',
  // Antigravity's ACP takes an image as base64: the adapter reads only the attachment paths the store above issued.
  'electron/main/services/conversation/antigravity-conversation.ts',
  // Transactional Thread checkpoints are a dedicated filesystem boundary:
  // they canonicalize the Thread root, reject traversal/symlinks, hash every
  // postimage and restore through temp+rename without destructive Git calls.
  'electron/main/services/conversation/thread-checkpoints.ts',
  // F4 places (A13): checks that an evidence path's folder exists and walks it
  // for links (lstat/stat/exists only). It never reads or writes file content.
  'electron/main/services/conversation/thread-places.ts',
  // A16 path resolver: lstat only, to tell whether a named path exists under a base and crosses no link. It never
  // reads or writes file content and never creates a place.
  'electron/main/services/conversation/thread-path-resolver.ts',
  // A17 place read (SECURITY S2): read-only, one regular text file under a place from tool evidence. Every component is
  // lstat'ed and a link is never crossed; realpath containment, O_NOFOLLOW and a dev/ino recheck guard the open. It
  // never writes, and FileSystemService's roots are unchanged.
  'electron/main/services/conversation/thread-place-read.ts',
  // A15 branch drift: existsSync on the paths git names for an operation in progress (rebase-merge, MERGE_HEAD,
  // BISECT_LOG...); CR-F4-2b readHeadSync stats and reads only git's own .git file, HEAD, commondir, loose refs and
  // packed-refs, to take a place's HEAD in an event handler. It never reads working-tree content and never writes.
  'electron/main/services/conversation/thread-place-drift.ts',
  // A14 Undo (person-only, SECURITY 08/11): stat for a written file's mtime (the stale check) and, in Discard, lstat +
  // unlink of one file the task created, only when it resolves inside the place. Every other change is git apply
  // through safe git; it never reads file content and never writes anything else.
  'electron/main/services/conversation/thread-place-undo.ts',
  // Thread project registration only canonicalizes and checks the selected
  // directory; source-file reads and writes remain in FileSystemService.
  'electron/main/services/conversation/thread-projects.ts',
  // A18 (T73) pane branch: existsSync on the pane's cwd before asking safe git for its branch. Reads, lists and
  // writes nothing.
  'electron/main/services/terminal/pane-branch.ts',
  // @-mention context: reads only files the user named in the prompt, inside
  // the Thread's project (Windows-aware containment, links followed), bounded
  // per file and in total, and only as prompt text. Never writes.
  'electron/main/services/conversation/thread-context-resolver.ts',
  // /instructions: stats the CLAUDE.md / AGENTS.md files the provider CLI
  // would load and lists .claude/rules. For a rule it reads only the first 4 KiB
  // to find the `paths:` it is limited to. Never writes.
  'electron/main/services/conversation/instruction-sources.ts',
  // Agent state: reads detection manifests (*.toml) from the app's own
  // userData/agent-detection override folder, never the workspace. Never writes.
  'electron/main/services/agent-state/manifest.ts',
  // B17: whether a pane's recorded agent session is still on disk before it is resumed. Stats
  // <claude>/projects/<encoded cwd>/<id>.jsonl and lists the dated folders of <codex>/sessions for a rollout named
  // after the id. The id is a UUID the hooks or main recorded; never a path from the renderer. No contents, no writes.
  // For Claude it also realpaths the pane root and lists <claude>/projects once; a project folder holding the id is
  // decoded through the folder names on the way down to it (bounded), and accepted only if it resolves to the root.
  'electron/main/services/agent-state/native-session-files.ts',
  // Shell parsing: existence probes for the bash grammar and the tree-sitter runtime wasm at
  // fixed app-asset locations. Never a path from the renderer or the agent, never contents.
  'electron/main/services/conversation/shell-parse.ts',
  // Permission rules: only realpath() on paths an agent asked to edit, so a
  // link or junction out of the project is judged by its target. Never reads
  // or writes file contents.
  'electron/main/services/conversation/thread-permissions.ts',
  // First-message project brief: reads package.json (size-bounded) and checks a
  // few manifest files exist. Never other contents, never writes.
  'electron/main/services/conversation/project-brief.ts',
  // Model-default detection reads only the fixed, size-bounded provider
  // settings files (project .claude/.codex and the user's provider home).
  'electron/main/services/conversation/thread-model-override.ts',
  // Rewinds a Claude session by writing a prefix copy of one UUID-named JSONL
  // transcript beside it (flag 'wx'); the original is never modified. Closing a side chat (B1.2) unlinks only
  // its own copy, `<forkId>.jsonl` for the UUID OXESpace created, and refuses the main session's id.
  'electron/main/services/conversation/claude-transcript-fork.ts',
  // Reads one user-chosen certificate or key (64 KiB at most) from a native open dialog;
  // the renderer supplies a kind, never a path.
  'electron/main/services/oxequery/file-picker.ts',
  // Streams an export to the one file the person chose in a native save dialog (flag 'wx', mode 0600,
  // removed again when cancelled); the renderer supplies a format, never a path.
  'electron/main/services/oxequery/export-writer.ts',
  // Reads the one file chosen in a native open dialog (200 MB cap, streamed) and, for rows it cannot
  // read, writes `<file>.rejects.ndjson` beside it with flag 'wx'; the renderer never supplies a path.
  'electron/main/services/oxequery/import-reader.ts',
  // Writes an Excel workbook to the one file chosen in a native save dialog (flag 'wx', mode 0600, removed
  // again when cancelled), staging the sheet in a private temporary directory it removes afterwards.
  'electron/main/services/oxequery/xlsx-writer.ts',
  // The connections export and import: one file chosen in a native dialog (flag 'wx' on write, 2 MB cap on
  // read); the renderer supplies no path and the file carries no secret.
  'electron/main/services/oxequery/connection-transfer.ts',
  // Checks that a Compose project's folder and files exist before running compose there; the paths come from
  // the engine's own container labels, never from the renderer.
  'electron/main/services/oxepod/compose.ts',
  'electron/main/services/shell-profile.service.ts',
  'electron/main/services/skill.service.ts',
  'electron/main/services/terminal.service.ts',
  // Delegation performs existence probes only: executable selection and worktree
  // recovery. GitHubWorktreeApi owns creation; neither reads/writes source files.
  'electron/main/services/agent-launch.service.ts',
  'electron/main/services/delegation/delegation-git-provisioner.ts',
  // Worktree lifecycle: reads only the bounded <root>/oxe.yaml, links/unlinks
  // the repo's declared shared directories (lstat-guarded, never following a
  // link) and finishes deleting a worktree folder git already de-registered.
  // worktree-removal also resolves a worktree path's real, long name
  // (realpath, read-only) to compare it with git's list. Source files are
  // never read or written.
  'electron/main/services/repo-config/loader.ts',
  'electron/main/services/repo-config/shared-dirs.ts',
  'electron/main/services/github/worktree-removal.ts',
  // B19 worktree.copyFiles: copies the files the repo's oxe.yaml lists from the
  // main checkout into a just-created worktree. Patterns stay in the repo (no
  // absolute, .. or .git), links are never followed on either side, real paths
  // are checked against both roots, at most 200 files / 50 MB, and nothing
  // existing is overwritten (COPYFILE_EXCL). Never edits a file in place.
  'electron/main/services/repo-config/worktree-include.ts',
  // Cleanup scan: stat-only probes of a worktree's own git metadata (HEAD,
  // reflog tail) to estimate idleness. Never reads source files.
  'electron/main/services/github/worktree-cleanup.ts',
  // A63 Worktrees panel: lstat and readdir only, to tell whether a registered worktree folder is still there and to
  // add up its disk use (never follows a link or junction, stops after 200k entries). It never reads or writes file
  // content; removal goes through worktree-removal.ts.
  'electron/main/services/github/worktrees-panel.ts',
  // Repository identity: reads only `.git` and the `gitdir`/`commondir` pointers of a checkout to tell
  // whether two directories are worktrees of the same repository. Never reads source files.
  'electron/main/services/git-common-dir.ts',
  // New-conversation worktree: only checks whether the folder it is about to create already exists and
  // resolves its real path. Never reads files.
  'electron/main/services/conversation/thread-worktree.ts',
  // F8 A30 branch from checkpoint: probes whether the target sibling worktree folder already exists, resolves its
  // canonical path after git worktree add, and removes the empty/failed worktree folder on rollback; checkpoint file
  // writes stay in thread-checkpoints.ts.
  'electron/main/services/conversation/thread-branch.ts',
  // Conversation worktree finish: only checks whether the app-owned worktree folder still exists before
  // asking Git for its state. Never reads or writes files.
  'electron/main/services/conversation/thread-worktree-lifecycle.ts',
  // Session search index: read-only scan of the agents' own transcript
  // folders (~/.claude/projects, ~/.codex/sessions) into a private cache file.
  // Outside the workspace tree; transcripts are never written.
  'electron/main/services/session-search/index.ts',
  // Agent status hooks: writes one managed hook script under <userData> and
  // merges our entries into the agents' own config (~/.claude/settings.json,
  // ~/.codex/hooks.json). Outside the workspace tree; never source files.
  'electron/main/services/agent-hooks/installer.ts',
  // G4 (1.5.0): removes retired AI Memory hook entries from the user's Claude and Codex config files and deletes
  // <userData>/memory/adapters; never a workspace path or a path from the renderer.
  'electron/main/services/agent-hooks/legacy-cleanup.ts',
  // Trusted UI repository registration: realpath identity probes only. No
  // source file reads/writes; evidence reads committed blobs through Git.
  'electron/main/services/coordination/workspace-resolver.ts',
  'electron/main/services/usage/claudeProvider.ts',
  'electron/main/services/usage/codexProvider.ts',
  'electron/main/services/usage/copilotProvider.ts',
  // AI usage/credits chips: read account-wide quota from outside the
  // workspace tree (~/.codex rollout logs, ~/.claude credentials) — a
  // read-only probe, not a workspace file operation.
  'electron/main/services/agentCredits/codexCredits.service.ts',
  'electron/main/services/agentCredits/claudeCredits.service.ts',
  // Context-window % chip: reads Copilot's process logs (~/.copilot/logs) and
  // session workspace.yaml — outside the workspace tree, read-only.
  'electron/main/services/contextUsage/copilotContext.ts',
  'electron/main/index.ts',
  'electron/main/db/index.ts',
  // Diagnostics writes a report only to a path explicitly selected through
  // Electron's native save dialog. Runtime recording owns three bounded files
  // under userData/diagnostics and probes executable realpaths, never source files.
  'electron/main/services/runtime-diagnostics.ts',
  'electron/main/ipc/diagnostics.ipc.ts',
  // Deletes only the app's own stale backups and crash dumps under userData (fixed directories, age-based); the live database and WAL are never listed.
  'electron/main/services/storage-retention.ts',
  // The audit export is written only to a path returned by Electron's native save dialog.
  'electron/main/ipc/mcp-internal.ipc.ts',
  // R0b: the one-time export of the removed features' data. Writes only <userData>/exports/1.5-removed-<ts>.json
  // (flag 'wx', mode 0600) and <userData>/exports/state.json, and lists that folder for the newest export; it stats
  // the removed features' fixed files under <userData> and under the known workspace roots' .oxe/.oxespace folders.
  // Never a path from the renderer, never source file contents.
  'electron/main/services/data-export/removed-features-export.ts',
  // Portable conversation packages are read/written only at a path returned
  // by Electron's native open/save dialogs; package validation remains in the
  // Thread portable service and imported content is inert.
  'electron/main/ipc/thread.ipc.ts',
  // Reads provider-owned JSONL history outside the workspace, through a path
  // resolved and identity-checked by NativeSessionReader. No renderer path input.
  'electron/main/services/conversation/native-history-page.ts',
  'electron/main/services/diagnostics.service.ts',
  // B8.3 incident journal: one JSON file, <userData>/diagnostics/incidents.json, written to a temporary file beside it
  // and renamed (flag 'wx', mode 0600). Codes and hashed ids only; no caller supplies a path.
  'electron/main/services/diagnostics/incident-journal.ts',
  // B8.3 measurements: statfs of the userData volume, sizes of the database (with WAL) and of the app's log folders,
  // and a stat-only PATH probe for known CLI names. Never reads contents, never writes.
  'electron/main/services/diagnostics/metrics.ts',
  // B8.3 bundle: reads the last 256 KiB of the app's own electron-log files (fixed names), which are then cut to time,
  // level and fixed words and redacted. The .zip itself is written by diagnostics.ipc.ts to the save-dialog path.
  'electron/main/services/diagnostics/bundle.ts',
  // Internal MCP bootstrap: materializes the bridge script under
  // <userData>/bin and hash-checks it against the packaged source. Needs
  // raw fs to do that atomically on every boot.
  'electron/main/mcp-internal/bootstrap.ts',
  // Long internal MCP tool results keep their full text under <userData>/tool-output, in files named by the
  // tool, the time and a random id, never by caller arguments; files older than a week are deleted.
  'electron/main/mcp-internal/tool-result-bound.ts',
  // Reads three policy files at fixed places (the project's .oxespace/policy.json, <userData>/policy.json and the
  // machine-wide managed file), 256 KiB at most, JSON only; it never writes, and no caller supplies a path.
  'electron/main/services/policy/policy-store.ts',
  // B7.4: the managed policy's write probe (open r+, create and remove an empty probe file beside it, Windows) and its
  // owner and mode (elsewhere), on the fixed managed path only; never a workspace path, never a caller-supplied one.
  'electron/main/services/policy/accepted-config.ts',
  // B7.4: stat and read of <root>/oxe.yaml (256 KiB at most) for its tool modes, like repo-config/loader.ts; never writes.
  'electron/main/services/policy/tool-config.ts',
  // B7.4: reads the first characters of a gated policy file (fixed places only) for the request's untrusted text; never writes.
  'electron/main/ipc/policy-runtime.ts',
  // OXE integration: existsSync(`<root>/.oxe`) to decide onboarding vs status —
  // a read-only project probe, not a workspace file operation.
  'electron/main/services/oxe.service.ts',
  // Search Service: Find in Files delegates the actual file reads to the
  // ripgrep child process; its only raw fs use is existsSync to locate the
  // bundled rg binary and validate the search root — a read-only probe.
  'electron/main/services/search.service.ts',
  // F3 execution host: the seam that runs commands and reads/writes files on
  // behalf of the runtime. It IS the abstraction other code is supposed to use
  // instead of raw fs, so it necessarily holds the raw calls itself.
  'electron/main/runtime/execution-host.ts',
  // F3 RPC bus: writes only <userData>/rpc-endpoint.json so out-of-process
  // callers can find the local socket — never a workspace path.
  'electron/main/runtime/rpc/server.ts',
  // Reads and writes only <userData>/update-preferences.json (how the app
  // updates itself) — never a workspace path.
  'electron/main/updater.ts',
  // Reads and writes only <userData>/ui-scale.json (the interface zoom the next
  // window starts at, so boot has no 100% first frame) — never a workspace path.
  'electron/main/ipc/appearance.ipc.ts',
  // BE-A46-c5 (1.5.0 F10): a terminal agent's own conversation for the phone. Stats, reads and watches only the one
  // native session file the pane's recorded session names (Claude's <claudeHome>/projects/<cwd>/<id>.jsonl or Codex's
  // rollout), and lists only Codex's sessions/<year>/<month>/<day> folders to find it. Never a path from the phone.
  'electron/main/services/remote/pane-conversation.ts',
  'electron/main/services/http-audit/codex-rollout.ts',
  // F5 (A52): saves a person-requested Android screenshot PNG under <Pictures>/OXESpace with a generated basename;
  // the renderer sends only a validated adb serial, never a path. It also checks (lstat) the APK the person picked in
  // the system's file dialog before handing its path to adb.
  'electron/main/ipc/android.ipc.ts',
  // Looks for adb and the emulator in the Android SDK's usual folder (existsSync only): nothing is read or written.
  'electron/main/services/android/android-devices.ts',
  // F11 (A65): exports the local feature-usage summary JSON only to the path chosen in Electron's native save dialog
  // (mode 0600); never reads files and never accepts a path from the renderer.
  'electron/main/services/usage/usage-count.ts'
])

describe('workspace fs allowlist', () => {
  test('keeps workspace filesystem operations in FileSystemService', async () => {
    const root = process.cwd()
    const files = await listFiles(join(root, 'electron'))
    const offenders: string[] = []

    for (const file of files) {
      const rel = relative(root, file).replaceAll('\\', '/')
      if (!rel.endsWith('.ts')) continue
      // Vendored third-party code (electron/main/vendor/**) is not workspace-scoped
      // file I/O and is outside this sandbox policy.
      if (rel.includes('/vendor/')) continue
      const source = await readFile(file, 'utf8')
      const importsFs = /from ['"]node:fs/.test(source) || /from ['"]fs/.test(source)
      if (importsFs && !ALLOWED_FS_IMPORTS.has(rel)) {
        offenders.push(rel)
      }
    }

    expect(offenders).toEqual([])
    // FL-25: it walks the whole electron/ tree; under pr:ready (Electron ABI, 2 workers) that once passed 5 s.
  }, 20_000)
})

async function listFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true })
  const files = await Promise.all(
    entries.map((entry) => {
      const fullPath = join(directory, entry.name)
      // Vendored code is skipped by the test anyway (`/vendor/`); not walking it saves most of the time (FL-25).
      if (entry.isDirectory() && entry.name === 'vendor') return []
      return entry.isDirectory() ? listFiles(fullPath) : [fullPath]
    })
  )
  return files.flat()
}
