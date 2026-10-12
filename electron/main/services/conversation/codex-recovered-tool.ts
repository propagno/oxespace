import type { ThreadEvent } from '../../../../shared/types/thread'

export type RecoveredTool = Extract<ThreadEvent, { type: 'tool' }>
const record = (value: unknown): Record<string, unknown> => value && typeof value === 'object' ? value as Record<string, unknown> : {}
const text = (value: unknown) => typeof value === 'string' ? value : ''
function bounded(value: string): string {
  return value.length > 65536 ? value.slice(0, 65470) + '\n[Output truncated during recovery]' : value
}

/** Only terminal item evidence can confirm a tool; turn completion alone cannot. */
export function codexRecoveredTool(item: Record<string, unknown>, turnId: string): RecoveredTool | undefined {
  if (!['commandExecution', 'fileChange', 'mcpToolCall', 'dynamicToolCall'].includes(text(item.type))) return
  if (typeof item.id !== 'string' || !item.id) throw Error('Native tool has no identity')
  const failed = item.status === 'failed' || item.status === 'declined' || item.success === false || typeof item.exitCode === 'number' && item.exitCode !== 0 || Boolean(item.error)
  const state = failed ? 'failed' : item.status === 'completed' ? 'completed' : 'unknown'
  const content = item.type === 'mcpToolCall' ? record(item.result).content : item.contentItems
  const output = text(item.aggregatedOutput) || (Array.isArray(content) ? content.filter(value => ['text', 'inputText'].includes(text(record(value).type))).map(value => text(record(value).text)).join('\n') : '') || text(record(item.error).message)
  const result: RecoveredTool = { type: 'tool', id: item.id, name: text(item.type), state, turnId,
    detail: bounded(text(item.command) || [text(item.server) || text(item.namespace), text(item.tool)].filter(Boolean).join('/')),
    ...(output ? { output: bounded(output) } : {}), ...(typeof item.exitCode === 'number' ? { exitCode: item.exitCode } : {}) }
  if (item.type === 'fileChange') {
    if (!Array.isArray(item.changes) || item.changes.length > 100) throw Error('Native file changes exceed recovery limits')
    result.files = item.changes.map(value => {
      const change = record(value), kind = record(change.kind), moved = text(kind.move_path)
      if (!text(change.path)) throw Error('Native file change has no path')
      if (typeof change.diff === 'string' && Buffer.byteLength(change.diff) > 512 * 1024) throw Error('Native patch exceeds recovery limits')
      return { path: moved || text(change.path), ...(moved ? { previousPath: text(change.path) } : {}),
        kind: moved ? 'rename' : kind.type === 'add' ? 'add' : kind.type === 'delete' ? 'delete' : 'update',
        source: 'native-patch', authorship: 'provider', state, ...(typeof change.diff === 'string' ? { patch: change.diff } : {}) }
    })
    result.detail = bounded(result.files.map(file => file.path).join('\n'))
  }
  return result
}
