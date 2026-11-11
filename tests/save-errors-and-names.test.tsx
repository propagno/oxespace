import { afterEach, describe, expect, it } from 'vitest'
import { changeLanguage } from '../src/i18n'
import { withProjectPaths } from '../src/store/editor.store'

afterEach(async () => { await changeLanguage('en'); delete (window as unknown as { oxe?: unknown }).oxe })

describe('paths in an editor message', () => {
  it('are written from the project root; anything outside shows only its file name', () => {
    expect(withProjectPaths("Sem permissão para usar C:\\Users\\ana\\repo\\src\\app.ts.", 'C:\\Users\\ana\\repo')).toBe('Sem permissão para usar src/app.ts.')
    expect(withProjectPaths('No permission to use /home/ana/repo/docs/notes.md.', '/home/ana/repo/')).toBe('No permission to use docs/notes.md.')
    // The root's case and slashes may differ from the message's (Windows).
    expect(withProjectPaths("No permission to use 'c:/users/ana/repo/a.ts'", 'C:\\Users\\ana\\repo')).toBe("No permission to use 'a.ts'")
    expect(withProjectPaths('No permission to use C:\\Windows\\System32\\drivers\\etc\\hosts', 'C:\\Users\\ana\\repo')).toBe('No permission to use hosts')
    expect(withProjectPaths('Not found: \\\\server\\share\\team\\plan.md', 'C:\\repo')).toBe('Not found: plan.md')
    // Not a path: a slash inside a word stays.
    expect(withProjectPaths('Read and/or write the file', '/repo')).toBe('Read and/or write the file')
  })
})
