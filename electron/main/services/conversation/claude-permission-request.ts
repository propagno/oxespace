/**
 * Reads the presentation and scope data Claude attaches to a `can_use_tool`
 * request, so the approval card can say *why* it is asking and offer
 * "allow for this session" with the exact rule the CLI proposed.
 *
 * The suggestions are opaque to us: they are handed back unchanged as
 * `updatedPermissions`, never composed or edited here, so the CLI stays the
 * only author of permission rules.
 */
export interface ClaudePermissionPresentation {
  title: string
  detail: string
  /** Rules the CLI proposed; returned verbatim when the person allows for the session. */
  suggestions: unknown[]
  toolUseId?: string
  decisions: ('accept' | 'acceptForSession' | 'decline')[]
}

const MAX_SUGGESTIONS = 20
const MAX_FIELD = 600

const text = (value: unknown): string => (typeof value === 'string' ? value.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '').trim().slice(0, MAX_FIELD) : '')
const pick = (record: Record<string, unknown>, ...keys: string[]): string => {
  for (const key of keys) {
    const value = text(record[key])
    if (value) return value
  }
  return ''
}

export function describePermissionRequest(
  request: Record<string, unknown>,
  toolName: string,
  input: Record<string, unknown>
): ClaudePermissionPresentation {
  const toolUseIdEarly = pick(request, 'tool_use_id', 'toolUseID', 'toolUseId')
  // A plan is reviewed, not "allowed": show it as prose and never offer to
  // remember the decision, since approving one plan says nothing about the next.
  if (toolName === 'ExitPlanMode' && typeof input.plan === 'string' && input.plan.trim()) {
    return {
      title: pick(request, 'title') || 'Aprovar o plano?',
      detail: input.plan.trim().slice(0, 12000),
      suggestions: [],
      ...(toolUseIdEarly ? { toolUseId: toolUseIdEarly } : {}),
      decisions: ['accept', 'decline']
    }
  }

  const displayName = pick(request, 'display_name', 'displayName') || toolName
  const title = pick(request, 'title') || `Approve ${displayName}`

  const lines: string[] = []
  const description = pick(request, 'description')
  const reason = pick(request, 'decision_reason', 'decisionReason')
  const blocked = pick(request, 'blocked_path', 'blockedPath')
  if (description) lines.push(description)
  if (reason) lines.push(`Motivo: ${reason}`)
  if (blocked) lines.push(`Caminho fora do espaço de trabalho: ${blocked}`)
  const inputText = JSON.stringify(input, null, 2) ?? ''
  const detail = (lines.length ? `${lines.join('\n')}\n\n${inputText}` : inputText).slice(0, 12000)

  const raw = request.permission_suggestions ?? request.permissionSuggestions
  const suggestions = Array.isArray(raw)
    ? raw.filter((item) => item !== null && typeof item === 'object' && !Array.isArray(item)).slice(0, MAX_SUGGESTIONS)
    : []
  const toolUseId = pick(request, 'tool_use_id', 'toolUseID', 'toolUseId')

  return {
    title,
    detail,
    suggestions,
    ...(toolUseId ? { toolUseId } : {}),
    decisions: suggestions.length > 0 ? ['accept', 'acceptForSession', 'decline'] : ['accept', 'decline']
  }
}
