import { it, vi } from 'vitest'
import { writeFileSync } from 'node:fs'
import { TOOL_REGISTRY } from '../../electron/main/mcp-internal/tool-registry'
vi.mock('../../electron/main/vendor/codegraph/mcp/tools', () => ({ ToolHandler: class { execute = vi.fn() } }))
it('dump', () => {
  const lines: string[] = []
  for (const t of TOOL_REGISTRY) {
    const d = t.descriptor
    const acts = [...d.description.matchAll(/^- ([a-z_]+) \((read|write|confirm)\)/gm)].map(m => `${m[1]}:${m[2]}`)
    lines.push([d.name, d.description.length, t.requiresWorkspace, acts.join(' ')].join(' '))
  }
  writeFileSync('tests/tmp/tools.txt', lines.join('\n'))
})
