import { describe, it } from 'vitest'
import { CodexConversationAdapter, type ConversationTransport } from '../electron/main/services/conversation/codex-conversation'
import { ClaudeConversationAdapter } from '../electron/main/services/conversation/claude-conversation'
import { assertAdapterConformance } from './thread-adapter-conformance'

const transport = (): ConversationTransport & { endInput(): void } => ({
  write: () => {}, onData: () => {}, onClose: () => {}, close: async () => {}, endInput: () => {}
})

describe('Thread adapter conformance gate', () => {
  it('qualifies the Codex app-server adapter', () => assertAdapterConformance('codex', new CodexConversationAdapter(transport())))
  it('qualifies the Claude stream-json adapter', () => assertAdapterConformance('claude', new ClaudeConversationAdapter(() => transport())))
})
