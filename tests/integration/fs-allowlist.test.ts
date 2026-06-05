import { readFile, readdir } from 'node:fs/promises'
import { join, relative } from 'node:path'
import { describe, expect, test } from 'vitest'

const ALLOWED_FS_IMPORTS = new Set([
  'electron/main/services/file-system.service.ts',
  'electron/main/services/agent.service.ts',
  'electron/main/services/background.service.ts',
  'electron/main/services/git.service.ts',
  'electron/main/services/github.service.ts',
  'electron/main/services/integration.service.ts',
  'electron/main/services/mcp-sync.service.ts',
  'electron/main/services/session.service.ts',
  'electron/main/services/shell-profile.service.ts',
  'electron/main/services/skill.service.ts',
  'electron/main/services/terminal.service.ts',
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
  // Internal MCP bootstrap: materializes the bridge script under
  // <userData>/bin and hash-checks it against the packaged source. Needs
  // raw fs to do that atomically on every boot.
  'electron/main/mcp-internal/bootstrap.ts',
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
  'electron/main/services/semantic.service.ts'
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
