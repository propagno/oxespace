/** Public, bounded activity label. Full arguments belong in the details view. */
export function threadToolSummary(tool: { name: string; detail: string }): string {
  const detail = tool.detail.trim()
  if (detail.startsWith('{')) {
    try {
      const input = JSON.parse(detail) as Record<string, unknown>
      for (const key of ['description', 'command', 'cmd', 'file_path', 'path', 'pattern', 'query', 'action']) {
        const value = input[key]
        if (typeof value === 'string' && value.trim()) return value.replace(/\s+/g, ' ').slice(0, 180)
      }
      return tool.name === 'AskUserQuestion' ? 'Waiting for your answers' : 'Open details to inspect this action'
    } catch { return 'Open details to inspect this action' }
  }
  return detail.replace(/\s+/g, ' ').slice(0, 180)
}
