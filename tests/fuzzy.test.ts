import { describe, expect, it } from 'vitest'
import { fuzzyScore, isSubsequence, rankBy, rankText } from '../src/utils/fuzzy'

describe('palette ranking', () => {
  it('scores file names: basename > path > subsequence', () => {
    expect(fuzzyScore('src/App.tsx', 'app')).toBeGreaterThan(fuzzyScore('src/apps/index.ts', 'app'))
    expect(fuzzyScore('src/components/Foo.tsx', 'components')).toBe(500)
    expect(fuzzyScore('src/components/Foo.tsx', 'scf')).toBe(100)
    expect(fuzzyScore('src/App.tsx', 'zzz')).toBe(0)
    expect(isSubsequence('git commit', 'gtcmt')).toBe(true)
  })

  it('needs every word to match and prefers the start of the title', () => {
    expect(rankText('Usage & Rate Limits', 'quota', 'usage rate')).toBeGreaterThan(0)
    expect(rankText('Usage & Rate Limits', 'quota', 'usage nothing')).toBe(0)
    expect(rankText('Files', '', 'fi')).toBeGreaterThan(rankText('Find in files', '', 'fi'))
    expect(rankText('Toggle sidebar', '', 'side')).toBeGreaterThan(rankText('Open settings', 'sidebar', 'side'))
    expect(rankText('Toggle sidebar', '', 'tgsb')).toBeGreaterThan(0)
  })

  it('orders by score and keeps the input order without a query', () => {
    const items = ['Find in files', 'Files', 'Settings: Keyboard']
    expect(rankBy(items, 'fi', item => rankText(item, '', 'fi'))).toEqual(['Files', 'Find in files'])
    expect(rankBy(items, '', () => 0)).toEqual(items)
  })
})
