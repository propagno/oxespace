import type { ConversationCapabilities, ConversationProtocolEvidence, ThreadCapability, ThreadCapabilityManifest, ThreadProvider } from '../../../../shared/types/thread'

const capability = (implemented: boolean, reason?: string, verified: ThreadCapability['verified'] = implemented ? 'fixture' : 'none'): ThreadCapability => ({
  availability: implemented ? 'supported' : 'unavailable', enabled: implemented, authorized: implemented, implemented, verified, ...(reason ? { reason } : {})
})

const experimental = (implemented: boolean, reason: string): ThreadCapability => ({ availability: 'experimental', enabled: implemented, authorized: implemented, implemented, verified: implemented ? 'fixture' : 'none', reason })

/** Public, persisted capability projection. It describes integration evidence, not catalog discovery as proof. */
export function threadCapabilityManifest(provider: ThreadProvider, native?: ConversationCapabilities, connected = false, evidence?: ConversationProtocolEvidence): ThreadCapabilityManifest {
  const feature = (name: keyof ConversationCapabilities, unavailable: string) => native ? capability(Boolean(native[name]), native[name] ? undefined : unavailable) : capability(false, 'Starts when the provider session is connected')
  return {
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
      mcpManagement: provider === 'codex' ? capability(true) : experimental(true, 'Claude commands are discovered natively; authenticated management still requires a provider pilot'),
      hooks: provider === 'claude' ? capability(true, 'Native hooks require explicit writable access') : capability(false, 'Codex hooks can be inspected but are not edited by Thread'),
      appsAndPlugins: provider === 'codex' ? experimental(true, 'Codex app metadata and plugin lifecycle use experimental app-server methods') : experimental(true, 'Claude plugin commands are discovered from the installed CLI'),
      exportEvidence: capability(true),
      nativeSessionLock: capability(true),
      workingTreeEvidence: capability(true, 'Claude disk observations identify indeterminate authorship'),
      voiceDraft: capability(true),
      subagentObservation: provider === 'codex'
        ? experimental(true, 'Codex reports collaboration events; lifecycle remains owned by the active native turn')
        : capability(false, 'Claude headless mode does not expose a verified child-agent event contract'),
      subagentLifecycle: capability(false, provider === 'codex'
        ? 'The Codex app-server version in use does not expose independent, idempotent child lifecycle operations'
        : 'Claude headless mode does not expose spawn, interrupt, resume or retry operations for child agents'),
      additionalProviders: capability(false, 'Code providers without a supported headless protocol remain Code-only')
    }
  }
}
