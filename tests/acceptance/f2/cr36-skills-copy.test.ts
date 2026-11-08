// Frozen acceptance test for CR-36 (OXE program, phase F2, task T5, criterion A69): DESIGN's CR-F2-1 and CR-F2-2 on #727,
// the R12 skills list copy. Written by the planner; the executor must not edit it.
// It renders the real SkillsList (src/components/Settings/SkillsList.tsx) over the real skill store and reads what a
// person sees: the intro is DESIGN's ≤ 20-word line, and the empty state has its title, one body line and no button
// (the list is read only). No catalog text is read from source.
import { act, cleanup, render, screen } from '@testing-library/react'
import { createElement } from 'react'
import { afterEach, describe, expect, test } from 'vitest'
import { changeLanguage } from '../../../src/i18n'

const words = (text: string): number => text.trim().split(/\s+/).filter(Boolean).length

async function renderEmptyList(): Promise<void> {
  Object.assign(window, { oxe: { ...(window as unknown as { oxe?: object }).oxe, skill: { list: async () => [] } } })
  const { useSkillStore } = await import('../../../src/store/skill.store')
  act(() => useSkillStore.setState({ skills: [], loaded: true, loading: false, error: null } as never))
  const { SkillsList } = await import('../../../src/components/Settings/SkillsList')
  render(createElement(SkillsList))
}

afterEach(async () => { cleanup(); await changeLanguage('en') })

describe('CR-36 · the skills list copy (CR-F2-1, CR-F2-2)', () => {
  test.each([
    ['en', "Markdown prompts in ~/.oxe/skills and the project's .oxe/skills. The project's wins on a shared name. Run one with /."],
    ['pt-BR', 'Prompts Markdown de ~/.oxe/skills e do .oxe/skills do projeto, que vence se o nome se repete. Rode com /.']
  ])('the intro is DESIGN\'s line of 20 words or fewer (%s)', async (language, intro) => {
    await changeLanguage(language)
    await renderEmptyList()
    const shown = screen.getByText(intro)
    expect(words(shown.textContent ?? '')).toBeLessThanOrEqual(20)
  }, 30_000)

  test.each([
    ['en', 'No skills yet', 'Add a Markdown file to .oxe/skills in the project.'],
    ['pt-BR', 'Nenhuma skill ainda', 'Adicione um arquivo Markdown em .oxe/skills no projeto.']
  ])('the empty list has its title, one line on what to do, and no button (%s)', async (language, title, body) => {
    await changeLanguage(language)
    await renderEmptyList()
    expect(screen.getByText(title)).toBeInTheDocument()
    expect(screen.getByText(body)).toBeInTheDocument()
    expect(screen.queryAllByRole('button')).toEqual([])
  }, 30_000)
})
