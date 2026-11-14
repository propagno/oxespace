import { afterAll, describe, expect, it } from 'vitest'
import type { ConversationThread } from '../../shared/types/thread'
import { threadNavigationStatus } from '../../src/components/Threads/threadNavigationStatus'
import { explainRows } from '../../src/components/Grid/StatusExplainDialog'
import { formatPaneStatus, type PaneDisplayTone } from '../../src/utils/paneDisplay'
import { changeLanguage, i18n } from '../../src/i18n'

// OXE-159: a state has one name everywhere since 1.5.0 (src/design/targets/README.md › State words and place names).
const WORDS = {
  en: { needsYou: 'Needs you', working: 'Working', idle: 'Idle', failed: 'Failed', finished: 'Finished', unconfirmed: 'Unconfirmed', starting: 'Starting', exited: 'Exited' },
  'pt-BR': { needsYou: 'Precisa de você', working: 'Trabalhando', idle: 'Ocioso', failed: 'Falhou', finished: 'Concluído', unconfirmed: 'Não confirmado', starting: 'Iniciando', exited: 'Encerrado' }
} as const
type Language = keyof typeof WORDS
const five = (language: Language): string[] => { const w = WORDS[language]; return [w.needsYou, w.working, w.idle, w.failed, w.finished] }

const thread = (change: Partial<ConversationThread>): ConversationThread => ({
  id: 't', workspaceId: 'w', projectId: 'p', rootPath: '/r', provider: 'claude', nativeSessionId: null, title: 'T', pinned: false,
  status: 'idle', createdAt: 0, updatedAt: 0, ...change
})
const STATUSES: ConversationThread['status'][] = ['idle', 'running', 'approval', 'failed', 'interrupted']
const LAST_TURNS: Array<ConversationThread['lastTurnStatus']> = [undefined, 'completed', 'failed', 'interrupted']
const lifecycle = (state: string): string => explainRows({ statusLabel: '', originLabel: null }, { state: { state, since: 1, source: 'lifecycle' } } as never)
  .find(row => row.label === i18n.t('code:paneMenu.explain.lifecycle'))!.detail

afterAll(async () => { await changeLanguage('en') })

describe.each(['en', 'pt-BR'] as const)('the state words in %s', language => {
  const w = WORDS[language]

  it("the conversation row says only one of the five words, whatever the thread's state", async () => {
    await changeLanguage(language)
    for (const status of STATUSES) for (const lastTurnStatus of LAST_TURNS) for (const background of [undefined, { running: 1, since: Date.now() }]) {
      const { label } = threadNavigationStatus(thread({ status, ...(lastTurnStatus ? { lastTurnStatus } : {}), ...(background ? { background } : {}) }))
      expect(five(language), `${status} / ${lastTurnStatus} / ${background ? 'background' : '-'}`).toContain(label)
    }
    expect(threadNavigationStatus(thread({})).label).toBe(w.idle)
    expect(threadNavigationStatus(thread({ status: 'interrupted' })).label).toBe(w.idle)
    expect(threadNavigationStatus(thread({ lastTurnStatus: 'completed' })).label).toBe(w.finished)
    expect(threadNavigationStatus(thread({ lastTurnStatus: 'completed', background: { running: 1, since: Date.now() } })).label).toBe(w.working)
    expect(threadNavigationStatus(thread({ status: 'approval' })).label).toBe(w.needsYou)
  })

  it('the conversation state catalog holds only the five words, and no "Ready"', async () => {
    await changeLanguage(language)
    const catalog = i18n.t('thread:status', { returnObjects: true }) as Record<string, string>
    for (const [key, label] of Object.entries(catalog)) expect(five(language), `thread:status.${key}`).toContain(label)
    expect(Object.values(catalog).join(' ')).not.toMatch(/\bReady\b|\bPront[oa]\b/)
  })

  it("the pane's status says the five words for an agent, and the terminal-only words for starting and exited", async () => {
    await changeLanguage(language)
    const expected: Record<PaneDisplayTone, string> = { 'needs-decision': w.needsYou, thinking: w.working, awaiting: w.finished, idle: w.idle, error: w.failed, starting: w.starting, exited: w.exited }
    for (const [tone, label] of Object.entries(expected)) expect(formatPaneStatus(tone as PaneDisplayTone), tone).toBe(label)
    expect(i18n.t('code:pane.status.running')).toBe(w.working)
  })

  it('"why this status" names the lifecycle state with the five words, or "Unconfirmed"', async () => {
    await changeLanguage(language)
    expect({ working: lifecycle('working'), blocked: lifecycle('blocked'), done: lifecycle('done'), idle: lifecycle('idle'), unknown: lifecycle('unknown') })
      .toEqual({ working: w.working, blocked: w.needsYou, done: w.finished, idle: w.idle, unknown: w.unconfirmed })
  })
})
