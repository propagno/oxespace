import type { editor as MonacoEditor, IDisposable } from 'monaco-editor'
import type { Monaco } from '@monaco-editor/react'
import type { DiffComment, DiffSide } from '../../../shared/types/diff-comments'

export interface LineCommentApi {
  /** Latest comments for the file being shown. */
  comments(): DiffComment[]
  add(side: DiffSide, lineNo: number, lineContent: string, body: string): void
  remove(id: string): void
}

type Editor = MonacoEditor.IStandaloneCodeEditor

const COMPOSER_HEIGHT = 112

/** Card height for `body` when about `perLine` characters fit on a line (body text + footer row + padding). */
function commentHeight(body: string, perLine: number): number {
  const lines = body.split('\n').reduce((total, line) => total + Math.max(1, Math.ceil(line.length / perLine)), 0)
  return 20 + lines * 18 + 28
}

function element<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag)
  if (className) node.className = className
  if (text !== undefined) node.textContent = text
  return node
}

/**
 * Line comments on a Monaco diff: hover a line to get a "+" in the glyph
 * margin, click it to open a comment box under that line. Saved comments render
 * as a card under their line. Plain DOM keeps the view zones independent of
 * React's render cycle.
 */
export function attachLineComments(diff: MonacoEditor.IStandaloneDiffEditor, monaco: Monaco, api: LineCommentApi): { sync(): void; dispose(): void } {
  const sides: Array<{ side: DiffSide; editor: Editor }> = [
    { side: 'old', editor: diff.getOriginalEditor() },
    { side: 'new', editor: diff.getModifiedEditor() }
  ]
  const disposables: IDisposable[] = []
  const zones = new Map<Editor, string[]>()
  const widgets = new Map<Editor, MonacoEditor.IOverlayWidget[]>()
  let widgetCounter = 0
  const hover = new Map<Editor, MonacoEditor.IEditorDecorationsCollection>()
  const marks = new Map<Editor, MonacoEditor.IEditorDecorationsCollection>()
  let composer: { side: DiffSide; line: number } | null = null

  const clearZones = (editor: Editor): void => {
    const ids = zones.get(editor) ?? []
    if (ids.length) editor.changeViewZones(accessor => { for (const id of ids) accessor.removeZone(id) })
    zones.set(editor, [])
    for (const widget of widgets.get(editor) ?? []) editor.removeOverlayWidget(widget)
    widgets.set(editor, [])
  }

  /**
   * A view zone only reserves the space; Monaco paints it below the text layer,
   * so the interactive card is an overlay widget that follows the zone's top.
   */
  const addZone = (editor: Editor, afterLine: number, height: number, node: HTMLElement): void => {
    const spacer = element('div')
    node.style.position = 'absolute'
    node.style.right = '14px'
    node.style.boxSizing = 'border-box'
    node.style.height = `${height}px`
    node.style.zIndex = '5'
    const widgetId = `oxe.line-comment.${widgetCounter++}` // Monaco looks widgets up by id, so it must be stable
    const widget: MonacoEditor.IOverlayWidget = { getId: () => widgetId, getDomNode: () => node, getPosition: () => ({ preference: null }) }
    editor.changeViewZones(accessor => {
      const id = accessor.addZone({
        afterLineNumber: afterLine, heightInPx: height, domNode: spacer, suppressMouseDown: true,
        onDomNodeTop: top => { node.style.top = `${top}px`; node.style.left = `${editor.getLayoutInfo().contentLeft + 8}px` }
      })
      zones.set(editor, [...(zones.get(editor) ?? []), id])
    })
    editor.addOverlayWidget(widget)
    widgets.set(editor, [...(widgets.get(editor) ?? []), widget])
  }

  const render = (): void => {
    const comments = api.comments()
    for (const { side, editor } of sides) {
      clearZones(editor)
      const mine = comments.filter(comment => comment.side === side)
      for (const comment of mine) {
        const card = element('div', 'oxe-line-comment')
        card.append(element('p', undefined, comment.body))
        const footer = element('div', 'oxe-line-comment-footer')
        const remove = element('button', 'oxe-line-comment-remove', 'Remove')
        remove.type = 'button'
        remove.setAttribute('aria-label', `Remove comment on line ${comment.lineNo}`)
        remove.addEventListener('mousedown', event => event.stopPropagation())
        remove.addEventListener('click', () => api.remove(comment.id))
        footer.append(remove)
        card.append(footer)
        const perLine = Math.max(14, Math.floor((editor.getLayoutInfo().contentWidth - 40) / 6.6))
        addZone(editor, comment.lineNo, commentHeight(comment.body, perLine), card)
      }
      marks.get(editor)?.set(mine.map(comment => ({
        range: new monaco.Range(comment.lineNo, 1, comment.lineNo, 1),
        options: { glyphMarginClassName: 'oxe-diff-comment-glyph', glyphMarginHoverMessage: { value: 'Review comment' } }
      })))
      if (composer?.side === side) {
        const box = element('div', 'oxe-line-composer')
        const input = element('textarea')
        input.placeholder = `Comment on line ${composer.line}…`
        input.setAttribute('aria-label', `Comment on line ${composer.line}`)
        const row = element('div', 'oxe-line-composer-actions')
        const cancel = element('button', undefined, 'Cancel'); cancel.type = 'button'
        const save = element('button', 'is-primary', 'Comment'); save.type = 'button'
        const line = composer.line
        const finish = (): void => { composer = null; render() }
        const submit = (): void => {
          const body = input.value.trim()
          if (!body) return
          const model = editor.getModel()
          api.add(side, line, model?.getLineContent(line) ?? '', body)
          finish()
        }
        cancel.addEventListener('click', finish)
        save.addEventListener('click', submit)
        input.addEventListener('keydown', event => {
          if (event.key === 'Escape') { event.preventDefault(); finish() }
          else if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) { event.preventDefault(); submit() }
          event.stopPropagation()
        })
        row.append(cancel, save)
        box.append(input, row)
        addZone(editor, line, COMPOSER_HEIGHT, box)
        window.setTimeout(() => input.focus(), 0)
      }
    }
  }

  for (const { side, editor } of sides) {
    editor.updateOptions({ glyphMargin: true })
    hover.set(editor, editor.createDecorationsCollection())
    marks.set(editor, editor.createDecorationsCollection())
    disposables.push(editor.onMouseMove(event => {
      const line = event.target.position?.lineNumber
      hover.get(editor)?.set(line ? [{ range: new monaco.Range(line, 1, line, 1), options: { glyphMarginClassName: 'oxe-diff-add-glyph' } }] : [])
    }))
    disposables.push(editor.onMouseLeave(() => hover.get(editor)?.clear()))
    disposables.push(editor.onMouseDown(event => {
      if (event.target.type !== monaco.editor.MouseTargetType.GUTTER_GLYPH_MARGIN || !event.target.position) return
      composer = { side, line: event.target.position.lineNumber }
      render()
    }))
  }
  render()

  return {
    sync: render,
    dispose: () => {
      for (const disposable of disposables) disposable.dispose()
      for (const { editor } of sides) { try { clearZones(editor) } catch { /* editor already disposed */ } }
    }
  }
}
