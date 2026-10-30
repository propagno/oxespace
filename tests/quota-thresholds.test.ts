import { afterEach, describe, expect, it } from 'vitest'
import { changeLanguage } from '../src/i18n'
import { nextQuotaState, quotaNotificationText, type QuotaTrack } from '../src/utils/quotaThresholds'

const step = (previous: QuotaTrack | undefined, pct: number, reset: number | null = 1_000_000) => nextQuotaState(previous, pct, reset)

describe('nextQuotaState', () => {
  it('seeds silently on first sight, even above a threshold', () => {
    expect(step(undefined, 92)).toMatchObject({ crossed: null, track: { announced: 90 } })
    expect(step(undefined, 10)).toMatchObject({ crossed: null, track: { announced: 0 } })
  })

  it('announces each threshold once as usage climbs', () => {
    let t = step(undefined, 40).track
    const seen: Array<number | null> = []
    for (const pct of [45, 52, 53, 76, 80, 91, 92, 96, 99]) {
      const d = step(t, pct)
      t = d.track
      seen.push(d.crossed)
    }
    expect(seen).toEqual([null, 50, null, 75, null, 90, null, 95, null])
  })

  it('reports only the highest threshold when several are jumped', () => {
    expect(step(step(undefined, 10).track, 93).crossed).toBe(90)
  })

  it('starts over after the window resets, by falling usage or a later reset time', () => {
    const high = step(step(undefined, 40).track, 96).track
    expect(high.announced).toBe(95)
    const afterDrop = step(high, 12)
    expect(afterDrop.crossed).toBeNull()
    expect(afterDrop.track.announced).toBe(0)
    expect(step(afterDrop.track, 55).crossed).toBe(50)

    const sameLevelNewWindow = step(step(undefined, 40, 1_000_000).track, 52, 1_000_000 + 7 * 86_400_000)
    expect(sameLevelNewWindow.crossed).toBe(50)
  })

  it('clamps nonsense input', () => {
    expect(step(undefined, 250).track.lastPct).toBe(100)
    expect(step(undefined, -5).track.lastPct).toBe(0)
  })
})

describe('quotaNotificationText', () => {
  afterEach(async () => { await changeLanguage('en') })

  it('names the provider, window and level', () => {
    const t = quotaNotificationText('claude', 'weekly', 90, null)
    expect(t.title).toBe('Claude: weekly quota very high (90%)')
    expect(t.body).toBe("Claude's weekly window passed 90% of the limit.")
    expect(quotaNotificationText('codex', 'session', 95, null).title).toBe('Codex: 5-hour quota almost used up (95%)')
  })

  it('speaks the interface language', async () => {
    await changeLanguage('pt-BR')
    const t = quotaNotificationText('claude', 'weekly', 90, Date.UTC(2026, 9, 14, 12))
    expect(t.title).toBe('Claude: cota semanal muito alta (90%)')
    expect(t.body).toMatch(/^A janela semanal do Claude passou de 90% do limite\. Renova em 14\/10\/2026/)
    expect(quotaNotificationText('codex', 'session', 95, null).title).toBe('Codex: cota de 5 horas quase esgotada (95%)')
  })
})
