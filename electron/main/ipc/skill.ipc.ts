import { BrowserWindow, ipcMain } from 'electron'
import { IPC_CHANNELS } from '../../../shared/types/ipc'
import type { SkillService } from '../services/skill.service'

/**
 * Wires Skill IPC. The renderer can list/get skill definitions, invoke a skill
 * (which writes the skill's body + argument to a pane terminal), and subscribe
 * to change events emitted whenever a skill file is added/modified/removed.
 */
export function registerSkillIpc(
  service: SkillService,
  terminalWrite: (input: { paneId: string; data: string }) => void
): void {
  ipcMain.handle(IPC_CHANNELS.skill.list, (_event, input: unknown) => {
    const workspaceRootPath = typeof input === 'object' && input !== null && typeof (input as { workspaceRootPath?: unknown }).workspaceRootPath === 'string'
      ? (input as { workspaceRootPath: string }).workspaceRootPath
      : undefined
    return service.listSkills(workspaceRootPath)
  })

  ipcMain.handle(IPC_CHANNELS.skill.get, (_event, name: unknown) => {
    if (typeof name !== 'string' || !name) throw new Error('skill name is required')
    return service.getSkill(name)
  })

  ipcMain.handle(IPC_CHANNELS.skill.invoke, (_event, input: unknown) => {
    if (!input || typeof input !== 'object') throw new Error('Invalid skill invoke input')
    const { skillName, paneId, argument } = input as { skillName?: unknown; paneId?: unknown; argument?: unknown }
    if (typeof skillName !== 'string' || !skillName) throw new Error('skillName is required')
    if (typeof paneId !== 'string' || !paneId) throw new Error('paneId is required')

    const skill = service.getSkill(skillName)
    if (!skill) throw new Error(`Skill "${skillName}" não encontrada`)

    const prompt = renderSkillPrompt(skill.body, typeof argument === 'string' ? argument : '')
    terminalWrite({ paneId, data: prompt + '\r' })
  })

  ipcMain.handle(IPC_CHANNELS.skill.create, (_event, input: unknown) => {
    if (!input || typeof input !== 'object') throw new Error('Invalid skill create input')
    const raw = input as Record<string, unknown>
    const name = typeof raw.name === 'string' ? raw.name : ''
    const description = typeof raw.description === 'string' ? raw.description : ''
    const scope = raw.scope === 'workspace' ? 'workspace' : 'user'
    const agents = Array.isArray(raw.agents)
      ? raw.agents.filter((a): a is string => typeof a === 'string')
      : []
    const category = typeof raw.category === 'string' ? raw.category : undefined
    const body = typeof raw.body === 'string' ? raw.body : undefined
    const workspaceRootPath = typeof raw.workspaceRootPath === 'string' ? raw.workspaceRootPath : undefined
    return service.createSkill({
      name,
      description,
      scope,
      agents: agents as import('../../../shared/types/agent').AgentProvider[],
      category,
      body,
      workspaceRootPath
    })
  })
}

/** Broadcasts skill changes to all renderer windows. Called by SkillService.onChange. */
export function broadcastSkillChange(): void {
  for (const window of BrowserWindow.getAllWindows()) {
    window.webContents.send(IPC_CHANNELS.skill.onChange)
  }
}

/**
 * Substitutes `{{argument}}` in the skill body with the user-supplied argument.
 * When the body doesn't include the placeholder, argument is appended at the end.
 */
function renderSkillPrompt(body: string, argument: string): string {
  if (body.includes('{{argument}}')) {
    return body.replace(/\{\{argument\}\}/g, argument)
  }
  return argument ? `${body}\n\n${argument}` : body
}
