// Frozen acceptance test for 1.5.2 OxeChat F2 (OXE program oxespace-152-chat, phase F2, Jira OXE-136).
// Written by the planner; the executor must not edit it.
// Defect (e2e of 14/11, run 43559107032): the OxeChat sidebar shows the raw key thread.sections.unknownWorkspace.
// Cause: main's thread:sections handler throws a bare code (`thread.sections.unknownWorkspace`, `thread.sections.invalid`;
// electron/main/ipc/thread-sections.ipc.ts) and the renderer words a section failure only from the thread namespace
// (sectionErrorText, src/components/Threads/sections/useThreadSections.ts:12-20). An unknown code falls through to
// humanizeError, which shows the code itself. The words already exist, in the main catalog only
// (shared/locales/{en,pt-BR}/main.json, thread.sections.*).
// Contract:
// - A `thread.sections.<refusal>` code (each of THREAD_SECTIONS_REFUSALS, shared/types/thread-sections.ts) that reaches
//   the renderer inside an IPC error message is worded in the interface language, en and pt-BR, never as the code.
//   Main's words (the main catalog, e.g. through formatMainMessage(threadSectionsRefusal(refusal).message)) are the
//   expected source; the name refusals may keep the field words of thread:sections.errors.*. No "{{…}}" is left.
// - A section code the renderer has no words for (thread.sections.<other>, thread.section.<other>) shows the generic
//   failure, thread:sections.errors.failed, never the code.
// - BRD-02 (OXE-61, OxeChat sidebar): the text shows in the sidebar's existing danger Notice (src/ui Notice, role alert,
//   data-intent danger, tokens in both themes). No new surface and no new style.
// Runs the real ThreadSidebar, the sections store and the i18n catalogs; only window.oxe.thread is a double.
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ThreadSidebar } from '../../src/components/Threads/ThreadSidebar'
import { resetSectionsForTests } from '../../src/components/Threads/sections/sectionsApi'
import { useThreadStore } from '../../src/store/thread.store'
import { changeLanguage } from '../../src/i18n'
import { THREAD_SECTIONS_REFUSALS } from '../../shared/types/thread-sections'
import type { ConversationThread, ThreadApi } from '../../shared/types/thread'

const thread: ConversationThread = { id: 'a', workspaceId: 'ws', projectId: 'project', rootPath: '/repo', provider: 'claude', title: 'Alpha', pinned: false, status: 'idle', nativeSessionId: null, createdAt: 3, updatedAt: 3 }

const GENERIC = { en: 'Could not update the sections.', 'pt-BR': 'Não foi possível atualizar as seções.' } as const

/** Mounts the sidebar with main's thread:sections read failing the way Electron delivers a thrown code. */
function mount(code: string): void {
  const api = {
    list: vi.fn(async () => [thread]),
    projects: vi.fn(async () => ({ projects: [], unavailable: [] })),
    onChanged: vi.fn(() => () => {}),
    sections: vi.fn(async () => { throw new Error(`Error invoking remote method 'thread:sections': Error: ${code}`) }),
    saveSections: vi.fn(async () => { throw new Error('not used') })
  } as unknown as ThreadApi
  Object.defineProperty(window, 'oxe', { configurable: true, value: { thread: api } })
  useThreadStore.setState({ threads: [thread], projects: [{ projectId: 'project', displayName: 'Repo', identityLabel: '/repo', hidden: false, contexts: [{ rootPath: '/repo', label: 'Repo' }] }], selectedId: null, secondaryId: null, errors: {}, hiddenProjects: [], expanded: {}, unreadIds: [] })
  render(<ThreadSidebar onCreate={vi.fn()} />)
}

/** The sidebar's danger notice once the failed read is worded. */
async function dangerNotice(): Promise<HTMLElement> {
  let notice: HTMLElement | null = null
  await waitFor(() => {
    notice = screen.queryAllByRole('alert').find(element => element.getAttribute('data-intent') === 'danger') ?? null
    expect(notice).not.toBeNull()
  })
  return notice!
}

async function shownFor(code: string, language: 'en' | 'pt-BR'): Promise<HTMLElement> {
  await changeLanguage(language)
  mount(code)
  return dangerNotice()
}

beforeEach(() => { localStorage.clear(); resetSectionsForTests() })
afterEach(async () => { cleanup(); resetSectionsForTests(); await changeLanguage('en') })

describe('OXE-136 · a sections refusal reads as words in the OxeChat sidebar, never as its code', () => {
  it('CA-1 · unknownWorkspace mostra texto', async () => {
    const en = await shownFor('thread.sections.unknownWorkspace', 'en')
    expect(en).toHaveTextContent('This workspace no longer exists.')
    expect(en).not.toHaveTextContent('thread.sections')
    cleanup(); resetSectionsForTests()
    const pt = await shownFor('thread.sections.unknownWorkspace', 'pt-BR')
    expect(pt).toHaveTextContent('Este workspace não existe mais.')
    expect(pt).not.toHaveTextContent('thread.sections')
  })

  it('CA-2 · toda recusa tem texto nos dois idiomas', async () => {
    for (const refusal of THREAD_SECTIONS_REFUSALS) {
      const words: Record<string, string> = {}
      for (const language of ['en', 'pt-BR'] as const) {
        const notice = await shownFor(`thread.sections.${refusal}`, language)
        // The notice's own words, without its Close button.
        const body = notice.cloneNode(true) as HTMLElement
        body.querySelectorAll('button').forEach(button => button.remove())
        const text = (body.textContent ?? '').trim()
        expect(text, `${refusal} (${language})`).not.toBe('')
        expect(text, `${refusal} (${language})`).not.toMatch(/thread\.sections?\./)
        expect(text, `${refusal} (${language})`).not.toContain('{{')
        expect(text, `${refusal} (${language}) has its own words, not the generic failure`).not.toContain(GENERIC[language])
        words[language] = text
        cleanup(); resetSectionsForTests()
      }
      expect(words.en, `${refusal}: the two languages differ`).not.toBe(words['pt-BR'])
    }
  })

  it('CA-3 · sem texto: mensagem genérica', async () => {
    for (const code of ['thread.sections.somethingNew', 'thread.section.somethingNew']) {
      for (const language of ['en', 'pt-BR'] as const) {
        const notice = await shownFor(code, language)
        expect(notice, `${code} (${language})`).toHaveTextContent(GENERIC[language])
        expect(notice, `${code} (${language})`).not.toHaveTextContent(/thread\.sections?\./)
        cleanup(); resetSectionsForTests()
      }
    }
  })
})
