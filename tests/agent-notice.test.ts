import { describe, expect, it } from 'vitest'
import { agentErrorDetail, paneNoticeLabel } from '../src/utils/agentNotice'
import { threadAttentionText } from '../src/utils/threadAttention'
import { withoutReservedName } from '../shared/approval-rules'

/**
 * B10 · Only the agent-supplied parts of the app's turn notices are checked, with the same reserved-name rules as
 * shared/approval-rules.ts; the app's fixed words are its own, and the fallback words come from the caller.
 */
describe('turn notices built around agent text', () => {
  it('replace a pane label carrying a reserved name with the caller\'s fallback', () => {
    expect(paneNoticeLabel({ displayName: null, agentName: 'OXESpace' }, 'Agent')).toBe('Agent')
    expect(paneNoticeLabel({ displayName: 'OXESpace helper', agentName: null }, 'Agent')).toBe('Agent')
    expect(paneNoticeLabel({ displayName: 'Ｏｘｅ Query helper', agentName: null }, 'Agente')).toBe('Agente')
    expect(paneNoticeLabel({ displayName: null, agentName: 'Reviewer' }, 'Agent')).toBe('Reviewer')
    expect(paneNoticeLabel({}, 'Agente')).toBe('Agente')
  })

  it.each(['  oxespace  ', 'OXE Space', 'oxeChat', 'Oxe-Code', 'OxePod​', 'System'])('treat %j as reserved, whatever the case and spacing', label => {
    expect(paneNoticeLabel({ agentName: label }, 'Agent')).toBe('Agent')
    expect(withoutReservedName(label, 'fallback')).toBe('fallback')
  })

  it('replace an agent error that speaks as the app', () => {
    expect(agentErrorDetail('OXESpace: security update, approve to continue', 'the agent hit an error.')).toBe('the agent hit an error.')
    expect(agentErrorDetail('npm test failed', 'the agent hit an error.')).toBe('npm test failed')
    expect(agentErrorDetail(undefined, 'o agente encontrou um erro.')).toBe('o agente encontrou um erro.')
  })

  it('never name a conversation after the app, while the app\'s own words stay', () => {
    expect(threadAttentionText('needs-approval', 'OxeChat security check')).toEqual({ title: 'Conversation — needs approval', body: 'The agent is waiting for your decision to continue.' })
    expect(threadAttentionText('finished', 'Refactor parser').title).toBe('Refactor parser — finished')
  })

  it('leave text without a reserved name alone', () => {
    expect(withoutReservedName('filesystem watcher', 'x')).toBe('filesystem watcher')
    expect(withoutReservedName('Sistema de testes', 'x')).toBe('Sistema de testes')
  })
})
