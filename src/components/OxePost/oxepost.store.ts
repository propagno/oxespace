import { create } from 'zustand'
import { emptyRequest, serializeRequest } from '../../../shared/oxepost/format'
import { i18n } from '../../i18n'
import type { PostEnvironmentView, PostRequest, PostRequestEntry, PostResponse } from '../../../shared/oxepost/types'
import { PostError, messageOf, post } from './client'
import { registerUnsavedSource } from '../../lib/unsavedWork'
import { toast } from '../../ui/Toast'

export type PostDialog = 'import' | 'environments' | null
export interface SendFailure { code: string; message: string }

interface PostState {
  workspaceId: string | null
  loading: boolean
  /** Why the collection could not be read. */
  error: string | null
  entries: PostRequestEntry[]
  environments: PostEnvironmentView[]
  /** Set when the system has no secure storage for secrets (Linux without a keyring). */
  secretsProblem: string | null
  /** The saved request being edited; null for a request that is not saved yet. */
  selected: string | null
  draft: PostRequest
  /** The draft as last saved or opened, to tell whether it changed. */
  baseline: string
  environment: string
  response: PostResponse | null
  failure: SendFailure | null
  sending: boolean
  filter: string
  dialog: PostDialog
  /** A request the person asked to open while the current one has unsaved changes. */
  pendingOpen: string | null | undefined
  /** A send to production waiting for the person's confirmation. */
  confirmSend: boolean
  load(workspaceId: string | null): Promise<void>
  open(path: string | null, force?: boolean): Promise<void>
  cancelOpen(): void
  /** Clears the editor to an unsaved blank request (after a delete). */
  newRequest(): void
  /**
   * "New request": saves a blank request as a file of the workspace (the folder is made if missing), lists it and
   * opens it with its name selected. A failure is always shown, never silent.
   */
  create(): Promise<string | null>
  edit(patch: Partial<PostRequest>): void
  save(): Promise<string | null>
  remove(): Promise<void>
  send(confirmed?: boolean): Promise<void>
  setEnvironment(id: string): void
  setFilter(filter: string): void
  show(dialog: PostDialog): void
  setConfirmSend(value: boolean): void
  applyEnvironments(environments: PostEnvironmentView[]): void
}

let loadToken = 0
let sendToken = 0
const snapshot = (request: PostRequest): string => serializeRequest(request)
/** Puts the cursor in the editor's name field with the name selected, so a new request is named by typing. */
function focusName(): void {
  if (typeof document === 'undefined') return
  window.requestAnimationFrame(() => {
    const field = document.querySelector<HTMLInputElement>('[data-post-name]')
    field?.focus()
    field?.select()
  })
}
/**
 * A blank request named in the language on screen. The name lives in the common catalog, not OxePost's own: the store
 * is created when this module loads, which can be before OxePost's catalog has been fetched.
 */
const blankRequest = (): PostRequest => emptyRequest(i18n.t('postCommands.defaultName'))

export const useOxePostStore = create<PostState>((set, get) => ({
  workspaceId: null, loading: false, error: null, entries: [], environments: [], secretsProblem: null, selected: null,
  draft: blankRequest(), baseline: snapshot(blankRequest()), environment: '', response: null, failure: null, sending: false, filter: '', dialog: null, pendingOpen: undefined, confirmSend: false,

  load: async workspaceId => {
    const token = ++loadToken
    if (workspaceId !== get().workspaceId) set({ workspaceId, entries: [], environments: [], selected: null, draft: blankRequest(), baseline: snapshot(blankRequest()), response: null, failure: null, environment: '' })
    if (!workspaceId) { set({ loading: false, error: null }); return }
    set({ loading: true })
    try {
      const result = await post('list', { workspaceId })
      if (token !== loadToken) return
      const environment = result.environments.some(item => item.id === get().environment) ? get().environment : ''
      const selected = get().selected && result.requests.some(item => item.path === get().selected) ? get().selected : null
      set({ entries: result.requests, environments: result.environments, secretsProblem: result.secretsProblem, error: null, loading: false, environment, selected })
    } catch (error) {
      if (token === loadToken) set({ error: messageOf(error), loading: false })
    }
  },

  open: async (path, force = false) => {
    const state = get()
    if (!force && snapshot(state.draft) !== state.baseline) { set({ pendingOpen: path }); return }
    set({ pendingOpen: undefined })
    if (path === null) { await get().create(); return }
    try {
      const request = await post('read', { workspaceId: state.workspaceId, path })
      set({ selected: path, draft: request, baseline: snapshot(request), response: null, failure: null })
    } catch (error) {
      set({ failure: { code: error instanceof PostError ? error.code : 'failed', message: messageOf(error) } })
    }
  },

  cancelOpen: () => set({ pendingOpen: undefined }),

  newRequest: () => set({ selected: null, draft: blankRequest(), baseline: snapshot(blankRequest()), response: null, failure: null, pendingOpen: undefined }),

  create: async () => {
    const { workspaceId } = get()
    const failed = (message: string): null => {
      toast({ title: i18n.t('postCommands.createFailed', { ns: 'common' }), description: message, intent: 'danger' })
      return null
    }
    if (!workspaceId) return failed(i18n.t('postCommands.noProject', { ns: 'common' }))
    const draft = blankRequest()
    try {
      const { path } = await post('save', { workspaceId, path: null, request: draft, folder: '' })
      if (get().workspaceId !== workspaceId) return path
      set({ selected: path, draft, baseline: snapshot(draft), response: null, failure: null, pendingOpen: undefined })
      await get().load(workspaceId)
      focusName()
      return path
    } catch (error) {
      return failed(messageOf(error))
    }
  },

  edit: patch => set(state => ({ draft: { ...state.draft, ...patch } })),

  save: async () => {
    const { workspaceId, selected, draft } = get()
    if (!workspaceId) return null
    try {
      let path = selected
      const entry = get().entries.find(item => item.path === selected)
      if (path && entry && entry.name !== draft.name.trim()) {
        // The file's name follows the request's name.
        await post('save', { workspaceId, path, request: draft })
        path = (await post('rename', { workspaceId, path, name: draft.name })).path
      } else {
        path = (await post('save', { workspaceId, path, request: draft, folder: '' })).path
      }
      set({ selected: path, baseline: snapshot(draft), failure: null })
      await get().load(workspaceId)
      return path
    } catch (error) {
      set({ failure: { code: error instanceof PostError ? error.code : 'failed', message: messageOf(error) } })
      return null
    }
  },

  remove: async () => {
    const { workspaceId, selected } = get()
    if (!workspaceId || !selected) return
    try {
      await post('delete', { workspaceId, path: selected })
      get().newRequest()
      await get().load(workspaceId)
    } catch (error) {
      set({ failure: { code: 'failed', message: messageOf(error) } })
    }
  },

  send: async (confirmed = false) => {
    const { workspaceId, draft, environment, environments } = get()
    if (!workspaceId) return
    const production = environments.find(item => item.id === environment)?.production === true
    if (production && !confirmed) { set({ confirmSend: true }); return }
    const token = ++sendToken
    set({ sending: true, failure: null, confirmSend: false })
    try {
      const response = await post('send', { workspaceId, request: draft, environment: environment || undefined, confirmed })
      if (token === sendToken) set({ response, sending: false })
    } catch (error) {
      if (token === sendToken) set({ sending: false, response: null, failure: { code: error instanceof PostError ? error.code : 'failed', message: messageOf(error) } })
    }
  },

  setEnvironment: id => set({ environment: id }),
  setFilter: filter => set({ filter }),
  show: dialog => set({ dialog }),
  setConfirmSend: value => set({ confirmSend: value }),
  applyEnvironments: environments => set(state => ({ environments, environment: environments.some(item => item.id === state.environment) ? state.environment : '' }))
}))

export const isDirty = (state: Pick<PostState, 'draft' | 'baseline'>): boolean => snapshot(state.draft) !== state.baseline

// The request being edited, when it changed since it was opened or saved: the close guard lists it and can save it.
registerUnsavedSource({
  id: 'oxepost',
  items: () => {
    const state = useOxePostStore.getState()
    if (!state.workspaceId || snapshot(state.draft) === state.baseline) return []
    return [{ id: state.selected ?? 'new', label: state.draft.name.trim() || i18n.t('closeGuard.untitledRequest', { ns: 'common' }), detail: i18n.t('closeGuard.inOxePost', { ns: 'common' }) }]
  },
  saveAll: async () => { await useOxePostStore.getState().save() }
})
