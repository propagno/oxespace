// @vitest-environment jsdom
// Frozen acceptance test for OXE-444 (A5): pure dry-run parity, safe template save, IPC/MCP governance, and UI presets/preview.
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { openInMemoryDatabase } from '../../../electron/main/db'
import { GhExec } from '../../../electron/main/services/github/gh-exec'
import { GitHubRepositoryService } from '../../../electron/main/services/github/repository.service'
import { readWorktreeTemplate, saveWorktreeTemplate } from '../../../electron/main/services/repo-config/template-writer'
import { RepoHookTrust } from '../../../electron/main/services/repo-config/trust'
import { FORBIDDEN_CAPABILITIES, MCP_COVERAGE } from '../../../shared/mcp-coverage'
import type { MainMessage } from '../../../shared/messages'
import { IPC_CHANNELS } from '../../../shared/types/ipc'
import type { WorktreeProvisionReport, WorktreeTemplateConfig, WorktreeTemplateDryRun } from '../../../shared/types/repo-config'
import { WorktreeCreationNotices } from '../../../src/components/Worktree/WorktreeCreationNotices'
import { WorktreeTemplateSection } from '../../../src/components/Worktree/WorktreeTemplateSection'
import { changeLanguage } from '../../../src/i18n'
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
  sandbox = realpathSync.native(mkdtempSync(join(tmpdir(), 'oxe444-a5-')))
  repo = join(sandbox, 'repo')
  mkdirSync(repo, { recursive: true })
  git(repo, 'init', '-q', '-b', 'main')
  git(repo, 'config', 'user.email', 'oxe444@test.invalid')
  git(repo, 'config', 'user.name', 'OXE-444')
  put(repo, '.gitignore', 'node_modules/\n.env\n.env.*\nconfig/*.local.json\n')
  put(repo, 'src/app.ts', 'export const x = 1\n')
  put(repo, 'oxe.yaml', [
    'scripts:',
    '  setup: echo preview-hook-test',
    'worktree:',
    '  sharedDirectories:',
    '    - node_modules',
    '    - src',
    'defaultTabs:',
    '  - title: Dev',
    '    command: npm run dev',
    'thread:',
    '  brief: false',
    ''
  ].join('\n'))
  put(repo, '.worktreeinclude', 'config/*.local.json\n.env*\n!.env.production\n')
  git(repo, 'add', '.')
  git(repo, 'commit', '-qm', 'init')
  put(repo, 'node_modules/pkg/index.js', 'module.exports = 1')
  put(repo, 'config/dev.local.json', '{"dev":true}')
  put(repo, '.env', 'SECRET=1')
  put(repo, '.env.production', 'PROD=1')

  const db = openInMemoryDatabase()
  closeDb = () => db.close()
  service = new GitHubRepositoryService(new GhExec({}))
  service.configureWorktreeLifecycle({ trust: new RepoHookTrust(db), stopTerminalsWithin: () => [] })
})

afterEach(async () => {
  cleanup()
  closeDb()
  await act(async () => { await changeLanguage('en') })
  try { removeTempDir(sandbox) } catch { /* temp dir */ }
})

describe('OXE-444 A5 · dry-run parity, safe template persistence, IPC governance and UI', () => {
  it('dry-run preview has zero side effects and matches real worktree creation exactly', async () => {
    const markerFile = join(repo, 'hook-should-not-run.tmp')
    const dryRun = await service.previewWorktreeTemplate(repo)

    expect(existsSync(markerFile)).toBe(false)
    expect(dryRun.sources).toEqual(['oxe.yaml', '.worktreeinclude'])
    expect(dryRun.linked).toEqual(['node_modules'])
    expect(dryRun.copied).toEqual(['config/dev.local.json'])
    expect(dryRun.sensitivePending).toEqual(['.env'])
    expect(dryRun.hookCommands.setup).toBe('echo preview-hook-test')
    expect(dryRun.hookTrusted.setup).toBe(false)
    expect(dryRun.skipped).toEqual(
      expect.arrayContaining([
        { path: 'src', kind: 'shared-dir', reason: 'tracked-in-git' },
        { path: '.env.production', kind: 'copy-file', reason: 'excluded-by-negation' },
        { path: '.env', kind: 'copy-file', reason: 'sensitive-opt-in-required' }
      ])
    )

    const wtPath = join(sandbox, 'wt-real-compare')
    const actual = await service.createWorktree({
      rootPath: repo,
      branch: 'feat/a5-compare',
      path: wtPath,
      createBranch: true,
      baseRef: 'main'
    })

    expect(actual.report?.linked).toEqual(dryRun.linked)
    expect(actual.report?.copied).toEqual(dryRun.copied)
    expect(actual.report?.sensitivePending).toEqual(dryRun.sensitivePending)
    expect(actual.report?.skipped).toEqual(dryRun.skipped)
    expect(actual.report?.sources).toEqual(dryRun.sources)
    expect(actual.report?.hookStatus).toBe('skipped-untrusted')
  })

  it('saveWorktreeTemplate preserves unrelated oxe.yaml fields and refuses symlinks', async () => {
    const saved = await saveWorktreeTemplate(repo, {
      sharedDirectories: ['node_modules', '.venv'],
      copyFiles: ['config/*.local.json'],
      worktreeInclude: ['.env.local', '!.env.production'],
      setupScript: 'npm run bootstrap'
    })

    expect(saved.sharedDirectories).toEqual(['node_modules', '.venv'])
    expect(saved.worktreeInclude).toEqual(['.env.local', '!.env.production'])
    expect(saved.setupScript).toBe('npm run bootstrap')

    const oxeRaw = readFileSync(join(repo, 'oxe.yaml'), 'utf8')
    expect(oxeRaw).toContain('defaultTabs')
    expect(oxeRaw).toContain('npm run dev')
    expect(oxeRaw).toContain('brief: false')
    expect(readFileSync(join(repo, '.worktreeinclude'), 'utf8')).toContain('!.env.production')

    const reread = await readWorktreeTemplate(repo)
    expect(reread.sharedDirectories).toEqual(['node_modules', '.venv'])
    expect(reread.worktreeInclude).toEqual(['.env.local', '!.env.production'])

    // Refuse symlink target on save
    const symlinkRepo = join(sandbox, 'symlink-repo')
    mkdirSync(symlinkRepo, { recursive: true })
    const outsideFile = join(sandbox, 'outside.yaml')
    writeFileSync(outsideFile, 'scripts:\n  setup: echo evil\n')
    let createdSymlink = false
    try {
      symlinkSync(outsideFile, join(symlinkRepo, 'oxe.yaml'), 'file')
      createdSymlink = true
    } catch {
      // File symlinks may require developer mode on some Windows environments
    }
    if (createdSymlink) {
      await expect(saveWorktreeTemplate(symlinkRepo, {
        sharedDirectories: ['node_modules'],
        copyFiles: [],
        worktreeInclude: []
      })).rejects.toThrow(/symlink/i)
    }
  })

  it('exposes repository worktree template IPC channels with sensitive trust forbidden from MCP', () => {
    expect(IPC_CHANNELS.repository).toMatchObject({
      getWorktreeTemplate: 'repository:getWorktreeTemplate',
      saveWorktreeTemplate: 'repository:saveWorktreeTemplate',
      previewWorktreeTemplate: 'repository:previewWorktreeTemplate',
      trustWorktreeSensitiveCopy: 'repository:trustWorktreeSensitiveCopy'
    })
    expect(FORBIDDEN_CAPABILITIES).toContain('git.repo_hook_approval')
    expect(MCP_COVERAGE['git.repo_hook_approval']?.ipc).toContain('repository.trustWorktreeSensitiveCopy')
    expect('forbidden' in MCP_COVERAGE['git.repo_hook_approval']).toBe(true)
  })

  it('WorktreeTemplateSection applies stack presets idempotently, renders dry-run preview and WorktreeCreationNotices shows redacted hook output', async () => {
    const initialConfig: WorktreeTemplateConfig = {
      rootPath: repo,
      sources: ['oxe.yaml'],
      sharedDirectories: [],
      copyFiles: [],
      worktreeInclude: [],
      setupScript: '',
      archiveScript: '',
      sensitivePatterns: [],
      sensitiveApproved: false,
      sensitiveHash: null,
      setupHash: null,
      setupTrusted: false
    }

    const mockPreview: WorktreeTemplateDryRun = {
      sources: ['oxe.yaml', '.worktreeinclude'],
      linked: ['node_modules', '.venv'],
      copied: ['config/dev.local.json'],
      skipped: [
        { path: 'src', kind: 'shared-dir', reason: 'tracked-in-git' },
        { path: '.env.local', kind: 'copy-file', reason: 'sensitive-opt-in-required' }
      ],
      sensitivePending: ['.env.local'],
      sensitivePatterns: ['.env.local'],
      sensitiveHash: 'abc123',
      sensitiveApproved: false,
      hookCommands: { setup: 'npm ci' },
      hookTrusted: { setup: false },
      notices: []
    }

    const getWorktreeTemplate = vi.fn(async () => initialConfig)
    const saveWorktreeTemplateMock = vi.fn(async (input: { sharedDirectories: string[]; worktreeInclude: string[] }) => ({
      ...initialConfig,
      sharedDirectories: input.sharedDirectories,
      worktreeInclude: input.worktreeInclude,
      sensitivePatterns: input.worktreeInclude.filter((p) => p.includes('.env')),
      sensitiveHash: 'abc123'
    }))
    const previewWorktreeTemplate = vi.fn(async () => mockPreview)
    const trustWorktreeSensitiveCopy = vi.fn(async () => ({
      ...initialConfig,
      worktreeInclude: ['.env.local'],
      sensitivePatterns: ['.env.local'],
      sensitiveApproved: true,
      sensitiveHash: 'abc123'
    }))

    const previousOxe = (window as unknown as { oxe?: unknown }).oxe
    ;(window as unknown as { oxe: unknown }).oxe = {
      ...(typeof previousOxe === 'object' && previousOxe ? previousOxe : {}),
      repository: {
        getWorktreeTemplate,
        saveWorktreeTemplate: saveWorktreeTemplateMock,
        previewWorktreeTemplate,
        trustWorktreeSensitiveCopy
      }
    }

    try {
      render(<WorktreeTemplateSection rootPath={repo} defaultOpen />)

      await waitFor(() => expect(getWorktreeTemplate).toHaveBeenCalledWith({ rootPath: repo }))

      // Click Node.js twice (idempotent), Python once, Local Env once
      fireEvent.click(screen.getByTestId('wt-preset-node'))
      fireEvent.click(screen.getByTestId('wt-preset-node'))
      fireEvent.click(screen.getByTestId('wt-preset-python'))
      fireEvent.click(screen.getByTestId('wt-preset-env'))

      const sharedInput = screen.getByTestId('wt-template-shared-dirs') as HTMLTextAreaElement
      expect(sharedInput.value.split('\n').filter(Boolean)).toEqual(['node_modules', '.venv'])
      const includeInput = screen.getByTestId('wt-template-include') as HTMLTextAreaElement
      expect(includeInput.value.split('\n').filter(Boolean)).toEqual(['.env.local'])

      // Save
      fireEvent.click(screen.getByTestId('wt-template-save'))
      await waitFor(() => expect(saveWorktreeTemplateMock).toHaveBeenCalled())

      // Dry-run preview
      fireEvent.click(screen.getByTestId('wt-template-preview'))
      await waitFor(() => expect(previewWorktreeTemplate).toHaveBeenCalledWith({ rootPath: repo }))
      const dryRunBox = await screen.findByTestId('wt-template-dryrun-result')
      expect(dryRunBox.textContent).toContain('node_modules')
      expect(dryRunBox.textContent).toContain('config/dev.local.json')
      expect(dryRunBox.textContent).toContain('.env.local')

      // Sensitive opt-in button calls trustWorktreeSensitiveCopy
      fireEvent.click(screen.getByTestId('wt-template-sensitive-optin'))
      await waitFor(() => expect(trustWorktreeSensitiveCopy).toHaveBeenCalled())
    } finally {
      ;(window as unknown as { oxe?: unknown }).oxe = previousOxe
    }

    // WorktreeCreationNotices renders structured report + redacted hookOutputTail on failure
    const notices: MainMessage[] = [
      { code: 'worktree.createdFrom', params: { path: '/wt-a5', branch: 'feat/a5', base: 'main' } },
      { code: 'worktree.setup.failed', params: { exitCode: 2 } }
    ]
    const report: WorktreeProvisionReport = {
      sources: ['oxe.yaml'],
      linked: ['node_modules'],
      copied: ['config/dev.local.json'],
      skipped: [{ path: 'src', kind: 'shared-dir', reason: 'tracked-in-git' }],
      sensitivePending: [],
      hookStatus: 'failed',
      hookOutputTail: 'error: token=[redacted]\nHOOK_FAILED_EXIT_2',
      notices
    }
    render(<WorktreeCreationNotices notices={notices} report={report} onDismiss={() => {}} />)
    expect(screen.getByTestId('worktree-hook-output-tail').textContent).toContain('HOOK_FAILED_EXIT_2')
    expect(screen.getByTestId('worktree-hook-output-tail').textContent).toContain('[redacted]')
    expect(screen.getByTestId('worktree-provision-summary').textContent).toContain('node_modules')
  })
})
