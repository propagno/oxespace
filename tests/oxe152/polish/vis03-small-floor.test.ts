import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const read = (rel: string): string => readFileSync(join(process.cwd(), rel), 'utf8')

describe('OXE-26 VIS-03 global small font-size floor', () => {
  it('sets global small font-size in reset.css to var(--fs-2xs) without 80% or layout regression across themes and densities', () => {
    const reset = read('src/styles/reset.css').replace(/\/\*[\s\S]*?\*\//g, '')
    const smallMatch = reset.match(/(?:^|\n)\s*small\s*\{([^}]*)\}/)
    expect(smallMatch, 'global small rule in src/styles/reset.css').not.toBeNull()
    const body = smallMatch![1]
    expect(body).toMatch(/font-size\s*:\s*var\(--fs-2xs\)\s*;/)
    expect(body).not.toMatch(/80%|\b\d+(?:\.\d+)?(?:px|rem|em)\b/)

    // sub and sup remain untouched (out of scope per OXE-26).
    expect(reset).toMatch(/sub\s*,\s*sup\s*\{[^}]*font-size\s*:\s*75%/)

    // --fs-2xs is defined in tokens.generated.css at 11px (compact) and 12px (comfortable), never below 11px.
    const tokens = read('src/styles/tokens.generated.css')
    const fs2xs = [...tokens.matchAll(/--fs-2xs\s*:\s*(\d+(?:\.\d+)?)px\s*;/g)].map(m => Number(m[1]))
    expect(fs2xs.length).toBeGreaterThanOrEqual(2)
    expect(fs2xs).toContain(11)
    expect(fs2xs).toContain(12)
    expect(Math.min(...fs2xs)).toBeGreaterThanOrEqual(11)

    // Existing local surface rules stay intact.
    expect(read('src/components/OxeQuery/OxeQuery.css')).toMatch(/font-size\s*:\s*var\(--fs-2xs\)/)
    expect(read('src/components/Threads/ThreadFailureCard.css')).toMatch(/font-size\s*:\s*var\(--fs-2xs\)/)
    expect(read('src/components/Threads/ThreadView.css')).toMatch(/font-size\s*:\s*var\(--fs-2xs\)/)
  })
})
