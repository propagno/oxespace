import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, test, afterEach } from 'vitest'
import { OxeService } from '../../electron/main/services/oxe.service'

const tempDirs: string[] = []

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true })
  }
})

describe('OxeService', () => {
  test('reads local OXE status without requiring oxe-cc', () => {
    const rootPath = createTempWorkspace()
    mkdirSync(join(rootPath, '.oxe'))
    writeFileSync(
      join(rootPath, '.oxe', 'STATE.md'),
      [
        '# OXE - Estado',
        '',
        '## Fase atual',
        '- **Status da run:** plan_ready',
        '- **Run ID:** oxe-run-1',
        '',
        '## Runtime operacional',
        '- **runtime_status:** pending_execute',
        '- **lifecycle_status:** pending_execute',
        '',
        '## Proximo passo',
        '- Executar `oxe-execute`.'
      ].join('\n')
    )
    writeFileSync(join(rootPath, '.oxe', 'PLAN.md'), '# Plan')

    const service = new OxeService({
      spawnVersion: () => ({ status: 1, signal: null, output: [], pid: 1, stdout: '', stderr: 'not found' })
    })
    const status = service.getStatus({ workspaceId: 'workspace-1', rootPath })

    expect(status.isOxeProject).toBe(true)
    expect(status.engine.available).toBe(false)
    expect(status.state).toMatchObject({
      status: 'plan_ready',
      runId: 'oxe-run-1',
      runtimeStatus: 'pending_execute',
      lifecycleStatus: 'pending_execute',
      nextStep: 'Executar oxe-execute.'
    })
    expect(status.artifacts.find((artifact) => artifact.relativePath === '.oxe/PLAN.md')?.exists).toBe(true)
    expect(status.artifacts.find((artifact) => artifact.relativePath === '.oxe/IMPLEMENTATION-PACK.json')?.group).toBe('rationality')
  })

  test('prefers oxe-cc status json when engine is available', () => {
    const rootPath = createTempWorkspace()
    mkdirSync(join(rootPath, '.oxe'))
    writeFileSync(join(rootPath, '.oxe', 'STATE.md'), '# State')
    writeFileSync(join(rootPath, '.oxe', 'IMPLEMENTATION-PACK.json'), '{}')

    const service = new OxeService({
      spawnVersion: () => ({ status: 0, signal: null, output: [], pid: 1, stdout: '1.10.0', stderr: '' }),
      spawnJson: (_command, args) => {
        if (args.includes('status')) {
          return {
            status: 0,
            signal: null,
            output: [],
            pid: 1,
            stdout: JSON.stringify({
              isOxeProject: true,
              healthStatus: 'warning',
              nextStep: 'plan',
              cursorCmd: '/prompts:oxe-plan --replan',
              executionRationality: { executionRationalityReady: false, criticalExecutionGaps: ['gap'] },
              activeRun: { run_id: 'run-json', status: 'planned' },
              diagnostics: { planWarnings: ['PLAN.md sem autoavaliação'] }
            }),
            stderr: ''
          }
        }
        return { status: 0, signal: null, output: [], pid: 1, stdout: '1.10.0', stderr: '' }
      }
    })

    const status = service.getStatus({ workspaceId: 'workspace-1', rootPath })

    expect(status.rawStatusJson).toBeTruthy()
    expect(status.healthStatus).toBe('warning')
    expect(status.nextStep).toBe('plan')
    expect(status.cursorCmd).toBe('/prompts:oxe-plan --replan')
    expect(status.warnings).toContain('PLAN.md sem autoavaliação')
    expect(status.artifacts.find((artifact) => artifact.relativePath === '.oxe/IMPLEMENTATION-PACK.json')?.exists).toBe(true)
  })

  test('returns non-OXE state for workspaces without .oxe', () => {
    const rootPath = createTempWorkspace()
    const service = new OxeService({
      spawnVersion: () => ({ status: 0, signal: null, output: [], pid: 1, stdout: '1.11.0', stderr: '' })
    })
    const status = service.getStatus({ workspaceId: 'workspace-1', rootPath })

    expect(status.isOxeProject).toBe(false)
    expect(status.state).toBeNull()
    expect(status.engine.available).toBe(true)
    expect(status.artifacts.every((artifact) => artifact.exists === false)).toBe(true)
  })

  test('protects reads from paths outside workspace root', () => {
    const rootPath = createTempWorkspace()
    const service = new OxeService({
      spawnVersion: () => ({ status: 1, signal: null, output: [], pid: 1, stdout: '', stderr: 'not found' })
    })

    expect(() => service.getStatus({ workspaceId: 'workspace-1', rootPath: join(rootPath, '..', '..') })).not.toThrow()
  })
})

function createTempWorkspace(): string {
  const dir = mkdtempSync(join(tmpdir(), 'oxespace-oxe-'))
  tempDirs.push(dir)
  return dir
}
