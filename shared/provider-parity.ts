import type { ThreadProvider } from './types/thread'

export const PARITY_FEATURES = [
  'fork',
  'branch',
  'alwaysAllowBeyondSession',
  'paneConversation',
  'effort'
] as const

export type ParityFeature = typeof PARITY_FEATURES[number]

export type ParityProviderLabel = 'Claude' | 'Codex' | 'Antigravity'

export type ParityRefusal = {
  code: 'parity.notAvailable'
  params: { provider: ParityProviderLabel }
}

export type ParityAnswer =
  | { available: true }
  | { available: false; refusal: ParityRefusal }

const PROVIDER_LABELS: Record<ThreadProvider, ParityProviderLabel> = {
  claude: 'Claude',
  codex: 'Codex',
  antigravity: 'Antigravity'
}

const SUPPORTED: Record<ThreadProvider, ReadonlySet<ParityFeature>> = {
  // Fork is Codex's: the Claude adapter has no way to fork a conversation, and its menu item only answered with an
  // error (measured in the app, 2026-11-12). The product owner chose to say so instead of building it.
  claude: new Set<ParityFeature>(PARITY_FEATURES.filter(feature => feature !== 'fork')),
  codex: new Set<ParityFeature>(['fork', 'paneConversation', 'effort']),
  antigravity: new Set<ParityFeature>(['effort'])
}

export function parityFor(provider: ThreadProvider, feature: ParityFeature): ParityAnswer {
  // A conversation read before its provider is known (an old row, a half-loaded snapshot) makes no claim either way.
  const supported = SUPPORTED[provider] as ReadonlySet<ParityFeature> | undefined
  if (!supported || supported.has(feature)) return { available: true }
  return {
    available: false,
    refusal: {
      code: 'parity.notAvailable',
      params: { provider: PROVIDER_LABELS[provider] }
    }
  }
}
