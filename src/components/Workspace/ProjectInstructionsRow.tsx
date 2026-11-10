import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { openPathIn, preferredEditor, useOpenInStore } from '../../lib/openIn'
import { Button, toast } from '../../ui'
import { i18n } from '../../i18n'
import './WorkspaceDelegationSettings.css'

/** The instruction files agents read at the start of a conversation, in the order they are listed. */
const INSTRUCTION_FILES = ['CLAUDE.md', 'AGENTS.md'] as const

/** Which of the instruction files exist; a failed read (or no file API) means the file is not there. */
async function existingInstructionFiles(workspaceId: string, rootPath: string): Promise<string[]> {
  const read = window.oxe?.fs?.readFile
  if (!read) return []
  const results = await Promise.allSettled(INSTRUCTION_FILES.map(relativePath => read({ workspaceId, rootPath, relativePath })))
  return INSTRUCTION_FILES.filter((_, index) => results[index].status === 'fulfilled')
}

/**
 * R5 (1.5.0) · Project instructions: where AI Memory used to be, the workspace points to the files agents already read
 * (CLAUDE.md, AGENTS.md at the root). It only reads them and opens one in the preferred external editor; it never
 * creates or writes a file.
 */
export function ProjectInstructionsRow({ workspaceId, rootPath }: { workspaceId: string; rootPath: string }) {
  const { t } = useTranslation('code')
  const key = `${workspaceId}\u0000${rootPath}`
  // The result is kept with the workspace and root it was read for, so a change of either shows nothing stale.
  const [found, setFound] = useState<{ key: string; files: string[] } | null>(null)
  const existing = found?.key === key ? found.files : null

  useEffect(() => {
    let live = true
    void existingInstructionFiles(workspaceId, rootPath).then(files => { if (live) setFound({ key, files }) })
    return () => { live = false }
  }, [key, workspaceId, rootPath])

  const open = async (relativePath: string): Promise<void> => {
    let targets = useOpenInStore.getState().targets
    if (!targets) { await useOpenInStore.getState().refresh(); targets = useOpenInStore.getState().targets }
    const editor = preferredEditor(targets)
    if (!editor) {
      toast({ title: (i18n.t as unknown as (key: string, options: object) => string)('openIn.noEditor', { ns: 'common' }), intent: 'info' })
      return
    }
    await openPathIn({ workspaceId, rootPath, relativePath }, editor.id)
  }

  return <section className="ws-settings-section memory-settings" aria-labelledby="project-instructions-title">
    <header className="ws-settings-section-header"><h3 id="project-instructions-title">{t('workspace.instructions.title')}</h3></header>
    <p>{t('workspace.instructions.hint')}</p>
    {existing && existing.length > 0 && <ul className="project-instructions-list">
      {existing.map(name => <li key={name} className="memory-status-line">
        <code>{name}</code>
        <Button size="sm" onClick={() => void open(name)}>{t('workspace.instructions.open')}</Button>
      </li>)}
    </ul>}
    {existing && existing.length === 0 && <p>{t('workspace.instructions.none')}</p>}
  </section>
}
