import { afterEach, expect, test, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { DefaultShellSettings } from '../../src/components/Workspace/DefaultShellSettings'
import { fallbackShellProfiles } from '../../electron/main/services/shell-profile.defaults'

afterEach(cleanup)
test('offers agent launchers with explicit scope and a read-only startup summary', () => {
  const onSelect = vi.fn(), onApplyToIdle = vi.fn()
  render(<DefaultShellSettings profiles={fallbackShellProfiles('win32')} selectedId="builtin-powershell" onSelect={onSelect}
    applyToIdle={false} onApplyToIdle={onApplyToIdle} rootPath="C:/work/project" />)
  expect(screen.getByRole('radio', { name: 'PowerShell' })).toBeChecked()
  expect(screen.getByText('-NoLogo')).toBeVisible()
  expect(screen.getByText('C:/work/project')).toBeVisible()
  expect(screen.getByText('Shell only · start Copilot manually')).toBeVisible()
  fireEvent.click(screen.getByRole('radio', { name: 'Codex' }))
  expect(onSelect).toHaveBeenCalledWith('builtin-codex')
  fireEvent.click(screen.getByRole('radio', { name: /Also update idle/ }))
  expect(onApplyToIdle).toHaveBeenCalledWith(true)
})
test('missing saved profile is explicit instead of showing a misleading selection', () => {
  render(<DefaultShellSettings profiles={fallbackShellProfiles('linux')} selectedId="missing" onSelect={() => {}}
    applyToIdle={false} onApplyToIdle={() => {}} rootPath="/project" />)
  expect(screen.getByRole('alert')).toHaveTextContent('saved profile is unavailable')
  expect(screen.queryByLabelText('Selected launch profile')).toBeNull()
})
