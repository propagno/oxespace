import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { instructionLabel, instructionSources } from '../../electron/main/services/conversation/instruction-sources'
import { removeTempDir } from '../helpers/removeTempDir'

const roots: string[] = []
afterEach(() => { for (const root of roots.splice(0)) removeTempDir(root) })

function layout() {
  const base = mkdtempSync(join(tmpdir(), 'oxe-instructions-')); roots.push(base)
  const home = join(base, 'home'), repo = join(base, 'repo'), sub = join(repo, 'packages', 'web')
  mkdirSync(join(home, '.claude'), { recursive: true }); mkdirSync(join(home, '.codex'), { recursive: true })
  mkdirSync(join(repo, '.git'), { recursive: true }); mkdirSync(join(repo, '.claude', 'rules'), { recursive: true }); mkdirSync(sub, { recursive: true })
  writeFileSync(join(home, '.claude', 'CLAUDE.md'), 'user rules')
  writeFileSync(join(home, '.codex', 'AGENTS.md'), 'user agents')
  writeFileSync(join(repo, 'CLAUDE.md'), 'project rules')
  writeFileSync(join(repo, 'AGENTS.md'), 'project agents')
  writeFileSync(join(repo, '.claude', 'rules', 'b.md'), 'b'); writeFileSync(join(repo, '.claude', 'rules', 'a.md'), 'a'); writeFileSync(join(repo, '.claude', 'rules', 'notes.txt'), 'x')
  writeFileSync(join(sub, 'CLAUDE.md'), 'web rules'); writeFileSync(join(sub, 'AGENTS.md'), 'web agents')
  writeFileSync(join(sub, 'CLAUDE.local.md'), 'local')
  return { home, repo, sub }
}

describe('instructionSources', () => {
  it('lists Claude files from user scope down to the working directory, then local and rules', () => {
    const { home, repo, sub } = layout()
    const saved = process.env.CLAUDE_CONFIG_DIR; delete process.env.CLAUDE_CONFIG_DIR
    try {
      const sources = instructionSources('claude', sub, home)
      // Files above the working directory keep their absolute path as the label.
      expect(sources.map(source => [instructionLabel(source, sub, home), source.scope])).toEqual([
        ['~/.claude/CLAUDE.md', 'user'],
        [join(repo, 'CLAUDE.md'), 'project'],
        ['CLAUDE.md', 'directory'],
        ['CLAUDE.local.md', 'local'],
        [join(repo, '.claude', 'rules', 'a.md'), 'rules'],
        [join(repo, '.claude', 'rules', 'b.md'), 'rules']
      ])
    } finally { if (saved !== undefined) process.env.CLAUDE_CONFIG_DIR = saved }
  })

  it('lists Codex AGENTS.md files and nothing for a folder without any', () => {
    const { home, repo, sub } = layout()
    const saved = process.env.CODEX_HOME; delete process.env.CODEX_HOME
    try {
      expect(instructionSources('codex', sub, home).map(source => source.scope)).toEqual(['user', 'project', 'directory'])
      expect(instructionSources('codex', repo, home).map(source => source.bytes)).toEqual([11, 14])
      const empty = mkdtempSync(join(tmpdir(), 'oxe-instructions-empty-')); roots.push(empty)
      expect(instructionSources('claude', empty, join(empty, 'nohome'))).toEqual([])
    } finally { if (saved !== undefined) process.env.CODEX_HOME = saved }
  })
})

describe('instructionSources rules', () => {
  it('reads the paths a rule is limited to, user rules and nested rule folders', () => {
    const { home, repo } = layout()
    mkdirSync(join(home, '.claude', 'rules'), { recursive: true })
    writeFileSync(join(home, '.claude', 'rules', 'style.md'), 'always')
    mkdirSync(join(repo, '.claude', 'rules', 'frontend'), { recursive: true })
    writeFileSync(join(repo, '.claude', 'rules', 'frontend', 'react.md'), '---\npaths:\n  - "src/**/*.tsx"\n  - src/ui/**\n---\nUse hooks.')
    writeFileSync(join(repo, '.claude', 'rules', 'a.md'), '---\npaths: "docs/**"\n---\nDocs only.')
    const saved = process.env.CLAUDE_CONFIG_DIR; delete process.env.CLAUDE_CONFIG_DIR
    try {
      const rules = instructionSources('claude', repo, home).filter(source => source.scope === 'rules')
      expect(rules.map(rule => [instructionLabel(rule, repo, home), rule.paths ?? null])).toEqual([
        ['~/.claude/rules/style.md', null],
        ['.claude/rules/a.md', ['docs/**']],
        ['.claude/rules/b.md', null],
        ['.claude/rules/frontend/react.md', ['src/**/*.tsx', 'src/ui/**']]
      ])
    } finally { if (saved !== undefined) process.env.CLAUDE_CONFIG_DIR = saved }
  })

  it('treats a rule with a broken or absent header as always applying', () => {
    const { home, repo } = layout()
    writeFileSync(join(repo, '.claude', 'rules', 'a.md'), '---\npaths: [unclosed\n---\nx')
    const saved = process.env.CLAUDE_CONFIG_DIR; delete process.env.CLAUDE_CONFIG_DIR
    try {
      expect(instructionSources('claude', repo, home).filter(source => source.scope === 'rules').every(rule => rule.paths === undefined)).toBe(true)
    } finally { if (saved !== undefined) process.env.CLAUDE_CONFIG_DIR = saved }
  })
})
