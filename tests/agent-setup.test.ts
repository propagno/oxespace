import { describe, expect, it } from 'vitest'
import type { AgentReadiness } from '../shared/types/agent'
import { summarizeAgentSetup } from '../src/utils/agentSetup'

const entry = (provider: AgentReadiness['provider'], status: AgentReadiness['status'], details?: string): AgentReadiness => ({ provider, command: provider, status, details })

describe('first-run agent setup summary', () => {
  it('is unchecked when nothing has been detected yet', () => {
    expect(summarizeAgentSetup([], false).state).toBe('unchecked')
    expect(summarizeAgentSetup([entry('claude', 'unknown')], false).state).toBe('unchecked')
  })

  it('reports that it is checking while a check runs and nothing is ready', () => {
    const summary = summarizeAgentSetup([], true)
    expect(summary.state).toBe('checking')
    expect(summary.headline).toMatch(/Checking/)
  })

  it('says none were found only after a check reported them missing', () => {
    const summary = summarizeAgentSetup([entry('claude', 'missing'), entry('codex', 'missing')], false)
    expect(summary.state).toBe('none')
    expect(summary.detail).toMatch(/Install Claude Code or Codex/)
    expect(summary.detail).toMatch(/PATH/)
  })

  it('names one ready CLI and says Thread can use it when it is Claude Code or Codex', () => {
    const summary = summarizeAgentSetup([entry('claude', 'ready'), entry('codex', 'missing')], false)
    expect(summary).toMatchObject({ state: 'ready', headline: 'Claude Code is ready', threadReady: true, ready: ['Claude Code'] })
    expect(summary.detail).toBe('Code and Thread can use it.')
  })

  it('joins several ready CLIs in plain language', () => {
    expect(summarizeAgentSetup([entry('claude', 'ready'), entry('codex', 'ready')], false).headline).toBe('Claude Code and Codex are ready')
    expect(summarizeAgentSetup([entry('claude', 'ready'), entry('codex', 'ready'), entry('cursor', 'ready')], false).headline).toBe('Claude Code, Codex and Cursor are ready')
  })

  it('warns that Thread needs Claude Code or Codex when only other CLIs are ready', () => {
    const summary = summarizeAgentSetup([entry('copilot', 'ready'), entry('claude', 'missing')], false)
    expect(summary.state).toBe('ready')
    expect(summary.threadReady).toBe(false)
    expect(summary.detail).toBe('Code can run it. Thread needs Claude Code or Codex.')
  })

  it('a ready CLI wins over a check still running for the others', () => {
    expect(summarizeAgentSetup([entry('claude', 'ready')], true).state).toBe('ready')
  })

  it('reports a CLI found but not ready, with its own explanation', () => {
    const summary = summarizeAgentSetup([entry('codex', 'partial', 'Not signed in'), entry('claude', 'missing')], false)
    expect(summary.state).toBe('needs-attention')
    expect(summary.headline).toBe('Codex was found but not ready')
    expect(summary.detail).toBe('Not signed in')
  })

  it('falls back to a pointer to settings when a partial CLI has no details', () => {
    expect(summarizeAgentSetup([entry('codex', 'partial')], false).detail).toMatch(/Agents settings/)
  })
})
