export interface ResultChip {
  label: string
  tone: 'neutral' | 'attn' | 'danger' | 'success' | 'muted'
}

export function resultChip(
  row: Record<string, unknown>,
  live?: { containerGone?: boolean; changeGone?: boolean }
): ResultChip {
  const source = String(row.source ?? '')

  if (source === 'databases') {
    if (row.decision === 'pending') return { label: 'Waiting for you', tone: 'attn' }
    if (row.decision === 'denied') return { label: 'Denied', tone: 'neutral' }
    if (row.decision === 'blocked') return { label: 'Not allowed', tone: 'danger' }
    if (row.outcome === 'error' || row.errorCode) return { label: 'Failed', tone: 'danger' }
    return { label: 'Done', tone: 'neutral' }
  }

  if (source === 'http') {
    if (row.status != null) {
      const status = Number(row.status)
      if (status >= 200 && status < 300) return { label: String(status), tone: 'success' }
      if (status >= 400) return { label: String(status), tone: 'danger' }
      return { label: String(status), tone: 'neutral' }
    }
    return { label: 'No status', tone: 'neutral' }
  }

  if (source === 'containers') {
    if (live?.containerGone) return { label: 'No longer running', tone: 'muted' }
    if (row.outcome === 'running') return { label: 'Running', tone: 'neutral' }
    if (row.outcome === 'exited') return { label: 'Exited', tone: 'neutral' }
    return { label: String(row.outcome ?? 'Unknown'), tone: 'neutral' }
  }

  if (source === 'changes') {
    if (live?.changeGone) return { label: '—', tone: 'muted' }
    const added = Number(row.added ?? 0)
    const removed = Number(row.removed ?? 0)
    return { label: `+${added} \u2212${removed}`, tone: 'neutral' }
  }

  return { label: String(row.outcome ?? 'ok'), tone: 'neutral' }
}
