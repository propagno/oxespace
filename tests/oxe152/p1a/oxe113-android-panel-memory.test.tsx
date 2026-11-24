// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, test, vi } from 'vitest'
import '../../../src/i18n'
import { AndroidPanel } from '../../../src/components/Android/AndroidPanel'
import { Toaster } from '../../../src/ui/Toast'

function mockAndroid(options: { freeMemoryMb: number }) {
  const android = {
    status: vi.fn(async () => ({
      adb: 'ok' as const,
      devices: [],
      avds: ['Pixel_8_API_36'],
      freeMemoryMb: options.freeMemoryMb
    })),
    onChanged: vi.fn(() => () => undefined),
    onFrame: vi.fn(() => () => undefined),
    connect: vi.fn(async () => ({ ok: true })),
    disconnect: vi.fn(async () => undefined),
    tap: vi.fn(async () => undefined),
    swipe: vi.fn(async () => undefined),
    key: vi.fn(async () => undefined),
    rotate: vi.fn(async () => undefined),
    screenshot: vi.fn(async () => ({ path: 'x', name: 'x.png' })),
    setAgentsCanSee: vi.fn(async () => undefined),
    startEmulator: vi.fn(async () => undefined),
    checkEmulatorMemory: vi.fn(async (input?: { lightweight?: boolean }) => {
      const lightweight = input?.lightweight !== false
      const requiredMb = lightweight ? 2048 : 4096
      return {
        ok: options.freeMemoryMb >= requiredMb,
        freeMb: options.freeMemoryMb,
        requiredMb,
        lightweight
      }
    })
  }
  Object.assign(window, { oxe: { android, featureUsage: { record: async () => undefined } } })
  return android
}

afterEach(() => {
  cleanup()
  delete (window as { oxe?: unknown }).oxe
})

describe('OXE-113 · AndroidPanel lightweight profile and low-memory warning', () => {
  test('sufficient memory starts directly with lightweight profile by default, and respects toggle to standard', async () => {
    const android = mockAndroid({ freeMemoryMb: 6144 })
    render(<><AndroidPanel /><Toaster /></>)

    const startBtn = await screen.findByRole('button', { name: 'Start the Pixel 8 emulator' })
    const toggle = screen.getByRole('switch', { name: 'Lightweight profile' })
    expect(toggle).toHaveAttribute('aria-checked', 'true')
    expect(screen.queryByText('Low free memory')).toBeNull()

    fireEvent.click(startBtn)
    await waitFor(() => expect(android.startEmulator).toHaveBeenCalledWith('Pixel_8_API_36', { lightweight: true }))
    expect(screen.queryByTestId('android-low-memory-confirm')).toBeNull()

    fireEvent.click(toggle)
    expect(toggle).toHaveAttribute('aria-checked', 'false')

    fireEvent.click(startBtn)
    await waitFor(() => expect(android.startEmulator).toHaveBeenLastCalledWith('Pixel_8_API_36', { lightweight: false }))
  })

  test('low memory shows inline warning and confirmation dialog that can cancel or proceed', async () => {
    const android = mockAndroid({ freeMemoryMb: 1200 })
    render(<><AndroidPanel /><Toaster /></>)

    const startBtn = await screen.findByRole('button', { name: 'Start the Pixel 8 emulator' })
    expect(screen.getByText('Low free memory')).toBeInTheDocument()
    expect(screen.getByText(/1200 MB/)).toBeInTheDocument()

    fireEvent.click(startBtn)
    const dialog = await screen.findByTestId('android-low-memory-confirm')
    expect(dialog).toHaveTextContent('Start emulator with low memory?')
    expect(android.startEmulator).not.toHaveBeenCalled()

    // Cancel does not start the emulator
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByTestId('android-low-memory-confirm')).toBeNull()
    expect(android.startEmulator).not.toHaveBeenCalled()

    // Confirming "Start anyway" launches the emulator with the chosen profile
    fireEvent.click(startBtn)
    const dialogAgain = await screen.findByTestId('android-low-memory-confirm')
    fireEvent.click(within(dialogAgain).getByRole('button', { name: 'Start anyway' }))
    await waitFor(() => expect(android.startEmulator).toHaveBeenCalledWith('Pixel_8_API_36', { lightweight: true }))
    expect(screen.queryByTestId('android-low-memory-confirm')).toBeNull()
  })
})
