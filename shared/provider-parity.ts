import type { ThreadProvider } from './types/thread'

export const PARITY_FEATURES = [
  'fork',
  'branch',
  'alwaysAllowBeyondSession',
  'paneConversation',
  'effort'
] as const

export type ParityFeature = typeof PARITY_FEATURES[number]

export type ParityProviderLabel = 'Claude' | 'Codex'

export type ParityRefusal = {
  code: 'parity.notAvailable'
  params: { provider: ParityProviderLabel }
}

export type ParityAnswer =
  | { available: true }
  | { available: false; refusal: ParityRefusal }

const PROVIDER_LABELS: Record<ThreadProvider, ParityProviderLabel> = {
  claude: 'Claude',
  codex: 'Codex'
}

const SUPPORTED: Record<ThreadProvider, ReadonlySet<ParityFeature>> = {
  claude: new Set<ParityFeature>(PARITY_FEATURES),
  codex: new Set<ParityFeature>(['fork', 'paneConversation', 'effort'])
}

export function parityFor(provider: ThreadProvider, feature: ParityFeature): ParityAnswer {
  if (SUPPORTED[provider].has(feature)) return { available: true }
  return {
    available: false,
    refusal: {
      code: 'parity.notAvailable',
      params: { provider: PROVIDER_LABELS[provider] }
    }
  }
}
