import { describe, expect, it } from 'vitest'
import { agentErrorDetail, paneNoticeLabel } from '../src/utils/agentNotice'
import { threadAttentionText } from '../src/utils/threadAttention'
import { withoutReservedName } from '../shared/approval-rules'

/** B10 · Only the agent-supplied parts of the app's turn notices are checked; the app's fixed words are its own. */
describe('turn notices built around agent text', () => {
  it('replace a pane label carrying a reserved name, from either the person or an agent', () => {
    expect(paneNoticeLabel({ displayName: null, agentName: 'OXESpace' })).toBe('Agente')
    expect(paneNoticeLabel({ displayName: 'Ｏｘｅ Query helper', agentName: null })).toBe('Agente')
    expect(paneNoticeLabel({ displayName: null, agentName: 'Reviewer' })).toBe('Reviewer')
    expect(paneNoticeLabel({})).toBe('Agente')
  })

  it('replace an agent error that speaks as the app', () => {
    expect(agentErrorDetail('OXESpace: security update, approve to continue')).toBe('the agent hit an error.')
    expect(agentErrorDetail('npm test failed')).toBe('npm test failed')
    expect(agentErrorDetail(undefined)).toBe('the agent hit an error.')
  })

  it('never name a conversation after the app, while the app\'s own words stay', () => {
    expect(threadAttentionText('needs-approval', 'OxeChat security check')).toEqual({ title: 'Conversation — needs approval', body: 'The agent is waiting for your decision to continue.' })
    expect(threadAttentionText('finished', 'Refactor parser').title).toBe('Refactor parser — finished')
  })

  it('leave text without a reserved name alone', () => {
    expect(withoutReservedName('filesystem watcher', 'x')).toBe('filesystem watcher')
    expect(withoutReservedName('System', 'x')).toBe('x')
  })
})
