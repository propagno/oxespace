// Renderer crashes to the incident journal: which boundary caught it (or that nothing did), the component, the
// error's class name, a C3 code and a hash of the stack's shape. Never the message, props, paths or any user text:
// those can hold file names, queries and secrets. Reporting is fire-and-forget and never throws.

// TODO(CCR F24-B): the contract is approved but not on main yet. Replace these local types with the ones in
// shared/types (diagnostics) and drop the cast in `send` once `window.oxe.diagnostics.reportRendererError` lands.
export type RendererErrorBoundary = 'root' | 'window' | 'conversations' | 'mode-view' | 'workspace-grid' | 'workspace-panel' | 'pane' | 'terminal'
export type RendererErrorKind = 'boundary' | 'uncaught' | 'unhandledRejection'
export interface RendererErrorInput {
  kind: RendererErrorKind
  /** Present only for kind 'boundary'. */
  boundary?: RendererErrorBoundary
  component?: string
  errorName: string
  code?: string
  stackHash?: string
}

export const IDENTIFIER = /^[A-Za-z_$][\w$.]{0,79}$/
export const STACK_HASH = /^[0-9a-f]{8,64}$/
const MESSAGE_CODE = /^[a-z][A-Za-z0-9]*(?:\.[A-Za-z0-9]+){1,5}$/

/** FNV-1a, 32 bits, as 8 hex digits: small, synchronous and stable across runs. */
export function fnv1a(text: string): string {
  let hash = 0x811c9dc5
  for (let index = 0; index < text.length; index++) {
    hash ^= text.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193) >>> 0
  }
  return hash.toString(16).padStart(8, '0')
}

/**
 * The stack's frames as `function@line:col`, without file names or folders, so the same crash hashes the same on
 * every machine and the hash cannot carry a path.
 */
export function stackFrames(stack: string | undefined): string[] {
  if (!stack) return []
  return stack.split('\n').flatMap(raw => {
    const line = raw.trim()
    if (!line.startsWith('at ')) return []
    const body = line.slice(3).replace(/^(?:async|new)\s+/, '')
    const position = /:(\d+):(\d+)\)?$/.exec(body)
    const open = body.indexOf(' (')
    const name = open > 0 ? body.slice(0, open).replace(/[^\w$.<>]/g, '') : '<anonymous>'
    return [`${name || '<anonymous>'}@${position ? `${position[1]}:${position[2]}` : '?'}`]
  })
}

export function stackHash(stack: string | undefined): string | undefined {
  const frames = stackFrames(stack)
  return frames.length ? fnv1a(frames.join('\n')) : undefined
}

/** The first component React names in a component stack (`at Foo (…)` or `in Foo`), when it is a plain identifier. */
export function firstComponent(componentStack: string | null | undefined): string | undefined {
  const match = /(?:^|\n)\s*(?:at|in)\s+([A-Za-z_$][\w$.]*)/.exec(componentStack ?? '')
  return match && IDENTIFIER.test(match[1]) ? match[1] : undefined
}

const identifier = (value: unknown): string | undefined => typeof value === 'string' && IDENTIFIER.test(value) ? value : undefined

/** The report for one error, holding only the fields the contract allows. */
export function rendererErrorReport(kind: RendererErrorKind, error: unknown, extra: { boundary?: RendererErrorBoundary; component?: string } = {}): RendererErrorInput {
  const value = error as { name?: unknown; code?: unknown; stack?: unknown } | null
  // A rejection can be anything; a thrown string is named for its type, never quoted.
  const errorName = value && typeof value === 'object' ? identifier(value.name) ?? 'Error' : typeof error === 'string' ? 'String' : 'Unknown'
  // TODO(CCR F24-B): the contract's MainMessageError is not a renderer class yet; any error named that way with a C3-shaped code counts.
  const code = value && typeof value === 'object' && value.name === 'MainMessageError' && typeof value.code === 'string' && MESSAGE_CODE.test(value.code) && value.code.length <= 80 ? value.code : undefined
  const hash = value && typeof value === 'object' && typeof value.stack === 'string' ? stackHash(value.stack) : undefined
  const component = identifier(extra.component)
  return {
    kind, errorName,
    ...(kind === 'boundary' && extra.boundary ? { boundary: extra.boundary } : {}),
    ...(component ? { component } : {}),
    ...(code ? { code } : {}),
    ...(hash && STACK_HASH.test(hash) ? { stackHash: hash } : {})
  }
}

const recent = new Map<string, number>()
const WINDOW_MS = 60_000, PER_WINDOW = 20

/** Sends one report; the same crash within a minute, or a storm of them, is sent once. */
export function reportRendererError(input: RendererErrorInput): void {
  try {
    const now = Date.now()
    for (const [key, at] of recent) if (now - at > WINDOW_MS) recent.delete(key)
    const key = `${input.kind}|${input.boundary ?? ''}|${input.component ?? ''}|${input.errorName}|${input.stackHash ?? ''}`
    if (recent.has(key) || recent.size >= PER_WINDOW) return
    recent.set(key, now)
    const diagnostics = (window as { oxe?: { diagnostics?: { reportRendererError?: (input: RendererErrorInput) => unknown } } }).oxe?.diagnostics
    const sent = diagnostics?.reportRendererError?.(input)
    if (sent && typeof (sent as Promise<unknown>).catch === 'function') (sent as Promise<unknown>).catch(() => { /* The journal is best effort. */ })
  } catch { /* Reporting a crash must never cause one. */ }
}

/** Forgets what was sent, for tests. */
export function resetRendererErrorReports(): void { recent.clear() }

export { installRendererErrorReporting } from './rendererErrorsBoot'
