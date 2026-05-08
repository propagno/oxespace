import type { ReactElement } from 'react'

interface ConflictDiffProps {
  localContent: string
  externalContent: string
}

export function ConflictDiff({ externalContent, localContent }: ConflictDiffProps): ReactElement {
  return (
    <section className="editor-conflict" aria-label="External file change conflict">
      <div className="editor-conflict-header">
        <strong>External change detected</strong>
        <span>Local edits were kept.</span>
      </div>
      <div className="editor-conflict-grid">
        <pre aria-label="Local content">{localContent}</pre>
        <pre aria-label="External content">{externalContent}</pre>
      </div>
    </section>
  )
}
