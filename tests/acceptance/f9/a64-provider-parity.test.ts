// Frozen acceptance test for 1.5.0 A64 (OXE program, phase F9): provider parity. A feature a provider doesn't support
// stays visible and disabled with "Not available in {provider}", so main says per provider which of the known cases
// it supports, from one table that the conversation's capability manifest also uses.
// Written by the planner; the executor must not edit it.
// CCR: docs/roadmap-1.5/ccr-f9-panels.md §A64; DESIGN 1.5.0-f9-design.md U9.6.
import { describe, expect, test } from 'vitest'
import { threadCapabilityManifest } from '../../../electron/main/services/conversation/thread-capabilities'
import { MESSAGE_CODES } from '../../../shared/messages'
import { PARITY_FEATURES, parityFor } from '../../../shared/provider-parity'
import type { ConversationCapabilities } from '../../../shared/types/thread'

const native = { resume: true, approvals: true, attachments: true, modelSelection: true } as ConversationCapabilities
const notInCodex = { available: false, refusal: { code: 'parity.notAvailable', params: { provider: 'Codex' } } }
const notInClaude = { available: false, refusal: { code: 'parity.notAvailable', params: { provider: 'Claude' } } }

describe('A64 · provider parity', () => {
  // Changed on 2026-11-12 by the product owner's decision: Fork was never built for Claude (its menu item answered with
  // an error), and he chose to declare it unavailable there instead of building it. It was "Claude has them all".
  test('A64: the known cases, per provider: Claude has them all but Fork; Codex lacks Branch and Always allow beyond the session', () => {
    expect([...PARITY_FEATURES].sort()).toEqual(['alwaysAllowBeyondSession', 'branch', 'effort', 'fork', 'paneConversation'])
    for (const feature of PARITY_FEATURES.filter(value => value !== 'fork')) expect(parityFor('claude', feature), feature).toEqual({ available: true })
    expect(parityFor('claude', 'fork')).toEqual(notInClaude)
    expect(parityFor('codex', 'branch')).toEqual(notInCodex)
    expect(parityFor('codex', 'alwaysAllowBeyondSession')).toEqual(notInCodex)
    for (const feature of ['fork', 'effort', 'paneConversation'] as const) expect(parityFor('codex', feature), feature).toEqual({ available: true })
  })

  test('A64: the conversation\'s capability manifest says the same, with the same reason code, so the window never decides from the provider name', () => {
    for (const provider of ['claude', 'codex'] as const) {
      const features = threadCapabilityManifest(provider, native, true).features as unknown as Record<string, { enabled: boolean; messageCode?: unknown }>
      for (const feature of PARITY_FEATURES) {
        const parity = parityFor(provider, feature)
        expect(features[feature]?.enabled, `${provider} ${feature}`).toBe(parity.available)
        if (!parity.available) expect(features[feature].messageCode, `${provider} ${feature}`).toEqual(parity.refusal)
      }
    }
  })

  test('A64: the reason is a C3 code with the provider\'s name as a value', () => {
    expect(MESSAGE_CODES as readonly string[]).toContain('parity.notAvailable')
  })
})
