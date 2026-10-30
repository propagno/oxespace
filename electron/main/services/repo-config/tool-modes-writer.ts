import { isDeepStrictEqual } from 'node:util'
import { load } from 'js-yaml'
import type { ConfigurableMcpToolGroup, McpToolGroupMode } from '../../../../shared/types/mcp-tools'
import { parseOxeYaml } from './parser'

const indentOf = (line: string) => line.length - line.trimStart().length
const meaningful = (line: string) => line.trim() !== '' && !line.trimStart().startsWith('#')

/** The modes `thread.tools` sets today, in either form (a list is `always`). */
function currentModes(thread: unknown): Record<string, string> {
  const tools = thread && typeof thread === 'object' ? (thread as { tools?: unknown }).tools : undefined
  if (Array.isArray(tools)) return Object.fromEntries(tools.filter((group): group is string => typeof group === 'string').map(group => [group.trim(), 'always']))
  if (tools && typeof tools === 'object') return Object.fromEntries(Object.entries(tools).filter((entry): entry is [string, string] => typeof entry[1] === 'string'))
  return {}
}

/**
 * Sets one group's mode in an oxe.yaml text, as the map form of `thread.tools`, and keeps everything else as written:
 * only the `tools` block under `thread` is rewritten (a list becomes the same groups as `always`). The result is parsed
 * again and refused unless nothing but `thread.tools` changed, so a layout this cannot edit safely is never written.
 */
export function withToolMode(text: string | null, group: ConfigurableMcpToolGroup, mode: McpToolGroupMode): string {
  const source = text ?? ''
  const eol = source.includes('\r\n') ? '\r\n' : '\n'
  const before = source.trim() ? load(source) : {}
  if (before !== null && before !== undefined && (typeof before !== 'object' || Array.isArray(before))) throw new Error('oxe.yaml is not a mapping; edit it by hand')
  const root = (before ?? {}) as Record<string, unknown>
  const modes = { ...currentModes(root.thread), [group]: mode }
  const lines = source ? source.split(/\r?\n/) : []
  if (lines.at(-1) === '') lines.pop()

  const threadAt = lines.findIndex(line => /^thread\s*:/.test(line))
  let next: string[]
  if (threadAt < 0) {
    next = [...lines, 'thread:', '  tools:', ...Object.entries(modes).map(([name, value]) => `    ${name}: ${value}`)]
  } else {
    if (!/^thread\s*:\s*(#.*)?$/.test(lines[threadAt])) throw new Error('thread in oxe.yaml is written inline; edit it by hand')
    let end = threadAt + 1
    while (end < lines.length && (!meaningful(lines[end]) || indentOf(lines[end]) > 0)) end += 1
    while (end > threadAt + 1 && !meaningful(lines[end - 1])) end -= 1
    const child = lines.slice(threadAt + 1, end).find(meaningful)
    const step = child ? indentOf(child) : 2
    const pad = ' '.repeat(step)
    const block = [`${pad}tools:`, ...Object.entries(modes).map(([name, value]) => `${pad}${pad}${name}: ${value}`)]
    const toolsAt = lines.findIndex((line, index) => index > threadAt && index < end && indentOf(line) === step && /^\s*tools\s*:/.test(line))
    if (toolsAt < 0) {
      next = [...lines.slice(0, end), ...block, ...lines.slice(end)]
    } else {
      let toolsEnd = toolsAt + 1
      while (toolsEnd < end && (!meaningful(lines[toolsEnd]) || indentOf(lines[toolsEnd]) > step)) toolsEnd += 1
      while (toolsEnd > toolsAt + 1 && !meaningful(lines[toolsEnd - 1])) toolsEnd -= 1
      next = [...lines.slice(0, toolsAt), ...block, ...lines.slice(toolsEnd)]
    }
  }
  const written = `${next.join(eol)}${eol}`

  let after: Record<string, unknown>
  try { after = load(written) as Record<string, unknown> } catch { throw new Error('oxe.yaml could not be updated safely; edit thread.tools by hand') }
  const strip = (value: Record<string, unknown>) => {
    const { thread, ...rest } = value
    const { tools: _tools, ...threadRest } = (thread && typeof thread === 'object' ? thread : {}) as Record<string, unknown>
    return { rest, thread: threadRest }
  }
  const was = strip(root), now = strip(after)
  const threadUnchanged = isDeepStrictEqual(was.thread, now.thread) || (Object.keys(was.thread).length === 0 && Object.keys(now.thread).length === 0)
  if (!isDeepStrictEqual(was.rest, now.rest) || !threadUnchanged || !isDeepStrictEqual(currentModes(after.thread), modes) || parseOxeYaml(written)?.thread?.toolModes?.[group] !== mode) {
    throw new Error('oxe.yaml could not be updated safely; edit thread.tools by hand')
  }
  return written
}
