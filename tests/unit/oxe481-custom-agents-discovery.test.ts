import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  buildModeAndAgentPromptBlock,
  discoverCustomAgents,
  effectiveAdapterConfiguration,
  parseCustomAgentMarkdown
} from '../../electron/main/services/conversation/custom-agents.service'
import { MAX_CUSTOM_AGENT_BYTES, MAX_CUSTOM_AGENTS } from '../../shared/types/custom-agents'

const tempDirs: string[] = []

function makeTempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix))
  tempDirs.push(dir)
  return dir
}

function writeText(path: string, content: string): void {
  mkdirSync(join(path, '..'), { recursive: true })
  writeFileSync(path, content, 'utf8')
}

afterEach(() => {
  while (tempDirs.length) {
    const dir = tempDirs.pop()!
    try { rmSync(dir, { recursive: true, force: true }) } catch { /* ignore */ }
  }
})

describe('OXE-481 · custom agents discovery & guardrails', () => {
  it('parses .oxe/agents/*.md and .github/agents/*.agent.md frontmatter and body', () => {
    const repo = makeTempDir('oxe481-repo-')
    const home = makeTempDir('oxe481-home-')

    writeText(join(repo, '.oxe', 'agents', 'architect.md'), [
      '---',
      'name: System Architect',
      'description: Designs safe migrations and APIs',
      'mode: plan',
      'model: claude-sonnet-4-5',
      'access: read-only',
      'argumentHint: "[module or RFC]"',
      'handoffs:',
      '  - label: Implement plan',
      '    agent: agent',
      '    mode: agent',
      '    prompt: Implement the approved architecture step by step.',
      '    send: true',
      '  - label: Security check',
      '    agent: reviewer',
      '    prompt: Audit the proposed plan for OWASP issues.',
      '---',
      '',
      'Always evaluate backward compatibility before proposing changes.'
    ].join('\n'))

    writeText(join(repo, '.github', 'agents', 'reviewer.agent.md'), [
      '---',
      'description: Read-only security reviewer',
      'mode: ask',
      'argument-hint: "[diff scope]"',
      'handoffs:',
      '  - label: Fix findings',
      '    mode: agent',
      '    prompt: Address the review findings.',
      '---',
      '',
      'Focus on injection, path traversal, and access control regressions.'
    ].join('\n'))

    const agents = discoverCustomAgents(repo, { homeDir: home })
    expect(agents).toHaveLength(2)

    const architect = agents.find(item => item.id === 'architect')!
    expect(architect).toMatchObject({
      id: 'architect',
      name: 'System Architect',
      description: 'Designs safe migrations and APIs',
      mode: 'plan',
      model: 'claude-sonnet-4-5',
      access: 'read-only',
      argumentHint: '[module or RFC]',
      source: 'oxe',
      sourcePath: '.oxe/agents/architect.md',
      instructions: 'Always evaluate backward compatibility before proposing changes.'
    })
    expect(architect.handoffs).toEqual([
      {
        label: 'Implement plan',
        agent: 'agent',
        mode: 'agent',
        prompt: 'Implement the approved architecture step by step.',
        send: true
      },
      {
        label: 'Security check',
        agent: 'reviewer',
        prompt: 'Audit the proposed plan for OWASP issues.'
      }
    ])

    const reviewer = agents.find(item => item.id === 'reviewer')!
    expect(reviewer).toMatchObject({
      id: 'reviewer',
      name: 'reviewer',
      description: 'Read-only security reviewer',
      mode: 'ask',
      argumentHint: '[diff scope]',
      source: 'github',
      sourcePath: '.github/agents/reviewer.agent.md',
      instructions: 'Focus on injection, path traversal, and access control regressions.'
    })
    expect(reviewer.handoffs).toEqual([
      { label: 'Fix findings', mode: 'agent', prompt: 'Address the review findings.' }
    ])
  })

  it('deduplicates .oxe over .github, .claude, and user ~/.oxe', () => {
    const repo = makeTempDir('oxe481-dedupe-')
    const home = makeTempDir('oxe481-home-')

    writeText(join(repo, '.oxe', 'agents', 'reviewer.md'), '---\nname: OXE Reviewer\ndescription: Project OXE\n---\nOXE rules')
    writeText(join(repo, '.github', 'agents', 'reviewer.agent.md'), '---\nname: GitHub Reviewer\ndescription: Project GitHub\n---\nGH rules')
    writeText(join(repo, '.claude', 'agents', 'reviewer.md'), '---\nname: Claude Reviewer\ndescription: Project Claude\n---\nClaude rules')
    writeText(join(home, '.oxe', 'agents', 'reviewer.md'), '---\nname: User Reviewer\ndescription: User home\n---\nUser rules')
    writeText(join(home, '.oxe', 'agents', 'user-only.md'), '---\nname: User Helper\ndescription: Personal helper\n---\nPersonal rules')

    const agents = discoverCustomAgents(repo, { homeDir: home })
    expect(agents.map(a => `${a.id}:${a.source}:${a.name}`)).toEqual([
      'reviewer:oxe:OXE Reviewer',
      'user-only:user:User Helper'
    ])
  })

  it('ignores malformed, oversized, non-matching, and symlink-escaping files and never escalates access', () => {
    const repo = makeTempDir('oxe481-safety-')
    const outside = makeTempDir('oxe481-outside-')
    const home = makeTempDir('oxe481-home-')

    // Malformed YAML frontmatter
    writeText(join(repo, '.oxe', 'agents', 'broken.md'), '---\nname: [unterminated\n---\nBody')
    // Missing frontmatter (e.g. README)
    writeText(join(repo, '.oxe', 'agents', 'README.md'), '# Custom Agents\nNot an agent definition.')
    // Oversized file (> 64 KiB)
    writeText(join(repo, '.oxe', 'agents', 'huge.md'), `---\nname: Huge\n---\n${'x'.repeat(MAX_CUSTOM_AGENT_BYTES + 128)}`)
    // GitHub folder ignores plain .md without .agent.md suffix
    writeText(join(repo, '.github', 'agents', 'plain.md'), '---\nname: Plain\n---\nShould be ignored')
    // Attempting access escalation in frontmatter must be stripped
    writeText(join(repo, '.oxe', 'agents', 'escalator.md'), '---\nname: Escalator\naccess: full-access\n---\nSafe body')
    // Symlink pointing outside the workspace
    const secretFile = join(outside, 'secret.md')
    writeText(secretFile, '---\nname: Escaped\n---\nLeaked instructions')
    let symlinkCreated = false
    try {
      symlinkSync(secretFile, join(repo, '.oxe', 'agents', 'escape.md'))
      symlinkCreated = true
    } catch {
      // On Windows without Developer Mode / admin privileges, symlink creation may fail with EPERM.
    }

    const agents = discoverCustomAgents(repo, { homeDir: home })
    expect(agents.map(a => a.id)).toEqual(['escalator'])
    expect(agents[0].access).toBeUndefined()
    if (symlinkCreated) {
      expect(agents.some(a => a.id === 'escape')).toBe(false)
    }
  })

  it('caps discovery at MAX_CUSTOM_AGENTS (50)', () => {
    const repo = makeTempDir('oxe481-cap-')
    const home = makeTempDir('oxe481-home-')
    for (let i = 0; i < MAX_CUSTOM_AGENTS + 10; i++) {
      const slug = `agent-${String(i).padStart(2, '0')}`
      writeText(join(repo, '.oxe', 'agents', `${slug}.md`), `---\nname: Agent ${i}\n---\nPrompt ${i}`)
    }
    const agents = discoverCustomAgents(repo, { homeDir: home })
    expect(agents).toHaveLength(MAX_CUSTOM_AGENTS)
  })

  it('enforces read-only adapter clamping and builds delimited prompt blocks for Ask mode and custom agents', () => {
    const repo = makeTempDir('oxe481-runtime-')
    const home = makeTempDir('oxe481-home-')
    writeText(join(repo, '.oxe', 'agents', 'auditor.md'), [
      '---',
      'name: Auditor',
      'mode: agent',
      'access: read-only',
      '---',
      'Inspect files carefully and cite exact line numbers.'
    ].join('\n'))

    const askConfig = effectiveAdapterConfiguration(
      { rootPath: repo, mode: 'ask' },
      { mode: 'ask', access: 'workspace-write', hooksEnabled: true },
      { homeDir: home }
    )
    expect(askConfig).toMatchObject({ mode: 'default', access: 'read-only', hooksEnabled: false })

    const auditorConfig = effectiveAdapterConfiguration(
      { rootPath: repo, mode: 'default', customAgentId: 'auditor' },
      { mode: 'default', customAgentId: 'auditor', access: 'full-access', hooksEnabled: true },
      { homeDir: home }
    )
    expect(auditorConfig).toMatchObject({ mode: 'default', access: 'read-only', hooksEnabled: false })

    const askBlock = buildModeAndAgentPromptBlock({ rootPath: repo, mode: 'ask' }, { homeDir: home })
    expect(askBlock.readOnly).toBe(true)
    expect(askBlock.block).toContain('<oxe-mode mode="ask">')

    const auditorBlock = buildModeAndAgentPromptBlock(
      { rootPath: repo, mode: 'default', customAgentId: 'auditor' },
      { homeDir: home }
    )
    expect(auditorBlock.readOnly).toBe(true)
    expect(auditorBlock.block).toContain('<oxe-custom-agent id="auditor" name="Auditor" source=".oxe/agents/auditor.md">')
    expect(auditorBlock.block).toContain('Inspect files carefully and cite exact line numbers.')
  })

  it('returns null from parseCustomAgentMarkdown when frontmatter is invalid', () => {
    expect(parseCustomAgentMarkdown('no frontmatter', { stem: 'x', source: 'oxe', sourcePath: '.oxe/agents/x.md' })).toBeNull()
    expect(parseCustomAgentMarkdown('---\n- a\n- b\n---\nbody', { stem: 'x', source: 'oxe', sourcePath: '.oxe/agents/x.md' })).toBeNull()
  })
})
