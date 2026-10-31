import { describe, expect, it } from 'vitest'
import { activeMention, rankMentionFiles } from '../../src/components/Threads/useFileMentions'

describe('file mentions', () => {
  it('finds the @token the caret is inside, only at a word start', () => {
    expect(activeMention('look at @src/ap', 15)).toEqual({ query: 'src/ap', start: 8 })
    expect(activeMention('@', 1)).toEqual({ query: '', start: 0 })
    expect(activeMention('mail me@example', 15)).toBeNull()
    expect(activeMention('@src/a.ts then more', 19)).toBeNull()
  })

  it('ranks basename prefixes before path matches', () => {
    const files = ['docs/app-notes.md', 'src/app.ts', 'src/components/App.tsx', 'src/lib/util.ts']
    expect(rankMentionFiles(files, 'app')).toEqual(['src/app.ts', 'docs/app-notes.md', 'src/components/App.tsx'])
    expect(rankMentionFiles(files, 'lib/')).toEqual(['src/lib/util.ts'])
    expect(rankMentionFiles(files, 'zzz')).toEqual([])
    expect(rankMentionFiles(files, '', 2)).toEqual(['docs/app-notes.md', 'src/app.ts'])
  })
})
