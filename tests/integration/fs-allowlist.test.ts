import { readFile, readdir } from 'node:fs/promises'
import { join, relative } from 'node:path'
import { describe, expect, test } from 'vitest'

const ALLOWED_FS_IMPORTS = new Set([
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
  'electron/main/services/mcp-sync.service.ts',
  // Reads the user-level MCP config files of Claude Desktop, Cursor and Windsurf at their fixed locations
  // (512 KiB at most, JSON only); the renderer never supplies a path.
  'electron/main/services/mcp-import.service.ts',
  // Optional local memory infrastructure: runtime/config/credentials and agent
  // home configuration, analogous to MCP sync/bootstrap. Never arbitrary source
  // file reads or terminal transcripts. Project probes below read only identity
  // and .ai-memory.toml routing policy; the adapter writes that opt-in marker.
  'electron/main/services/memory/memory-runtime.ts',
  'electron/main/services/memory/memory.service.ts',
  'electron/main/services/memory/agent-memory-adapter.ts',
  'electron/main/services/memory/memory-project.service.ts',
  'electron/main/services/memory/memory-marker.ts',
  // Memory upgrade transaction (journal, snapshot, candidate): fixed children of
  // the application's private memory runtime directory; never workspace paths.
  'electron/main/services/memory/memory-migration.ts',
  // Producer-owned, crash-recoverable delivery queue under the private memory
  // directory; files carry opaque names and are never derived from workspace paths.
  'electron/main/services/memory/memory-outbox.ts',
  // Read-only size inventory of the private memory directory: counts bytes, never reads
  // file contents, follows no links and deletes nothing.
  'electron/main/services/memory/memory-storage.ts',
  // "Erase all stored memory" in Settings: removes only the managed store's `data` and `upgrade-2.6.2` folders,
  // each a direct child of the private memory directory (checked before removing); no workspace path is ever used.
  'electron/main/services/memory/memory-control.ts',
  // Reads one small JSON flag file (<userData>/experimental.json); no workspace path involved.
  'electron/main/services/experimental-features.ts',
  // Reads the app's own translation catalogs (locales/<language>/main.json next to the bundle); fixed names only.
  'electron/main/i18n.ts',
  // Stat only: confirms that a project root sent by the renderer is an existing directory before a process
  // (the oxe CLI, a dashboard server) starts in it. Reads, lists and writes nothing.
  'electron/main/ipc/ipc-guards.ts',
  // The optional semantic model and its settings/usage counters under userData/models only; an import copies
  // the four model files from the folder the user picked in a native dialog. Never touches workspace files.
  'electron/main/services/semantic-model-store.ts',
  // Streams the RTK archive the app itself downloaded to hash it before extraction.
  'electron/main/services/rtk-checksum.ts',
  // Documentation owns generated artifacts under userData/documentation only.
  // Tool callers supply IDs, never filesystem paths or workspace destinations.
  'electron/main/services/documentation/documentation.service.ts',
  // Preview captures are app-owned PNGs under <userData>/web-preview-captures.
  // The store validates owner and basename and refuses to overwrite a file.
  'electron/main/services/documentation/preview-capture-store.ts',
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
  // Transactional Thread checkpoints are a dedicated filesystem boundary:
  // they canonicalize the Thread root, reject traversal/symlinks, hash every
  // postimage and restore through temp+rename without destructive Git calls.
  'electron/main/services/conversation/thread-checkpoints.ts',
  // Thread project registration only canonicalizes and checks the selected
  // directory; source-file reads and writes remain in FileSystemService.
  'electron/main/services/conversation/thread-projects.ts',
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
  // transcript beside it (flag 'wx'); the original is never modified.
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
  'electron/main/services/oxequery/compose.ts',
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
  // Source files are never read or written.
  'electron/main/services/repo-config/loader.ts',
  'electron/main/services/repo-config/shared-dirs.ts',
  'electron/main/services/github/worktree-removal.ts',
  // Cleanup scan: stat-only probes of a worktree's own git metadata (HEAD,
  // reflog tail) to estimate idleness. Never reads source files.
  'electron/main/services/github/worktree-cleanup.ts',
  // Repository identity: reads only `.git` and the `gitdir`/`commondir` pointers of a checkout to tell
  // whether two directories are worktrees of the same repository. Never reads source files.
  'electron/main/services/git-common-dir.ts',
  // New-conversation worktree: only checks whether the folder it is about to create already exists and
  // resolves its real path. Never reads files.
  'electron/main/services/conversation/thread-worktree.ts',
  // Session search index: read-only scan of the agents' own transcript
  // folders (~/.claude/projects, ~/.codex/sessions) into a private cache file.
  // Outside the workspace tree; transcripts are never written.
  'electron/main/services/session-search/index.ts',
  // Agent status hooks: writes one managed hook script under <userData> and
  // merges our entries into the agents' own config (~/.claude/settings.json,
  // ~/.codex/hooks.json). Outside the workspace tree; never source files.
  'electron/main/services/agent-hooks/installer.ts',
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
  // The list of Thread projects with semantic search turned on: one JSON file under userData.
  'electron/main/services/semantic-projects.ts',
  // The audit export is written only to a path returned by Electron's native save dialog.
  'electron/main/ipc/mcp-internal.ipc.ts',
  // Portable conversation packages are read/written only at a path returned
  // by Electron's native open/save dialogs; package validation remains in the
  // Thread portable service and imported content is inert.
  'electron/main/ipc/thread.ipc.ts',
  // Reads provider-owned JSONL history outside the workspace, through a path
  // resolved and identity-checked by NativeSessionReader. No renderer path input.
  'electron/main/services/conversation/native-history-page.ts',
  'electron/main/services/diagnostics.service.ts',
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
  // OXEVoice engine: downloads the Whisper model to <userData>/models and
  // writes a temp WAV for the CLI — outside the workspace tree, so raw fs is
  // appropriate here rather than the workspace-scoped FileSystemService.
  'electron/main/services/voice.service.ts',
  // OXE integration: existsSync(`<root>/.oxe`) to decide onboarding vs status —
  // a read-only project probe, not a workspace file operation.
  'electron/main/services/oxe.service.ts',
  // RTK Service: downloads rtk.exe to <userData>/bin for token savings.
  'electron/main/services/rtk.service.ts',
  // Semantic Service: indexes the workspace tree for local embeddings (reads
  // arbitrary files to embed) and creates the transformers.js model cache under
  // <userData>/models. Background indexing outside the workspace-scoped
  // FileSystemService, like rtk/voice above.
  'electron/main/services/semantic.service.ts',
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
  // OxePost collections: request and environment files under <workspace>/.oxespace/requests only. The renderer sends
  // relative paths that are validated segment by segment (no "..", no backslash, .http files, four levels at most),
  // resolved under that folder and checked again through realpath; links are skipped, reads are capped at 256 KiB.
  'electron/main/services/oxepost/store.ts',
  // OxePost secrets: one encrypted file under <userData> (safeStorage; refused where only obfuscation exists), mode 0600,
  // written by temp file and rename. No workspace path is read or written, and no value is ever returned to the page.
  'electron/main/services/oxepost/secrets.ts'
])

describe('workspace fs allowlist', () => {
  test('keeps workspace filesystem operations in FileSystemService', async () => {
    const root = process.cwd()
    const files = await listFiles(join(root, 'electron'))
    const offenders: string[] = []

    for (const file of files) {
      const rel = relative(root, file).replaceAll('\\', '/')
      if (!rel.endsWith('.ts')) continue
      // Vendored third-party code (electron/main/vendor/**, e.g. the embedded
      // CodeGraph engine) is not workspace-scoped file I/O and is outside this
      // sandbox policy — it manages its own .oxe/codegraph.db + cache.
      if (rel.includes('/vendor/')) continue
      const source = await readFile(file, 'utf8')
      const importsFs = /from ['"]node:fs/.test(source) || /from ['"]fs/.test(source)
      if (importsFs && !ALLOWED_FS_IMPORTS.has(rel)) {
        offenders.push(rel)
      }
    }

    expect(offenders).toEqual([])
  })
})

async function listFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true })
  const files = await Promise.all(
    entries.map((entry) => {
      const fullPath = join(directory, entry.name)
      return entry.isDirectory() ? listFiles(fullPath) : [fullPath]
    })
  )
  return files.flat()
}
