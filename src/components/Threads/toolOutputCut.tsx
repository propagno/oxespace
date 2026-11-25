import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { i18n } from '../../i18n'
import type { ToolOutputCutInfo } from '../../store/tool-output-cut.store'
import { Button, Dialog, copyText } from '../../ui'

function formatBytes(bytes: number, lang: string): string {
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  if (bytes < 1024) return `${bytes} B`
  let unitIndex = 0
  let val = bytes
  while (val >= 1024 && unitIndex < units.length - 1) {
    val /= 1024
    unitIndex++
  }
  const formatted = val.toLocaleString(lang === 'pt-BR' ? 'pt-BR' : 'en-US', {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1
  })
  return `${formatted} ${units[unitIndex]}`
}

/** A failed command shows this many lines until the person asks for the rest. */
export const STEP_OUTPUT_TAIL = 12

/** The tail of a command's output, and how many earlier lines are still hidden. */
export function stepOutputTail(output: string, all: boolean): { shown: string; hidden: number } {
  const lines = output.split('\n')
  if (all || lines.length <= STEP_OUTPUT_TAIL) return { shown: output, hidden: 0 }
  return { shown: lines.slice(-STEP_OUTPUT_TAIL).join('\n'), hidden: lines.length - STEP_OUTPUT_TAIL }
}

export function cutNote(keptBytes: number, totalBytes?: number): string {
  const lang = i18n.language === 'pt-BR' ? 'pt-BR' : 'en'
  const kept = formatBytes(keptBytes, lang)
  if (totalBytes !== undefined && totalBytes > 0) {
    const total = formatBytes(totalBytes, lang)
    return i18n.t('thread:toolOutputCut.withTotal', { kept, total })
  }
  return i18n.t('thread:toolOutputCut.keptOnly', { kept })
}

export function ToolOutputCutBanner({ cut, fullOutput, toolLabel }: { cut: ToolOutputCutInfo; fullOutput: string; toolLabel: string }) {
  const { t } = useTranslation('thread')
  const [open, setOpen] = useState(false)
  const [copied, setCopied] = useState(false)

  const handleCopy = async () => {
    const ok = await copyText(fullOutput)
    if (ok) {
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1800)
    }
  }

  return <>
    <div className="thread-tool-cut-bar">
      <p className="thread-tool-cut-note">{cutNote(cut.keptBytes, cut.totalBytes)}</p>
      {fullOutput.length > 0 && (
        <Button variant="ghost" size="sm" onClick={() => setOpen(true)}>
          {t('toolOutputCut.openFull')}
        </Button>
      )}
    </div>
    {open && (
      <Dialog
        size="xl"
        title={t('toolOutputCut.modalTitle', { tool: toolLabel })}
        description={cutNote(cut.keptBytes, cut.totalBytes)}
        onClose={() => setOpen(false)}
        actions={{
          cancel: { label: t('common.close') },
          extra: (
            <Button size="sm" onClick={() => void handleCopy()}>
              {copied ? t('toolOutputCut.copied') : t('toolOutputCut.copyFull')}
            </Button>
          )
        }}
      >
        <pre className="thread-tool-full-output" data-ui="full-output">{fullOutput}</pre>
      </Dialog>
    )}
  </>
}
