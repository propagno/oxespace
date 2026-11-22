// Frozen acceptance test for 1.5.2 HML fixes, pass 2 (Jira OXE-354; 152hml2). Written by the planner; the executor must
// not edit it. HML round 2 (f65fa5374) found three keyboard conflicts:
// - src/components/Review/ReviewPane.tsx: j/k/r ignore Ctrl/Cmd/Alt, so Ctrl+K, Ctrl+J and Ctrl+R are swallowed (with
//   preventDefault) to move between files or mark one reviewed.
// - src/keyboard/keybindings.ts blocked(): only Settings and Workspace settings stop the shortcuts, so Ctrl+1..3, Ctrl+K,
//   Ctrl+B fire under any other open modal (SchedulesDialog, UsageModal, ApprovalDialog, McpPanel…); F2 and Mod+R fire
//   from a text field or an editor.
// - src/components/Threads/ThreadPromptNavigator.tsx: Alt+ArrowUp/Down move the conversation even with the focus in the
//   Monaco editor or a terminal inside .thread-workbench.
// Contract:
// - ReviewPane leaves a key with Ctrl, Cmd or Alt alone (not prevented, no navigation).
// - dispatchKeybinding does not run a binding that is not `fixed` while a modal dialog is open in the document
//   ([role="dialog"][aria-modal="true"] or [role="alertdialog"]); the fixed ways out (F6) still run.
// - code.splitLayout (F2) and terminal.restart (Mod+R) do not run from a text field or an editor (inTextField).
// - ThreadPromptNavigator exports ownsPromptKeys(active: Element | null): boolean, true when the focus is in the
//   conversation's .thread-workbench and false inside .xterm, .monaco-editor, .cm-editor or .thread-review-host; the
//   Alt+ArrowUp/Down handler moves between prompts only when it is true.
import { cleanup, render, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { dispatchKeybinding, setKeyboardView, useKeybindings } from '../../../src/keyboard/keybindings'

const key = (init: KeyboardEventInit & { key: string }, target: EventTarget = document.body): KeyboardEvent => {
  const event = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init })
  Object.defineProperty(event, 'target', { value: target })
  return event
}

afterEach(() => { cleanup(); document.body.innerHTML = '' })

describe('OXE-354 · shortcuts that do not steal keys', () => {
  test('ReviewPane leaves Ctrl+K, Ctrl+J and Ctrl+R alone', async () => {
    Object.assign(window, { oxe: { ...(window as unknown as { oxe?: object }).oxe, git: { getDiff: vi.fn(async () => ({ files: [] })), onDiffUpdate: vi.fn(() => () => undefined), getBranch: vi.fn(async () => ({ branch: 'main', detached: false, shortSha: null })) }, github: { listBranches: vi.fn(async () => []), resolveWorktreeBase: vi.fn(async () => null) } } })
    const { ReviewPane } = await import('../../../src/components/Review/ReviewPane')
    render(<ReviewPane workspaceId="ws-1" rootPath="C:/repo" />)
    for (const letter of ['k', 'j', 'r']) {
      const event = new KeyboardEvent('keydown', { key: letter, ctrlKey: true, bubbles: true, cancelable: true })
      window.dispatchEvent(event)
      expect(event.defaultPrevented, `Ctrl+${letter.toUpperCase()}`).toBe(false)
    }
  })

  test('a shortcut that is not fixed does not run while a modal dialog is open; F6 still does', () => {
    setKeyboardView('code')
    const view = vi.fn(() => true)
    const region = vi.fn(() => true)
    const hook = renderHook(() => useKeybindings({ 'view.thread': view, 'focus.nextRegion': region } as never))
    const dialog = document.createElement('div')
    dialog.setAttribute('role', 'dialog')
    dialog.setAttribute('aria-modal', 'true')
    document.body.appendChild(dialog)
    dispatchKeybinding(key({ key: '2', ctrlKey: true }))
    expect(view).not.toHaveBeenCalled()
    dispatchKeybinding(key({ key: 'F6' }))
    expect(region).toHaveBeenCalledTimes(1)
    dialog.remove()
    dispatchKeybinding(key({ key: '2', ctrlKey: true }))
    expect(view).toHaveBeenCalledTimes(1)
    hook.unmount()
  })

  test('F2 and Mod+R do not run from a text field or an editor', () => {
    setKeyboardView('code')
    const split = vi.fn(() => true)
    const restart = vi.fn(() => true)
    const hook = renderHook(() => useKeybindings({ 'code.splitLayout': split, 'terminal.restart': restart } as never))
    const input = document.createElement('input')
    const editor = document.createElement('div')
    editor.className = 'monaco-editor'
    const inner = document.createElement('textarea')
    editor.appendChild(inner)
    document.body.append(input, editor)
    dispatchKeybinding(key({ key: 'F2' }, input))
    dispatchKeybinding(key({ key: 'r', ctrlKey: true }, inner))
    expect(split).not.toHaveBeenCalled()
    expect(restart).not.toHaveBeenCalled()
    dispatchKeybinding(key({ key: 'F2' }, document.body))
    expect(split).toHaveBeenCalledTimes(1)
    hook.unmount()
  })

  test('the prompt navigator owns Alt+Up/Down only outside an editor or a terminal', async () => {
    const navigator = await import('../../../src/components/Threads/ThreadPromptNavigator') as unknown as { ownsPromptKeys?: (active: Element | null) => boolean }
    expect(typeof navigator.ownsPromptKeys).toBe('function')
    const workbench = document.createElement('div')
    workbench.className = 'thread-workbench'
    const plain = document.createElement('button')
    workbench.appendChild(plain)
    const owners = ['xterm', 'monaco-editor', 'cm-editor', 'thread-review-host'].map(name => {
      const host = document.createElement('div')
      host.className = name
      const inner = document.createElement('textarea')
      host.appendChild(inner)
      workbench.appendChild(host)
      return inner
    })
    document.body.appendChild(workbench)
    expect(navigator.ownsPromptKeys!(plain)).toBe(true)
    for (const inner of owners) expect(navigator.ownsPromptKeys!(inner), inner.parentElement!.className).toBe(false)
    expect(navigator.ownsPromptKeys!(document.body)).toBe(false)
  })
})
