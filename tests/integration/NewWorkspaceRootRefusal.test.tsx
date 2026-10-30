import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, test, vi } from 'vitest'
import enCode from '../../shared/locales/en/code.json'
import enMain from '../../shared/locales/en/main.json'
import ptCode from '../../shared/locales/pt-BR/code.json'
import ptMain from '../../shared/locales/pt-BR/main.json'
import type { ShellProfile, Workspace, WorkspaceCreateRefusal, WorkspaceRootRefusal } from '../../shared/types/workspace'
import { NewWorkspaceModal, type WizardLaunchInput } from '../../src/components/Workspace/NewWorkspaceModal'
import { changeLanguage } from '../../src/i18n'
import { useWorkspaceStore, WorkspaceRootRefusedError } from '../../src/store/workspace.store'

const shellProfiles: ShellProfile[] = [{ id: 'sh-1', name: 'PowerShell', executable: 'pwsh', args: [], isBuiltin: true }]
const MISSING = 'C:\\nao\\existe\\pasta'
const REAL = 'C:\\projetos\\app'

const CATALOGS = {
  en: { main: enMain.messages.workspace.root, code: enCode.newWorkspace },
  'pt-BR': { main: ptMain.messages.workspace.root, code: ptCode.newWorkspace }
} as const

const fill = (template: string, path: string): string => template.replace('{{path}}', path)

function refusalFor(refusal: WorkspaceRootRefusal, path: string): WorkspaceCreateRefusal {
  return { ok: false, refusal, message: { code: `workspace.root.${refusal}`, params: { path } } as WorkspaceCreateRefusal['message'] }
}

function workspaceAt(rootPath: string): Workspace {
  return {
    id: 'ws-1', name: 'app', rootPath, layout: '2x2', layoutPreset: 4, themeId: 'midnight', uiDensity: 'default',
    defaultShellProfileId: 'sh-1', autoStart: true, isActive: true, panes: []
  }
}

/** The wizard wired to the real workspace store, the way App.handleLaunch is: create, then close. */
function renderWired(create: (input: unknown) => Promise<unknown>, pickFolder = vi.fn().mockResolvedValue(null)) {
  Object.defineProperty(window, 'oxe', { configurable: true, value: { workspace: { create: vi.fn(create), pickFolder } } })
  const onClose = vi.fn()
  const onLaunch = vi.fn(async (input: WizardLaunchInput) => {
    await useWorkspaceStore.getState().createWorkspace({ rootPath: input.rootPath, layoutPreset: input.layoutPreset, defaultShellProfileId: input.defaultShellProfileId, autoStart: true, agentBindings: input.agentBindings })
    onClose()
  })
  render(<NewWorkspaceModal agentProfiles={[]} shellProfiles={shellProfiles} onLaunch={onLaunch} onPickFolder={() => window.oxe.workspace.pickFolder()} onClose={onClose} />)
  return { onClose, onLaunch, pickFolder, create: window.oxe.workspace.create as unknown as ReturnType<typeof vi.fn> }
}

afterEach(async () => {
  await changeLanguage('en')
  useWorkspaceStore.setState({ workspaces: [], activeWorkspaceId: null })
})

describe('new-workspace wizard: a folder main refuses', () => {
  const cases: Array<[WorkspaceRootRefusal, string]> = [
    ['notAbsolute', 'nao\\existe'],
    ['notFound', MISSING],
    ['notDirectory', 'C:\\projetos\\notas.txt'],
    ['unreadable', 'C:\\Windows\\System32\\config']
  ]

  for (const language of ['en', 'pt-BR'] as const) {
    for (const [refusal, path] of cases) {
      test(`${refusal} is worded in ${language} next to the folder field and keeps the wizard open`, async () => {
        await changeLanguage(language)
        const user = userEvent.setup()
        const { onClose, create } = renderWired(async () => refusalFor(refusal, path))

        const input = screen.getByTestId('wizard-dir-input')
        await user.type(input, path)
        await user.click(screen.getByTestId('wizard-launch-btn'))

        const box = await screen.findByTestId('wizard-root-refusal')
        expect(box).toHaveAttribute('data-refusal', refusal)
        expect(within(box).getByText(fill(CATALOGS[language].main[refusal], path))).toBeInTheDocument()
        // The not-found case says how to go on, since the app cannot create the folder.
        if (refusal === 'notFound') expect(within(box).getByText(CATALOGS[language].code.rootNotFoundHint)).toBeInTheDocument()
        else expect(within(box).queryByText(CATALOGS[language].code.rootNotFoundHint)).toBeNull()
        expect(within(box).getByTestId('wizard-choose-another')).toHaveTextContent(CATALOGS[language].code.chooseAnother)

        const field = screen.getByTestId('wizard-dir-input')
        expect(field).toHaveValue(path)
        expect(field).toHaveAttribute('aria-invalid', 'true')
        expect(field.getAttribute('aria-describedby')).toBe(within(box).getByRole('alert').id)
        expect(create).toHaveBeenCalledOnce()
        expect(onClose).not.toHaveBeenCalled()
        // No generic failure next to the precise one.
        expect(screen.queryByText(CATALOGS[language].code.failed)).toBeNull()
        expect(screen.getByTestId('wizard-launch-btn')).not.toBeDisabled()
      })
    }
  }

  test('the refusal follows a language change while it is shown', async () => {
    const user = userEvent.setup()
    renderWired(async () => refusalFor('notFound', MISSING))
    await user.type(screen.getByTestId('wizard-dir-input'), MISSING)
    await user.click(screen.getByTestId('wizard-launch-btn'))
    await screen.findByText(fill(enMain.messages.workspace.root.notFound, MISSING))

    await act(() => changeLanguage('pt-BR'))
    expect(screen.getByText(fill(ptMain.messages.workspace.root.notFound, MISSING))).toBeInTheDocument()
    expect(screen.getByText(ptCode.newWorkspace.rootNotFoundHint)).toBeInTheDocument()
  })

  test('"Choose another folder" opens the picker, fills and focuses the field, and clears the refusal', async () => {
    const user = userEvent.setup()
    const pickFolder = vi.fn().mockResolvedValue(REAL)
    renderWired(async () => refusalFor('notFound', MISSING), pickFolder)
    await user.type(screen.getByTestId('wizard-dir-input'), MISSING)
    await user.click(screen.getByTestId('wizard-launch-btn'))
    await user.click(await screen.findByTestId('wizard-choose-another'))

    expect(pickFolder).toHaveBeenCalledOnce()
    const field = screen.getByTestId('wizard-dir-input')
    expect(field).toHaveValue(REAL)
    await waitFor(() => expect(field).toHaveFocus())
    expect(screen.queryByTestId('wizard-root-refusal')).toBeNull()
    expect(field).not.toHaveAttribute('aria-invalid')
  })

  test('a cancelled picker keeps the typed path and its refusal', async () => {
    const user = userEvent.setup()
    renderWired(async () => refusalFor('notFound', MISSING))
    await user.type(screen.getByTestId('wizard-dir-input'), MISSING)
    await user.click(screen.getByTestId('wizard-launch-btn'))
    await user.click(await screen.findByTestId('wizard-choose-another'))

    expect(screen.getByTestId('wizard-dir-input')).toHaveValue(MISSING)
    expect(screen.getByTestId('wizard-root-refusal')).toBeInTheDocument()
  })

  test('editing the path hides the refusal for the old one', async () => {
    const user = userEvent.setup()
    renderWired(async () => refusalFor('notFound', MISSING))
    await user.type(screen.getByTestId('wizard-dir-input'), MISSING)
    await user.click(screen.getByTestId('wizard-launch-btn'))
    await screen.findByTestId('wizard-root-refusal')

    await user.type(screen.getByTestId('wizard-dir-input'), 'x')
    expect(screen.queryByTestId('wizard-root-refusal')).toBeNull()
  })

  test('after a refusal, a folder main accepts creates the workspace and closes the wizard', async () => {
    const user = userEvent.setup()
    const { onClose, create } = renderWired(async (input) => (input as { rootPath: string }).rootPath === REAL ? workspaceAt(REAL) : refusalFor('notFound', MISSING))
    await user.type(screen.getByTestId('wizard-dir-input'), MISSING)
    await user.click(screen.getByTestId('wizard-launch-btn'))
    await screen.findByTestId('wizard-root-refusal')
    expect(useWorkspaceStore.getState().workspaces).toEqual([])

    await user.clear(screen.getByTestId('wizard-dir-input'))
    await user.type(screen.getByTestId('wizard-dir-input'), REAL)
    await user.click(screen.getByTestId('wizard-launch-btn'))

    await waitFor(() => expect(onClose).toHaveBeenCalledOnce())
    expect(create).toHaveBeenCalledTimes(2)
    expect(useWorkspaceStore.getState().workspaces.map((workspace) => workspace.rootPath)).toEqual([REAL])
  })

  test('the store throws a WorkspaceRootRefusedError worded in the interface language', async () => {
    await changeLanguage('pt-BR')
    Object.defineProperty(window, 'oxe', { configurable: true, value: { workspace: { create: vi.fn().mockResolvedValue(refusalFor('notDirectory', REAL)) } } })
    const error = await useWorkspaceStore.getState().createWorkspace({ rootPath: REAL }).catch((caught: unknown) => caught)
    expect(error).toBeInstanceOf(WorkspaceRootRefusedError)
    expect((error as WorkspaceRootRefusedError).refusal.refusal).toBe('notDirectory')
    expect((error as Error).message).toBe(fill(ptMain.messages.workspace.root.notDirectory, REAL))
    expect(useWorkspaceStore.getState().workspaces).toEqual([])
  })

  test('any other failure still shows the generic error', async () => {
    const user = userEvent.setup()
    renderWired(async () => { throw new Error('disk on fire') })
    await user.type(screen.getByTestId('wizard-dir-input'), REAL)
    await user.click(screen.getByTestId('wizard-launch-btn'))
    expect(await screen.findByText(enCode.newWorkspace.failed)).toBeInTheDocument()
    expect(screen.queryByTestId('wizard-root-refusal')).toBeNull()
  })
})
