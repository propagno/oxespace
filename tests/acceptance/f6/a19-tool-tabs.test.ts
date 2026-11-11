// Frozen acceptance test for 1.5.0 A19 (OXE program, phase F6): the conversation's tabs appear only for the tools it
// used, each with its count, built in main from F4's places and panes, F3's activity summary and the PR state.
// Written by the planner; the executor must not edit it.
// CCR: docs/roadmap-1.5/ccr-f6-conversation.md §A19; DESIGN 1.5.0-f6-design.md U6.1 (tabs) and U6.8 of F4.
import { describe, expect, test } from 'vitest'
import { threadToolTabs, TOOL_TABS } from '../../../electron/main/services/conversation/thread-tool-tabs'

const none = { summary: { databases: 0, http: 0, containers: 0 }, files: 0, panes: 0, pullRequest: null }

describe('A19 · tabs only for the tools used', () => {
  test('A19: the tab order is fixed: Conversation, Terminal, Queries, Network, Containers, Changes, Pull request', () => {
    expect(TOOL_TABS).toEqual(['conversation', 'terminal', 'queries', 'network', 'containers', 'changes', 'pullRequest'])
  })

  test('A19: a conversation that only wrote files shows Conversation and Changes, with the file count', () => {
    expect(threadToolTabs({ ...none, files: 3 })).toEqual([{ tab: 'conversation', count: null }, { tab: 'changes', count: 3 }])
  })

  test('A19: each source adds its tab with its count, in order; zero leaves it out', () => {
    const tabs = threadToolTabs({ summary: { databases: 2, http: 5, containers: 0 }, files: 1, panes: 1, pullRequest: { number: 321 } })
    expect(tabs).toEqual([
      { tab: 'conversation', count: null }, { tab: 'terminal', count: 1 }, { tab: 'queries', count: 2 }, { tab: 'network', count: 5 },
      { tab: 'changes', count: 1 }, { tab: 'pullRequest', count: null }
    ])
  })

  test('A19: a source that failed to load (null) adds no tab: an unknown count never invents a tool the conversation may not have used', () => {
    expect(threadToolTabs({ ...none, files: 1, summary: { databases: null, http: 4, containers: null } })).toEqual([{ tab: 'conversation', count: null }, { tab: 'network', count: 4 }, { tab: 'changes', count: 1 }])
  })

  test('A19: a conversation with nothing but its messages has only the Conversation tab', () => {
    expect(threadToolTabs(none)).toEqual([{ tab: 'conversation', count: null }])
  })
})
