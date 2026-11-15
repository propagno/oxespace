import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import type { ConversationThread } from '../../shared/types/thread'
import { threadNavigationStatus } from '../../src/components/Threads/threadNavigationStatus'
import { explainRows } from '../../src/components/Grid/StatusExplainDialog'
import { formatPaneStatus, type PaneDisplayTone } from '../../src/utils/paneDisplay'
import { changeLanguage, i18n } from '../../src/i18n'

// OXE-159: a state has one name everywhere. The contract is docs/design/glossary.md § 5 (Agent states): seven states,
// plus Starting / Exited for a terminal only. The words are read from that table, so the glossary and the catalogs
// cannot drift apart.
type Language = 'en' | 'pt-BR'
type State = 'needs-you' | 'failed' | 'working' | 'finished' | 'idle' | 'stopped' | 'unknown'
const STATES: State[] = ['needs-you', 'failed', 'working', 'finished', 'idle', 'stopped', 'unknown']

function glossary(): { words: Record<Language, Record<State, string>>; terminal: Record<Language, { starting: string; exited: string }> } {
  const text = readFileSync(join(__dirname, '../../docs/design/glossary.md'), 'utf8').replace(/\r\n/g, '\n')
  const section = text.slice(text.indexOf('\n## 5. Agent states'), text.indexOf('\n## 6.'))
  const rows = section.split('\n').filter(line => line.startsWith('| ')).map(line => line.split('|').slice(1, -1).map(cell => cell.trim()))
  const words = { en: {}, 'pt-BR': {} } as Record<Language, Record<State, string>>
  let terminal: Record<Language, { starting: string; exited: string }> | null = null
  for (const [state, en, pt] of rows) {
    if ((STATES as string[]).includes(state)) { words.en[state as State] = en; words['pt-BR'][state as State] = pt }
    if (state.startsWith('(terminal only)')) {
      const [enStarting, enExited] = en.split(' / '), [ptStarting, ptExited] = pt.split(' / ')
      terminal = { en: { starting: enStarting, exited: enExited }, 'pt-BR': { starting: ptStarting, exited: ptExited } }
    }
  }
  for (const state of STATES) if (!words.en[state] || !words['pt-BR'][state]) throw new Error(`glossary § 5 has no row for ${state}`)
  if (!terminal) throw new Error('glossary § 5 has no terminal-only row')
  return { words, terminal }
}
const GLOSSARY = glossary()
const seven = (language: Language): string[] => STATES.map(state => GLOSSARY.words[language][state])

const thread = (change: Partial<ConversationThread>): ConversationThread => ({
  id: 't', workspaceId: 'w', projectId: 'p', rootPath: '/r', provider: 'claude', nativeSessionId: null, title: 'T', pinned: false,
  status: 'idle', createdAt: 0, updatedAt: 0, ...change
})
const THREAD_STATUSES: ConversationThread['status'][] = ['idle', 'running', 'approval', 'failed', 'interrupted']
const LAST_TURNS: Array<ConversationThread['lastTurnStatus']> = [undefined, 'completed', 'failed', 'interrupted']
const lifecycle = (state: string): string => explainRows({ statusLabel: '', originLabel: null }, { state: { state, since: 1, source: 'lifecycle' } } as never)
  .find(row => row.label === i18n.t('code:paneMenu.explain.lifecycle'))!.detail

afterAll(async () => { await changeLanguage('en') })

it('the glossary keeps every state word an adjective: finished is "Concluído" in pt-BR', () => {
  expect(GLOSSARY.words['pt-BR'].finished).toBe('Concluído')
})

describe.each(['en', 'pt-BR'] as const)('the state words in %s', language => {
  const w = GLOSSARY.words[language]

  it("the conversation row says only a glossary state word, whatever the thread's state", async () => {
    await changeLanguage(language)
    for (const status of THREAD_STATUSES) for (const lastTurnStatus of LAST_TURNS) for (const background of [undefined, { running: 1, since: Date.now() }]) {
      const { label } = threadNavigationStatus(thread({ status, ...(lastTurnStatus ? { lastTurnStatus } : {}), ...(background ? { background } : {}) }))
      expect(seven(language), `${status} / ${lastTurnStatus} / ${background ? 'background' : '-'}`).toContain(label)
    }
    expect(threadNavigationStatus(thread({})).label).toBe(w.idle)
    expect(threadNavigationStatus(thread({ status: 'interrupted' }))).toEqual({ kind: 'interrupted', label: w.stopped })
    expect(threadNavigationStatus(thread({ lastTurnStatus: 'completed' })).label).toBe(w.finished)
    expect(threadNavigationStatus(thread({ lastTurnStatus: 'completed', background: { running: 1, since: Date.now() } })).label).toBe(w.working)
    expect(threadNavigationStatus(thread({ status: 'approval' })).label).toBe(w['needs-you'])
  })

  it('the conversation state catalog holds only glossary state words, and no "Ready"', async () => {
    await changeLanguage(language)
    const catalog = i18n.t('thread:status', { returnObjects: true }) as Record<string, string>
    for (const [key, label] of Object.entries(catalog)) expect(seven(language), `thread:status.${key}`).toContain(label)
    expect(Object.values(catalog).join(' ')).not.toMatch(/\bReady\b|\bPront[oa]\b/)
  })

  it('a turn that was stopped says the stopped word in its footer, beside Finished and Failed', async () => {
    await changeLanguage(language)
    expect({ completed: i18n.t('thread:turnTiming.completed'), failed: i18n.t('thread:turnTiming.failed'), interrupted: i18n.t('thread:turnTiming.interrupted') })
      .toEqual({ completed: w.finished, failed: w.failed, interrupted: w.stopped })
  })

  it("the pane's status says a glossary state word for an agent, and the terminal-only words for starting and exited", async () => {
    await changeLanguage(language)
    const t = GLOSSARY.terminal[language]
    const expected: Record<PaneDisplayTone, string> = { 'needs-decision': w['needs-you'], thinking: w.working, awaiting: w.finished, idle: w.idle, error: w.failed, starting: t.starting, exited: t.exited }
    for (const [tone, label] of Object.entries(expected)) expect(formatPaneStatus(tone as PaneDisplayTone), tone).toBe(label)
    expect(i18n.t('code:pane.status.running')).toBe(w.working)
  })

  it('"why this status" names the lifecycle state with the glossary words', async () => {
    await changeLanguage(language)
    expect({ working: lifecycle('working'), blocked: lifecycle('blocked'), done: lifecycle('done'), idle: lifecycle('idle'), unknown: lifecycle('unknown') })
      .toEqual({ working: w.working, blocked: w['needs-you'], done: w.finished, idle: w.idle, unknown: w.unknown })
  })
})
