// @vitest-environment node
// Frozen acceptance test for OXE-444 (A4): WorktreeProvisionReport propagation across OxeCode, OxeChat, Delegation and MCP.
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { openInMemoryDatabase } from '../../../electron/main/db'
import { handlers as mcpHandlers } from '../../../electron/main/mcp-internal/tool-handlers'
import type { ToolContext } from '../../../electron/main/mcp-internal/tool-registry'
import { createThreadWorktree } from '../../../electron/main/services/conversation/thread-worktree'
import { DelegationGitProvisioner } from '../../../electron/main/services/delegation/delegation-git-provisioner'
import type { DelegationRepository } from '../../../electron/main/services/delegation/delegation.repository'
import { GhExec } from '../../../electron/main/services/github/gh-exec'
import { GitHubRepositoryService } from '../../../electron/main/services/github/repository.service'
import { projectIdentity } from '../../../electron/main/services/project-identity'
import { RepoHookTrust } from '../../../electron/main/services/repo-config/trust'
import type { DelegationTask } from '../../../shared/types/delegation'
import { removeTempDir } from '../../helpers/removeTempDir'

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 })

let sandbox: string
let repo: string
let closeDb: () => void
let service: GitHubRepositoryService

function put(base: string, rel: string, text = rel): void {
  const file = join(base, ...rel.split('/'))
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, text)
}

function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8' })
}

beforeEach(() => {
  sandbox = realpathSync.native(mkdtempSync(join(tmpdir(), 'oxe444-a4-')))
  repo = join(sandbox, 'repo')
  mkdirSync(repo, { recursive: true })
  git(repo, 'init', '-q', '-b', 'main')
  git(repo, 'config', 'user.email', 'oxe444@test.invalid')
  git(repo, 'config', 'user.name', 'OXE-444')
  put(repo, '.gitignore', 'node_modules/\nconfig/*.local.json\n')
  put(repo, 'oxe.yaml', [
    'scripts:',
    '  setup: echo setup-unapproved',
    'worktree:',
    '  sharedDirectories:',
    '    - node_modules',
    '  copyFiles:',
    '    - config/*.local.json',
    ''
  ].join('\n'))
  git(repo, 'add', '.')
  git(repo, 'commit', '-qm', 'init')
  put(repo, 'node_modules/pkg/index.js', 'module.exports = 1')
  put(repo, 'config/dev.local.json', '{"dev":true}')

  const db = openInMemoryDatabase()
  closeDb = () => db.close()
  service = new GitHubRepositoryService(new GhExec({}))
  service.configureWorktreeLifecycle({ trust: new RepoHookTrust(db), stopTerminalsWithin: () => [] })
})

afterEach(() => {
  closeDb()
  try { removeTempDir(sandbox) } catch { /* temp dir */ }
})

describe('OXE-444 A4 · WorktreeProvisionReport propagation across all callers', () => {
  it('propagates WorktreeProvisionReport across repository service, OxeChat thread-worktree, Delegation provisioner and MCP createWorktree', async () => {
    // 1. Repository service (OxeCode)
    const wtCode = join(sandbox, 'wt-code')
    const codeResult = await service.createWorktree({
      rootPath: repo,
      branch: 'feat/a4-code',
      path: wtCode,
      createBranch: true,
      baseRef: 'main'
    })
    expect(codeResult.report).toBeDefined()
    expect(codeResult.report?.sources).toEqual(['oxe.yaml'])
    expect(codeResult.report?.linked).toEqual(['node_modules'])
    expect(codeResult.report?.copied).toEqual(['config/dev.local.json'])
    expect(codeResult.report?.hookStatus).toBe('skipped-untrusted')
    expect(codeResult.report?.notices.some((n) => n.code === 'worktree.setup.notApproved')).toBe(true)

    // 2. OxeChat createThreadWorktree
    const threadCreated = await createThreadWorktree(
      {
        createWorktree: (input) => service.createWorktree(input),
        resolveBaseRef: async () => 'main'
      },
      repo,
      { branch: 'feat/a4-thread' }
    )
    expect(threadCreated.report).toBeDefined()
    expect(threadCreated.report?.linked).toEqual(['node_modules'])
    expect(threadCreated.report?.copied).toEqual(['config/dev.local.json'])
    expect(threadCreated.report?.hookStatus).toBe('skipped-untrusted')
    expect(threadCreated.notices?.some((n) => n.code === 'worktree.setup.notApproved')).toBe(true)

    // 3. DelegationGitProvisioner
    const headSha = git(repo, 'rev-parse', 'HEAD').trim()
    const projId = await projectIdentity(repo)
    const wtDelegation = join(sandbox, 'wt-delegation')
    const journalCalls: Array<{ op: string; state: string; detail?: Record<string, unknown> }> = []
    const mockRepo = {
      operationSucceeded: () => false,
      journal: (_taskId: string, op: string, _gen: number, state: string, detail?: Record<string, unknown>) => {
        journalCalls.push({ op, state, detail })
      },
      save: vi.fn()
    } as unknown as DelegationRepository

    const provisioner = new DelegationGitProvisioner(
      service,
      mockRepo,
      async (cwd, args) => git(cwd, ...args).trim()
    )
    const task: DelegationTask = {
      id: 'del-a4-1',
      workspaceId: 'ws-1',
      project: projId,
      originPaneId: 'pane-1',
      originExecutionId: 'exec-1',
      key: 'k1',
      agentProfileId: 'claude',
      objective: 'Test worktree report',
      handoff: 'handoff',
      acceptance: 'acceptance',
      cwd: repo,
      path: wtDelegation,
      branch: 'feat/a4-delegation',
      baseSha: headSha,
      localChanges: '',
      state: 'preparing',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      checkout: {
        strategy: 'create',
        branch: 'feat/a4-delegation',
        baseRef: 'main',
        baseSha: headSha,
        path: wtDelegation,
        createBranch: true,
        reuseExistingWorktree: false,
        fetchBase: false,
        resolvedAt: Date.now()
      }
    }

    await provisioner.apply(task)
    expect(task.provisionReport).toBeDefined()
    expect(task.provisionReport?.linked).toEqual(['node_modules'])
    expect(task.provisionReport?.copied).toEqual(['config/dev.local.json'])
    expect(task.provisionReport?.hookStatus).toBe('skipped-untrusted')
    expect(task.provisionNotices?.some((n) => n.code === 'worktree.setup.notApproved')).toBe(true)
    const succeededEntry = journalCalls.find((c) => c.op === 'git-checkout' && c.state === 'succeeded')
    expect(succeededEntry?.detail?.provisionReport).toMatchObject({
      linked: ['node_modules'],
      copied: ['config/dev.local.json'],
      hookStatus: 'skipped-untrusted'
    })

    // 4. MCP oxespace_create_worktree
    const wtMcp = join(sandbox, 'wt-mcp')
    const emitChanged = vi.fn()
    const mcpCtx = {
      workspaceId: 'ws-1',
      workspaceServ: { get: () => ({ id: 'ws-1', rootPath: repo, name: 'repo' }) },
      github: service,
      worktree: { emitChanged }
    } as unknown as ToolContext

    const mcpResponse = await mcpHandlers.createWorktree(
      { path: wtMcp, branch: 'feat/a4-mcp', createBranch: true, baseRef: 'main', fetchBase: false },
      mcpCtx
    )
    expect(mcpResponse.isError).toBeFalsy()
    const parsedMcp = JSON.parse(mcpResponse.content[0].text) as {
      ok: boolean
      report?: { linked: string[]; copied: string[]; hookStatus: string; notices: Array<{ code: string }> }
    }
    expect(parsedMcp.ok).toBe(true)
    expect(parsedMcp.report?.linked).toEqual(['node_modules'])
    expect(parsedMcp.report?.copied).toEqual(['config/dev.local.json'])
    expect(parsedMcp.report?.hookStatus).toBe('skipped-untrusted')
    expect(parsedMcp.report?.notices.some((n) => n.code === 'worktree.setup.notApproved')).toBe(true)
  })
})
