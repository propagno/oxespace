export interface LineChange {
  originalStartLineNumber: number
  originalEndLineNumber: number
  modifiedStartLineNumber: number
  modifiedEndLineNumber: number
  charChanges?: unknown
}

export interface HunkTarget {
  line: number
}

export interface Decoration {
  range: {
    startLineNumber: number
    startColumn: number
    endLineNumber: number
    endColumn: number
  }
  options: {
    isWholeLine?: boolean
    glyphMarginClassName?: string
    glyphMarginHoverMessage?: { value: string }
  }
}

/**
 * Takes Monaco's ILineChange[] and returns one { line } per change: its first modified line,
 * or for a pure deletion (modifiedEndLineNumber 0) the line after it.
 */
export function hunkTargets(changes: LineChange[]): HunkTarget[] {
  if (!changes || changes.length === 0) return []
  return changes.map(change => {
    if (change.modifiedEndLineNumber === 0) {
      return { line: change.modifiedStartLineNumber + 1 }
    }
    return { line: change.modifiedStartLineNumber }
  })
}

/**
 * Returns one decoration per target on that line, drawn in the glyph margin.
 */
export function hunkDecorations(targets: HunkTarget[]): Decoration[] {
  return targets.map(target => ({
    range: {
      startLineNumber: target.line,
      startColumn: 1,
      endLineNumber: target.line,
      endColumn: 1
    },
    options: {
      isWholeLine: false,
      glyphMarginClassName: 'oq-diff-hunk-glyph',
      glyphMarginHoverMessage: {
        value: `Open in editor at line ${target.line}`
      }
    }
  }))
}
