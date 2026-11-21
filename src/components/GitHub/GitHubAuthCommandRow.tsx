// PU-03·8 (OXE-211): shared "gh auth login" command row with copyText confirmation toast.
import { Copy, Terminal } from 'lucide-react'
import type { ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import { Button, copyText } from '../../ui'

export function GitHubAuthCommandRow({
  onRunCommand,
  runVariant = 'primary',
  showCopyLabel = false
}: {
  onRunCommand?: (cmd: string) => void
  runVariant?: 'primary' | 'ghost'
  showCopyLabel?: boolean
}): ReactElement {
  const { t: tc } = useTranslation('code')
  const copyAuth = (): void => {
    void copyText('gh auth login', tc('github.setup.command'), tc('github.setup.commandCopied'))
  }

  return (
    <div className="github-setup-cmd-row">
      <code>gh auth login</code>
      <Button
        size="sm"
        variant={showCopyLabel ? 'secondary' : 'ghost'}
        title={tc('github.actions.copy')}
        aria-label={tc('github.setup.copy', { command: 'gh auth login' })}
        onClick={copyAuth}
      >
        <Copy size={12} aria-hidden="true" />
        {showCopyLabel ? tc('github.actions.copy') : null}
      </Button>
      {onRunCommand ? (
        <Button size="sm" variant={runVariant} onClick={() => onRunCommand('gh auth login')}>
          <Terminal size={12} aria-hidden="true" />
          {tc('github.setup.run')}
        </Button>
      ) : null}
    </div>
  )
}
