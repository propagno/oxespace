import { expect } from 'vitest'
import type { AgentConversationAdapter, ThreadProvider } from '../shared/types/thread'
import { threadCapabilityManifest } from '../electron/main/services/conversation/thread-capabilities'

const REQUIRED = ['resume', 'approvals', 'attachments', 'modelSelection'] as const

/** Shared structural gate used before any provider can be exposed in Thread. */
export function assertAdapterConformance(provider: ThreadProvider, adapter: AgentConversationAdapter): void {
  expect(adapter.evidence.transport.trim().length).toBeGreaterThan(0)
  expect(['fixture', 'native', 'pilot']).toContain(adapter.evidence.verified)
  for (const name of REQUIRED) expect(typeof adapter.capabilities[name]).toBe('boolean')
  for (const name of ['start', 'send', 'interrupt', 'approve', 'dispose'] as const) expect(typeof adapter[name]).toBe('function')
  if (adapter.capabilities.steering) expect(typeof adapter.steer).toBe('function')
  if (adapter.capabilities.queue) expect(typeof adapter.enqueue).toBe('function')
  if (adapter.capabilities.questions || adapter.capabilities.permissions || adapter.capabilities.elicitation) expect(typeof adapter.respondRequest).toBe('function')
  const manifest = threadCapabilityManifest(provider, adapter.capabilities, true, adapter.evidence)
  expect(manifest.provider).toBe(provider)
  expect(manifest.features.conversation).toMatchObject({ enabled: true, authorized: true, implemented: true })
  expect(Object.values(manifest.features).every(value => value.enabled ? value.authorized && value.implemented : true)).toBe(true)
}
