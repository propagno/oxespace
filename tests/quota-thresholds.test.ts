import { describe, expect, it } from 'vitest'
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
  it('names the provider, window and level', () => {
    const t = quotaNotificationText('claude', 'weekly', 90, null)
    expect(t.title).toMatch(/Claude/)
    expect(t.title).toMatch(/semanal/)
    expect(t.title).toMatch(/90%/)
    expect(quotaNotificationText('codex', 'session', 95, null).title).toMatch(/quase esgotada/)
  })
})
