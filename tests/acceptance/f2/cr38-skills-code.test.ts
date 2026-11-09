// Frozen acceptance test for CR-38 (OXE program, phase F2, criterion A48): DESIGN's CR-F2-3 (V3) on #727. In the R12 skills
// list, the paths ~/.oxe/skills and .oxe/skills and the command character / read as code (mono), as everywhere else; the
// words stay CR-36's. Written by the planner; the executor must not edit it.
// It renders the real SkillsList (src/components/Settings/SkillsList.tsx) over the real skill store and reads the DOM a
// person sees; no catalog text is read from source.
import { act, cleanup, render, screen } from '@testing-library/react'
import { createElement } from 'react'
import { afterEach, describe, expect, test } from 'vitest'
import { changeLanguage } from '../../../src/i18n'

async function renderEmptyList(): Promise<HTMLElement> {
  Object.assign(window, { oxe: { ...(window as unknown as { oxe?: object }).oxe, skill: { list: async () => [] } } })
  const { useSkillStore } = await import('../../../src/store/skill.store')
  act(() => useSkillStore.setState({ skills: [], loaded: true, loading: false, error: null } as never))
  const { SkillsList } = await import('../../../src/components/Settings/SkillsList')
  render(createElement(SkillsList))
  return screen.getByRole('region', { name: 'Skills' })
}
const codesIn = (element: Element): string[] => [...element.querySelectorAll('code')].map(code => code.textContent ?? '')
const blockWith = (text: string): HTMLElement => screen.getByText((_content, element) => element !== null && element.tagName !== 'CODE' && (element.textContent ?? '').replace(/\s+/g, ' ').trim() === text && [...element.children].every(child => (child.textContent ?? '').replace(/\s+/g, ' ').trim() !== text))

afterEach(async () => { cleanup(); await changeLanguage('en') })

describe('CR-38 · paths and the command character read as code (CR-F2-3)', () => {
  test.each([
    ['en', "Markdown prompts in ~/.oxe/skills and the project's .oxe/skills. The project's wins on a shared name. Run one with /."],
    ['pt-BR', 'Prompts Markdown de ~/.oxe/skills e do .oxe/skills do projeto, que vence se o nome se repete. Rode com /.']
  ])('the intro keeps its words and shows ~/.oxe/skills, .oxe/skills and / as code (%s)', async (language, intro) => {
    await changeLanguage(language)
    await renderEmptyList()
    const line = blockWith(intro)
    expect(codesIn(line)).toEqual(['~/.oxe/skills', '.oxe/skills', '/'])
  }, 30_000)

  test.each([
    ['en', 'Add a Markdown file to .oxe/skills in the project.'],
    ['pt-BR', 'Adicione um arquivo Markdown em .oxe/skills no projeto.']
  ])('the empty body keeps its words and shows .oxe/skills as code (%s)', async (language, body) => {
    await changeLanguage(language)
    await renderEmptyList()
    const line = blockWith(body)
    expect(codesIn(line)).toEqual(['.oxe/skills'])
  }, 30_000)
})
