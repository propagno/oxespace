import { useState, useRef, useEffect, type ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '../../ui/Button'

export interface HunkOpenMenuProps {
  targets: Array<{ line: number }>
  onOpen: (line: number) => void
}

export function HunkOpenMenu({ targets, onOpen }: HunkOpenMenuProps): ReactElement {
  const { t } = useTranslation('code')
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent): void => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    window.addEventListener('mousedown', onDown)
    return () => window.removeEventListener('mousedown', onDown)
  }, [open])

  const label = t('editor.openInEditor', { defaultValue: 'Open in editor' })

  return (
    <div className="hunk-open-menu-wrapper" ref={ref} style={{ position: 'relative', display: 'inline-block' }}>
      <Button
        variant="secondary"
        size="sm"
        onClick={() => setOpen(prev => !prev)}
      >
        {label}
      </Button>
      {open && (
        <div role="menu" className="hunk-open-menu-dropdown" style={{ position: 'absolute', right: 0, top: '100%', zIndex: 100 }}>
          {targets.map(target => (
            <button
              key={target.line}
              type="button"
              role="menuitem"
              aria-label={`Open in editor at line ${target.line}`}
              onClick={() => {
                setOpen(false)
                onOpen(target.line)
              }}
            >
              {`Line ${target.line}`}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
