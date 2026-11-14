import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * The eight workspace swatches are named from the Mandacaru vocabulary, by what each slot paints in Mandacaru Noite
 * (docs/design/brand.md). Slots 1, 2 and 6 left caatinga, sun and warning for teal, indigo and plum in 1.5.2 (OXE-49),
 * so their names moved with them. The names are proper nouns: the same in English and Portuguese.
 */
const NAMES = {
  1: 'Velho Chico', // teal: the São Francisco river
  2: 'Anil', // indigo
  3: 'Açude', // blue
  4: 'Juazeiro', // olive
  5: 'Xique-xique', // violet
  6: 'Coroa-de-frade', // plum: the cactus with the magenta crown
  7: 'Fim de tarde', // rose
  8: 'Pedra' // neutral
} as const

const swatches = (locale: string): Record<string, string> =>
  (JSON.parse(readFileSync(join(__dirname, '..', 'shared', 'locales', locale, 'common.json'), 'utf8')) as { workspaceColor: { swatch: Record<string, string> } }).workspaceColor.swatch

describe('workspace color names', () => {
  it.each(['en', 'pt-BR'])('%s names each slot after the color it paints', locale => {
    expect(swatches(locale)).toEqual(Object.fromEntries(Object.entries(NAMES)))
  })

  it('no slot keeps a name that now belongs to a role (accent, "needs you", risk)', () => {
    for (const locale of ['en', 'pt-BR']) for (const old of ['Caatinga', 'Sertão', 'Barro']) expect(Object.values(swatches(locale))).not.toContain(old)
  })
})
