// Frozen acceptance test for CR-08 (FRONTEND re-check of #608, OXE phase F1, A4). The executor must not edit it.
// With the submit buttons in the U1 footer, Enter in a one-field form submits natively: each onSubmit must refuse
// exactly what the disabled primary refuses.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, test } from 'vitest'

const ROOT = join(__dirname, '..', '..', '..')
const read = (path: string): string => readFileSync(join(ROOT, path), 'utf8')

describe('CR-08 · Enter never submits what the disabled primary would refuse', () => {
  test('Add project: a second submit while one is pending does nothing', () => {
    const source = read('src/components/Threads/ThreadDialogs.tsx')
    const start = source.indexOf('export function AddThreadProjectDialog')
    const body = source.slice(start, source.indexOf('\nexport function', start + 10) > 0 ? source.indexOf('\nexport function', start + 10) : undefined)
    const submit = body.slice(body.indexOf('const submit'), body.indexOf('const submit') + 400)
    expect(submit).toMatch(/if\s*\(\s*(pending|busy|adding|saving|working)\b[^)]*\)\s*return/)
  })

  test('Rename: an unchanged or empty title is not sent', () => {
    const source = read('src/components/Threads/ThreadSidebar.tsx')
    const form = source.slice(source.indexOf('id="rename-thread-form"'), source.indexOf('id="rename-thread-form"') + 600)
    expect(form).toMatch(/===\s*renameTarget\.title|renameTarget\.title\s*===/)
    expect(form).toMatch(/acting/)
  })
})
