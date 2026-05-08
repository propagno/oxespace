import type {
  SplitPaneInput,
  TerminalResizeInput,
  TerminalStartInput,
  TerminalStopInput,
  TerminalWriteInput
} from '../../../shared/types/ipc'
import type { CreateWorkspaceInput, WorkspaceLayout } from '../../../shared/types/workspace'

const LAYOUTS = new Set<WorkspaceLayout>(['1x1', '1x2', '2x1', '2x2', '3x4', '4x4'])

export function parseWorkspaceCreateInput(value: unknown): CreateWorkspaceInput {
  const input = expectRecord(value, 'workspace:create input')
  const rootPath = expectNonEmptyString(input.rootPath, 'rootPath')
  const layout = expectLayout(input.layout)
  const defaultShellProfileId =
    input.defaultShellProfileId === undefined ? undefined : expectNonEmptyString(input.defaultShellProfileId, 'defaultShellProfileId')
  const name = input.name === undefined ? undefined : expectNonEmptyString(input.name, 'name')

  return {
    rootPath,
    layout,
    defaultShellProfileId,
    name,
    autoStart: input.autoStart === true
  }
}

export function parseId(value: unknown, label = 'id'): string {
  return expectNonEmptyString(value, label)
}

export function parseTerminalStartInput(value: unknown): TerminalStartInput {
  const input = expectRecord(value, 'terminal:start input')
  return {
    paneId: expectNonEmptyString(input.paneId, 'paneId'),
    workspaceId: expectNonEmptyString(input.workspaceId, 'workspaceId')
  }
}

export function parseTerminalWriteInput(value: unknown): TerminalWriteInput {
  const input = expectRecord(value, 'terminal:write input')
  return {
    paneId: expectNonEmptyString(input.paneId, 'paneId'),
    data: expectString(input.data, 'data')
  }
}

export function parseTerminalResizeInput(value: unknown): TerminalResizeInput {
  const input = expectRecord(value, 'terminal:resize input')
  return {
    paneId: expectNonEmptyString(input.paneId, 'paneId'),
    cols: expectPositiveInteger(input.cols, 'cols'),
    rows: expectPositiveInteger(input.rows, 'rows')
  }
}

export function parseTerminalStopInput(value: unknown): TerminalStopInput {
  const input = expectRecord(value, 'terminal stop input')
  return {
    paneId: expectNonEmptyString(input.paneId, 'paneId')
  }
}

export function parseSplitPaneInput(value: unknown): SplitPaneInput {
  const input = expectRecord(value, 'workspace:split-pane input')
  return {
    paneId: expectNonEmptyString(input.paneId, 'paneId'),
    direction: expectDirection(input.direction)
  }
}

function expectRecord(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`${label} must be an object`)
  }
  return value as Record<string, unknown>
}

function expectDirection(value: unknown): 'vertical' | 'horizontal' {
  if (value !== 'vertical' && value !== 'horizontal') {
    throw new Error('direction must be "vertical" or "horizontal"')
  }
  return value
}

function expectLayout(value: unknown): WorkspaceLayout {
  if (typeof value !== 'string' || !LAYOUTS.has(value as WorkspaceLayout)) {
    throw new Error('layout must be one of 1x1, 1x2, 2x2, 3x4, 4x4')
  }
  return value as WorkspaceLayout
}

function expectNonEmptyString(value: unknown, label: string): string {
  const text = expectString(value, label).trim()
  if (text.length === 0) {
    throw new Error(`${label} must not be empty`)
  }
  return text
}

function expectString(value: unknown, label: string): string {
  if (typeof value !== 'string') {
    throw new Error(`${label} must be a string`)
  }
  return value
}

function expectPositiveInteger(value: unknown, label: string): number {
  if (!Number.isInteger(value) || Number(value) <= 0) {
    throw new Error(`${label} must be a positive integer`)
  }
  return Number(value)
}
