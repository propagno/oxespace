import { parityFor, type ParityFeature } from '../../../../shared/provider-parity'
import type { ConversationCapabilities, ConversationProtocolEvidence, ThreadCapability, ThreadCapabilityManifest, ThreadProvider, ThreadConfiguration } from '../../../../shared/types/thread'

const capability = (implemented: boolean, reason?: string, verified: ThreadCapability['verified'] = implemented ? 'fixture' : 'none'): ThreadCapability => ({
  availability: implemented ? 'supported' : 'unavailable', enabled: implemented, authorized: implemented, implemented, verified, ...(reason ? { reason } : {})
})

function parityCapability(provider: ThreadProvider, feature: ParityFeature): ThreadCapability {
  const answer = parityFor(provider, feature)
  if (answer.available) return capability(true)
  return {
    availability: 'unavailable',
    enabled: false,
    authorized: true,
    implemented: false,
    verified: 'fixture',
    reason: `Not available in ${answer.refusal.params.provider}`,
    messageCode: answer.refusal
  }
}

const experimental = (implemented: boolean, reason: string): ThreadCapability => ({ availability: 'experimental', enabled: implemented, authorized: implemented, implemented, verified: implemented ? 'fixture' : 'none', reason })

/** Public, persisted capability projection. It describes integration evidence, not catalog discovery as proof. */
export function threadCapabilityManifest(provider: ThreadProvider, native?: ConversationCapabilities, connected = false, evidence?: ConversationProtocolEvidence, configuration?: ThreadConfiguration): ThreadCapabilityManifest {
  const feature = (name: keyof ConversationCapabilities, unavailable: string) => native ? capability(Boolean(native[name]), native[name] ? undefined : unavailable) : capability(false, 'Starts when the provider session is connected')
  const manifest: ThreadCapabilityManifest = {
    provider,
    ...(evidence?.providerVersion ? { providerVersion: evidence.providerVersion } : {}),
    ...(evidence?.protocolVersion ? { protocolVersion: evidence.protocolVersion } : {}),
    platform: process.platform,
    authentication: 'subscription',
    features: {
      conversation: capability(true, undefined, connected ? evidence?.verified ?? 'native' : 'fixture'),
      resume: feature('resume', 'The provider cannot resume native sessions'),
      nativeSessions: feature('nativeSessions', 'Native session operations are unavailable'),
      modelSelection: feature('modelSelection', 'The provider does not expose model selection'),
      approvals: feature('approvals', 'The provider does not expose approval requests'),
      questions: feature('questions', 'The provider does not expose structured questions'),
      permissions: feature('permissions', 'The provider does not expose incremental permission requests'),
      elicitation: feature('elicitation', 'The provider does not expose MCP elicitation'),
      attachments: feature('attachments', 'The provider does not accept image inputs in this transport'),
      queue: feature('queue', 'Native provider queue is unavailable; follow-ups remain safe in the OXESpace local queue'),
      localQueue: capability(true),
      steering: feature('steering', provider === 'claude' ? 'Claude headless mode cannot steer an active turn' : 'Active-turn steering is unavailable'),
      historyPagination: capability(true),
      projectChanges: capability(true),
      slashCommands: capability(true),
      mcp: capability(true),
      mcpManagement: provider === 'codex' ? capability(true) : provider === 'antigravity' ? capability(false, 'Antigravity MCP servers are managed in its own settings; OXESpace attaches its own when the session opens')
        : experimental(true, 'Claude commands are discovered natively; authenticated management still requires a provider pilot'),
      hooks: provider === 'claude' ? capability(true, 'Native hooks require explicit writable access') : capability(false, provider === 'antigravity' ? 'Antigravity hooks are not exposed to OxeChat' : 'Codex hooks can be inspected but are not edited by Thread'),
      appsAndPlugins: provider === 'codex' ? experimental(true, 'Codex app metadata and plugin lifecycle use experimental app-server methods')
        : provider === 'antigravity' ? capability(false, 'Antigravity plugins are managed in its own CLI') : experimental(true, 'Claude plugin commands are discovered from the installed CLI'),
      exportEvidence: capability(true),
      nativeSessionLock: capability(true),
      workingTreeEvidence: capability(true, 'Claude disk observations identify indeterminate authorship'),
      voiceDraft: capability(true),
      subagentObservation: provider === 'codex'
        ? experimental(true, 'Codex reports collaboration events; lifecycle remains owned by the active native turn')
        : provider === 'antigravity' ? capability(false, 'Antigravity does not report its subagents over ACP')
        : experimental(true, 'Native task events are observed after the parent result; real-account lifecycle validation is pending'),
      subagentLifecycle: native?.stopTasks
        ? capability(true, 'Running background tasks can be stopped; spawn, resume and retry stay with the provider', 'native')
        : capability(false, provider === 'antigravity' ? 'Antigravity does not expose child agent operations over ACP' : provider === 'codex'
          ? 'The Codex app-server version in use does not expose independent, idempotent child lifecycle operations'
          : 'Claude headless mode does not expose spawn, interrupt, resume or retry operations for child agents'),
      additionalProviders: capability(false, 'OxeCode providers without a supported headless protocol remain OxeCode-only'),
      fork: parityCapability(provider, 'fork'),
      branch: parityCapability(provider, 'branch'),
      alwaysAllowBeyondSession: parityCapability(provider, 'alwaysAllowBeyondSession'),
      paneConversation: parityCapability(provider, 'paneConversation'),
      effort: parityCapability(provider, 'effort')
    }
  }
  if (provider === 'claude' && (configuration?.access ?? 'read-only') === 'read-only') {
    for (const name of ['mcpManagement', 'hooks', 'subagentObservation'] as const) {
      manifest.features[name] = { ...manifest.features[name], enabled: false, authorized: false, reason: 'Disabled by this conversation’s read-only tool policy', messageCode: { code: 'thread.capability.readOnly', params: {} } }
    }
    manifest.features.mcp = { ...manifest.features.mcp, reason: 'Restricted by this conversation’s read-only policy: OXESpace lookups only, no user MCP servers', messageCode: { code: 'thread.capability.mcpReadOnly', params: {} } }
  }
  // Antigravity read-only gets the same surface: the bridge's lookups, none of the person's servers.
  if (provider === 'antigravity' && (configuration?.access ?? 'read-only') === 'read-only') {
    manifest.features.mcp = { ...manifest.features.mcp, reason: 'Restricted by this conversation’s read-only policy: OXESpace lookups only, no user MCP servers', messageCode: { code: 'thread.capability.mcpReadOnly', params: {} } }
  }
  return manifest

}
