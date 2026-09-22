import { describe, expect, it } from 'vitest'
import { threadCapabilityManifest } from '../electron/main/services/conversation/thread-capabilities'

describe('Thread capability manifest', () => {
  it('separates integrated, unavailable and verified capabilities by provider', () => {
    const codex = threadCapabilityManifest('codex', { resume: true, approvals: true, attachments: true, modelSelection: true, questions: true, permissions: true, elicitation: true, queue: true, steering: true, nativeSessions: true })
    const claude = threadCapabilityManifest('claude', { resume: true, approvals: true, attachments: true, modelSelection: true, questions: true, permissions: false, elicitation: false, queue: false, steering: false, nativeSessions: true })
    expect(codex.features.steering).toMatchObject({ implemented: true, verified: 'fixture' })
    expect(claude.features.steering).toMatchObject({ implemented: false, availability: 'unavailable' })
    expect(claude.features.historyPagination).toMatchObject({ implemented: true })
    expect(claude.features.queue).toMatchObject({ implemented: false })
    expect(claude.features.localQueue).toMatchObject({ implemented: true })
    expect(codex.features.subagentObservation).toMatchObject({ implemented: true, availability: 'experimental' })
    expect(codex.features.subagentLifecycle).toMatchObject({ implemented: false, availability: 'unavailable' })
    expect(claude.features.subagentLifecycle.reason).toContain('does not expose')
  })
})
