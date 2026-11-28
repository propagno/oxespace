import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ThreadMarkdown, ThreadCodeBlockActionsContext } from '../../src/components/Threads/ThreadMarkdown'
import {
  classifyDiffLine,
  openCodeBlockInEditor,
  prepareShellSnippet
} from '../../src/components/Threads/threadCodeBlockActions'
import { selectActiveFile, useEditorStore } from '../../src/store/editor.store'
import { useThreadWorkbenchStore } from '../../src/store/thread-workbench.store'

const ROOT = join(__dirname, '..', '..')
const readCss = (rel: string): string => readFileSync(join(ROOT, rel), 'utf8').replace(/\r\n/g, '\n')

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  useEditorStore.setState({ files: {}, tabs: {}, activePath: {}, reveal: {} })
  useThreadWorkbenchStore.setState({ views: {}, maximizedId: null })
})

describe('OXE-476 · OxeChat contextual code block actions & diff highlight', () => {
  describe('Run in Terminal', () => {
    it.each(['bash', 'sh', 'shell', 'zsh', 'fish', 'pwsh', 'powershell', 'cmd', 'bat', 'console'])(
      'shows Run in Terminal on %s code blocks and invokes handler with prepared command',
      async lang => {
        const onRunInTerminal = vi.fn()
        render(
          <ThreadCodeBlockActionsContext.Provider value={{ onRunInTerminal }}>
            <ThreadMarkdown text={`\`\`\`${lang}\necho hello\n\`\`\``} />
          </ThreadCodeBlockActionsContext.Provider>
        )
        const runBtn = screen.getByRole('button', { name: 'Run in terminal' })
        fireEvent.click(runBtn)
        expect(onRunInTerminal).toHaveBeenCalledTimes(1)
        expect(onRunInTerminal).toHaveBeenCalledWith({
          code: 'echo hello',
          command: 'echo hello',
          language: lang
        })
        await screen.findByText('Sent')
      }
    )

    it.each(['ts', 'json', 'python', 'diff', 'css', ''])(
      'does NOT show Run in Terminal on non-shell block (%s)',
      lang => {
        const onRunInTerminal = vi.fn()
        render(
          <ThreadCodeBlockActionsContext.Provider value={{ onRunInTerminal }}>
            <ThreadMarkdown text={`\`\`\`${lang}\nconst x = 1\n\`\`\``} />
          </ThreadCodeBlockActionsContext.Provider>
        )
        expect(screen.queryByRole('button', { name: 'Run in terminal' })).toBeNull()
      }
    )

    it('degrades gracefully without ThreadCodeBlockActionsContext', () => {
      render(<ThreadMarkdown text={'```bash\nnpm test\n```'} />)
      expect(screen.queryByRole('button', { name: 'Run in terminal' })).toBeNull()
      expect(screen.queryByRole('button', { name: 'Open in editor' })).toBeNull()
      expect(screen.getByRole('button', { name: 'Toggle line wrap' })).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Copy code' })).toBeInTheDocument()
    })

    it('strips leading prompt prefixes when clearly prompt-prefixed and preserves multi-line scripts verbatim', () => {
      expect(prepareShellSnippet('$ npm test', 'bash')).toBe('npm test')
      expect(prepareShellSnippet('$ git status\n$ git diff', 'console')).toBe('git status\ngit diff')
      expect(prepareShellSnippet('# Run checks\n$ npm run lint\n$ npm test', 'sh')).toBe('# Run checks\nnpm run lint\nnpm test')
      expect(prepareShellSnippet('PS C:\\repo> npx vitest run', 'pwsh')).toBe('npx vitest run')
      expect(prepareShellSnippet('$HOME/bin/run --flag', 'sh')).toBe('$HOME/bin/run --flag')
      const script = 'set -e\nfor f in *.ts; do\n  echo "$f"\ndone'
      expect(prepareShellSnippet(script, 'bash')).toBe(script)
    })

    it('passes stripped command to onRunInTerminal while keeping raw code intact', async () => {
      const onRunInTerminal = vi.fn()
      render(
        <ThreadCodeBlockActionsContext.Provider value={{ onRunInTerminal }}>
          <ThreadMarkdown text={'```console\n$ npm run build\n$ npm test\n```'} />
        </ThreadCodeBlockActionsContext.Provider>
      )
      fireEvent.click(screen.getByRole('button', { name: 'Run in terminal' }))
      expect(onRunInTerminal).toHaveBeenCalledWith({
        code: '$ npm run build\n$ npm test',
        command: 'npm run build\nnpm test',
        language: 'console'
      })
      await screen.findByText('Sent')
    })
  })

  describe('Wrap toggle', () => {
    it('toggles data-wrapped and aria-pressed locally per code block', () => {
      const { container } = render(
        <ThreadMarkdown text={'```ts\nconst longLine = "a".repeat(200)\n```\n\n```json\n{"key": "value"}\n```'} />
      )
      const blocks = [...container.querySelectorAll<HTMLElement>('.thread-code-block')]
      const wrapButtons = screen.getAllByRole('button', { name: 'Toggle line wrap' })
      expect(blocks).toHaveLength(2)
      expect(blocks[0]).toHaveAttribute('data-wrapped', 'false')
      expect(blocks[1]).toHaveAttribute('data-wrapped', 'false')
      expect(wrapButtons[0]).toHaveAttribute('aria-pressed', 'false')

      fireEvent.click(wrapButtons[0])
      expect(blocks[0]).toHaveAttribute('data-wrapped', 'true')
      expect(wrapButtons[0]).toHaveAttribute('aria-pressed', 'true')
      expect(blocks[1]).toHaveAttribute('data-wrapped', 'false')
      expect(wrapButtons[1]).toHaveAttribute('aria-pressed', 'false')

      fireEvent.click(wrapButtons[0])
      expect(blocks[0]).toHaveAttribute('data-wrapped', 'false')
      expect(wrapButtons[0]).toHaveAttribute('aria-pressed', 'false')
    })
  })

  describe('Open in Editor', () => {
    it('appears when handler is provided and invokes it with language, code, and optional filename', () => {
      const onOpenInEditor = vi.fn()
      render(
        <ThreadCodeBlockActionsContext.Provider value={{ onOpenInEditor }}>
          <ThreadMarkdown text={'```ts title="src/utils/calc.ts"\nexport const add = (a: number, b: number) => a + b\n```'} />
        </ThreadCodeBlockActionsContext.Provider>
      )
      expect(screen.getByTestId('thread-code-filename')).toHaveTextContent('src/utils/calc.ts')
      const openBtn = screen.getByRole('button', { name: 'Open in editor' })
      fireEvent.click(openBtn)
      expect(onOpenInEditor).toHaveBeenCalledTimes(1)
      expect(onOpenInEditor).toHaveBeenCalledWith({
        code: 'export const add = (a: number, b: number) => a + b',
        language: 'ts',
        languageName: 'TypeScript',
        filename: 'src/utils/calc.ts'
      })
    })

    it('opens a virtual scratch buffer in useEditorStore and reveals the files panel', async () => {
      const readFile = vi.fn().mockRejectedValue(new Error('ENOENT'))
      Object.assign(window, {
        oxe: {
          fs: {
            readFile,
            watchFile: vi.fn(),
            unwatchFile: vi.fn()
          }
        }
      })

      await openCodeBlockInEditor({
        threadId: 'thread-1',
        workspaceId: 'ws-1',
        rootPath: 'C:/repo',
        code: 'def greet():\n    return "hi"',
        language: 'python',
        filename: null
      })

      const file = selectActiveFile(useEditorStore.getState(), 'ws-1')
      expect(file).toMatchObject({
        relativePath: 'snippet-1.py',
        content: 'def greet():\n    return "hi"',
        language: 'python',
        virtual: true,
        isLoading: false
      })
      expect(useThreadWorkbenchStore.getState().views['thread-1']?.panel).toBe('files')

      // Opening the same snippet again reuses the existing virtual tab rather than creating duplicates.
      await openCodeBlockInEditor({
        threadId: 'thread-1',
        workspaceId: 'ws-1',
        rootPath: 'C:/repo',
        code: 'def greet():\n    return "hi"',
        language: 'python',
        filename: null
      })
      expect(useEditorStore.getState().tabs['ws-1']).toHaveLength(1)

      // Re-activating the virtual tab via openFile must never trigger fs.readFile.
      readFile.mockClear()
      await useEditorStore.getState().openFile({
        workspaceId: 'ws-1',
        rootPath: 'C:/repo',
        relativePath: 'snippet-1.py'
      })
      expect(readFile).not.toHaveBeenCalled()
      expect(selectActiveFile(useEditorStore.getState(), 'ws-1')?.content).toBe('def greet():\n    return "hi"')
    })

    it('opens the real project file when an annotated filename exists on disk', async () => {
      const listTree = vi.fn().mockResolvedValue([
        { name: 'app.ts', relativePath: 'src/app.ts', type: 'file', size: 23 }
      ])
      const readFile = vi.fn().mockResolvedValue({
        relativePath: 'src/app.ts',
        content: 'export const app = true',
        size: 23,
        mtimeMs: 1
      })
      const watchFile = vi.fn().mockResolvedValue({ watchId: 'w-1' })
      Object.assign(window, {
        oxe: {
          fs: {
            listTree,
            readFile,
            watchFile,
            unwatchFile: vi.fn()
          }
        }
      })

      await openCodeBlockInEditor({
        threadId: 'thread-2',
        workspaceId: 'ws-2',
        rootPath: 'C:/repo',
        code: '// snippet',
        language: 'ts',
        filename: 'src/app.ts'
      })

      await waitFor(() => expect(selectActiveFile(useEditorStore.getState(), 'ws-2')?.content).toBe('export const app = true'))
      expect(selectActiveFile(useEditorStore.getState(), 'ws-2')?.virtual).toBeUndefined()
      expect(useThreadWorkbenchStore.getState().views['thread-2']?.panel).toBe('files')
    })

    it('excludes virtual snippet tabs from persisted editor storage', () => {
      window.localStorage.removeItem('oxe-editor-tabs-v1')
      useEditorStore.getState().openVirtualFile({
        workspaceId: 'ws-3',
        rootPath: 'C:/repo',
        relativePath: 'snippet-1.ts',
        content: 'const a = 1',
        language: 'typescript'
      })
      const persisted = JSON.parse(window.localStorage.getItem('oxe-editor-tabs-v1') ?? '{}') as {
        state?: { tabs?: Record<string, Array<{ relativePath: string }>>; activePath?: Record<string, string | null> }
      }
      expect(persisted.state?.tabs?.['ws-3']).toEqual([])
      expect(persisted.state?.activePath?.['ws-3']).toBeNull()
    })
  })

  describe('Subtle diff line highlighting', () => {
    const sampleDiff = [
      'diff --git a/src/app.ts b/src/app.ts',
      '--- a/src/app.ts',
      '+++ b/src/app.ts',
      '@@ -1,3 +1,3 @@ function boot()',
      ' const keep = true',
      '-const oldVal = 1',
      '+const newVal = 2'
    ].join('\n')

    it('classifies added, removed, hunk, meta, and context lines accurately', () => {
      expect(classifyDiffLine('diff --git a/x b/x')).toBe('meta')
      expect(classifyDiffLine('--- a/x')).toBe('meta')
      expect(classifyDiffLine('+++ b/x')).toBe('meta')
      expect(classifyDiffLine('@@ -1,2 +1,2 @@')).toBe('hunk')
      expect(classifyDiffLine('+added')).toBe('added')
      expect(classifyDiffLine('-removed')).toBe('removed')
      expect(classifyDiffLine(' context')).toBe('context')
    })

    it.each(['diff', 'patch'])(
      'renders semantic per-line classes for %s blocks without breaking copy text',
      async lang => {
        const writeText = vi.fn(async () => {})
        Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } })

        const { container } = render(<ThreadMarkdown text={`\`\`\`${lang}\n${sampleDiff}\n\`\`\``} />)
        const block = container.querySelector<HTMLElement>('.thread-code-block')!
        expect(block).toHaveAttribute('data-diff', 'true')

        const lines = [...container.querySelectorAll<HTMLElement>('.thread-diff-code-line')]
        expect(lines.map(el => el.getAttribute('data-diff-line'))).toEqual([
          'meta',
          'meta',
          'meta',
          'hunk',
          'context',
          'removed',
          'added'
        ])
        expect(lines[3]).toHaveClass('is-hunk')
        expect(lines[5]).toHaveClass('is-removed')
        expect(lines[6]).toHaveClass('is-added')
        expect(lines[1]).not.toHaveClass('is-removed')
        expect(lines[2]).not.toHaveClass('is-added')

        // Copy must return the exact diff text character-for-character.
        fireEvent.click(screen.getByRole('button', { name: 'Copy code' }))
        await screen.findByText('Copied')
        expect(writeText).toHaveBeenCalledWith(sampleDiff)
        expect(container.querySelector('code')?.textContent?.replace(/\n$/, '')).toBe(sampleDiff)
      }
    )

    it('uses semantic CSS tokens with zero hardcoded hex colors and silent hover-revealed chrome', () => {
      const css = readCss('src/components/Threads/ThreadMarkdown.css')
      expect(css).not.toMatch(/#[0-9a-fA-F]{3,8}\b/)
      expect(css).toMatch(/\.thread-code-action-secondary\s*\{[^}]*opacity:\s*0/)
      expect(css).toMatch(/\.thread-code-block:hover \.thread-code-action-secondary/)
      expect(css).toMatch(/\.thread-code-block:focus-within \.thread-code-action-secondary/)
      expect(css).toMatch(/\.thread-markdown \.thread-code-block\[data-wrapped='true'\] pre\s*\{[^}]*white-space:\s*pre-wrap[^}]*overflow-wrap:\s*anywhere/)
      expect(css).toMatch(/\.thread-diff-code-line\.is-added\s*\{[^}]*background:\s*var\(--diff-add-bg\)[^}]*color:\s*var\(--intent-success-fg\)/)
      expect(css).toMatch(/\.thread-diff-code-line\.is-removed\s*\{[^}]*background:\s*var\(--diff-del-bg\)[^}]*color:\s*var\(--intent-danger-fg\)/)
      expect(css).toMatch(/\.thread-diff-code-line\.is-hunk\s*\{[^}]*color:\s*var\(--tx-accent\)/)
    })
  })
})
