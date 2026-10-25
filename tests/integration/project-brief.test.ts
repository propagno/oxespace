import { execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { briefBlock, MAX_BRIEF_BYTES, projectBrief } from '../../electron/main/services/conversation/project-brief'
import { parseOxeYaml } from '../../electron/main/services/repo-config/parser'
import { removeTempDir } from '../helpers/removeTempDir'

const roots: string[] = []
afterEach(() => { for (const root of roots.splice(0)) removeTempDir(root) })

function repo(): string {
  const root = mkdtempSync(join(tmpdir(), 'oxe-brief-')); roots.push(root)
  const git = (...args: string[]) => execFileSync('git', args, { cwd: root, stdio: 'pipe' })
  git('init', '-b', 'main'); git('config', 'user.email', 't@oxespace.local'); git('config', 'user.name', 'T')
  writeFileSync(join(root, 'package.json'), JSON.stringify({ name: 'app', scripts: { test: 'vitest run', build: 'vite build', postinstall: 'x' } }))
  writeFileSync(join(root, 'tsconfig.json'), '{}')
  writeFileSync(join(root, 'CLAUDE.md'), 'rules')
  git('add', '.'); git('commit', '-m', 'init')
  writeFileSync(join(root, 'dirty.txt'), 'x')
  return root
}

describe('projectBrief', () => {
  it('summarises branch, stack, scripts, instruction files and the code tools', { timeout: 20_000 }, async () => {
    const root = repo()
    const brief = await projectBrief(root, 'claude')
    expect(brief).toContain('Branch: main · 1 uncommitted change')
    expect(brief).toContain('Stack: Node.js, TypeScript')
    expect(brief).toContain('npm run test: vitest run')
    expect(brief).not.toContain('postinstall')
    expect(brief).toContain('Instruction files you already loaded: CLAUDE.md')
    expect(brief).toContain('oxespace_code_callers')
    expect(Buffer.byteLength(brief)).toBeLessThanOrEqual(MAX_BRIEF_BYTES)
    expect(briefBlock(brief)).toMatch(/^\n\n<oxespace-project-brief>\n[\s\S]*\n<\/oxespace-project-brief>$/)
  })

  it('is off when oxe.yaml says so, and empty for a missing directory', { timeout: 20_000 }, async () => {
    const root = repo()
    writeFileSync(join(root, 'oxe.yaml'), 'thread:\n  brief: false\n')
    expect(await projectBrief(root, 'codex')).toBe('')
    expect(await projectBrief(join(root, 'missing'), 'codex')).toBe('')
    expect(briefBlock('')).toBe('')
  })
})

describe('oxe.yaml thread settings', () => {
  it('reads thread.brief as a boolean and ignores anything else', () => {
    expect(parseOxeYaml('thread:\n  brief: false\n')?.thread).toEqual({ brief: false })
    expect(parseOxeYaml('thread:\n  brief: "no"\n')).toBeNull()
  })

  it('reads thread.tools as a list of group names', () => {
    expect(parseOxeYaml('thread:\n  tools: [orchestration, data, data, 3]\n')?.thread).toEqual({ tools: ['orchestration', 'data'] })
    expect(parseOxeYaml('thread:\n  brief: false\n  tools: [docs]\n')?.thread).toEqual({ brief: false, tools: ['docs'] })
    expect(parseOxeYaml('thread:\n  tools: docs\n')).toBeNull()
  })
})
