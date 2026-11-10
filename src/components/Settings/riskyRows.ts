import { applyWithUndo } from '../../ui/Settings'

export interface RiskySettingRow {
  id: 'R1' | 'R2' | 'R3' | 'R4' | 'R6' | 'R7' | 'R8' | 'R9' | 'R10'
  label: string
  read(): unknown | Promise<unknown>
  widen(): Promise<void>
}

let r1State = false
let r2State = 'ask'
let r3State = 'ask'
let r4State = false
let r6State = false
let r7State = 'default-command'
let r8State = false
let r9State = 'bash'
let r10State: Record<string, string[]> = { 'view.code': ['Mod+9'] }

export const RISKY_SETTING_ROWS: ReadonlyArray<RiskySettingRow> = [
  {
    id: 'R1',
    label: 'Resume terminal commands without prompts',
    read: () => r1State,
    widen: async () => {
      const prev = r1State
      await applyWithUndo({
        apply: async () => { r1State = true },
        undo: async () => { r1State = prev },
        done: 'Resume without prompts enabled'
      })
    }
  },
  {
    id: 'R2',
    label: 'Tool execution mode widened',
    read: () => r2State,
    widen: async () => {
      const prev = r2State
      await applyWithUndo({
        apply: async () => { r2State = 'allowed' },
        undo: async () => { r2State = prev },
        done: 'Tool execution mode updated'
      })
    }
  },
  {
    id: 'R3',
    label: 'Tool rule set to Allow',
    read: () => r3State,
    widen: async () => {
      const prev = r3State
      await applyWithUndo({
        apply: async () => { r3State = 'allow' },
        undo: async () => { r3State = prev },
        done: 'Tool rule set to Allow'
      })
    }
  },
  {
    id: 'R4',
    label: 'MCP server added from catalog',
    read: () => r4State,
    widen: async () => {
      const prev = r4State
      await applyWithUndo({
        apply: async () => { r4State = true },
        undo: async () => { r4State = prev },
        done: 'MCP server added from catalog'
      })
    }
  },
  {
    id: 'R6',
    label: 'OxeQuery safety preferences',
    read: () => r6State,
    widen: async () => {
      const prev = r6State
      await applyWithUndo({
        apply: async () => { r6State = true },
        undo: async () => { r6State = prev },
        done: 'OxeQuery preferences saved'
      })
    }
  },
  {
    id: 'R7',
    label: 'Custom agent command',
    read: () => r7State,
    widen: async () => {
      const prev = r7State
      await applyWithUndo({
        apply: async () => { r7State = 'custom-agent-cmd --auto' },
        undo: async () => { r7State = prev },
        done: 'Custom agent command changed'
      })
    }
  },
  {
    id: 'R8',
    label: 'Allow phones on local network',
    read: () => r8State,
    widen: async () => {
      const prev = r8State
      await applyWithUndo({
        apply: async () => { r8State = true },
        undo: async () => { r8State = prev },
        done: 'Phones on this network allowed'
      })
    }
  },
  {
    id: 'R9',
    label: 'Workspace default shell profile',
    read: () => r9State,
    widen: async () => {
      const prev = r9State
      await applyWithUndo({
        apply: async () => { r9State = 'pwsh' },
        undo: async () => { r9State = prev },
        done: 'The default shell is now PowerShell'
      })
    }
  },
  {
    id: 'R10',
    label: 'Reset all keyboard shortcuts',
    read: () => r10State,
    widen: async () => {
      const prev = r10State
      await applyWithUndo({
        apply: async () => { r10State = {} },
        undo: async () => { r10State = prev },
        done: 'Shortcuts reset to defaults'
      })
    }
  }
]
