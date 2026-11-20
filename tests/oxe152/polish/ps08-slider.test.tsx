import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { SettingsContent } from '../../../src/components/Settings/SettingsModal'
import { TERMINAL_PREFS_DEFAULTS, useTerminalPrefsStore } from '../../../src/store/terminal-prefs.store'
import { Slider } from '../../../src/ui'

const fieldCss = readFileSync(join(process.cwd(), 'src/ui/Field.module.css'), 'utf8')

beforeEach(() => {
  useTerminalPrefsStore.setState({ global: { ...TERMINAL_PREFS_DEFAULTS } })
})

afterEach(() => {
  cleanup()
})

function renderTerminalSettings() {
  return render(
    <SettingsContent
      section="terminal"
      agentProfiles={[]}
      agentReadiness={[]}
      isDiscoveringAgents={false}
      onClose={vi.fn()}
      onDiscoverAgents={vi.fn()}
      onConfigureAgent={vi.fn()}
      onNewCustomAgent={vi.fn()}
    />
  )
}

describe('OXE-237 · PS-08·10 Slider primitive in Terminal settings', () => {
  test('[css] the src/ui Slider: --surface-sunken track with a --bd-control edge, --accent fill, visible focus, mono tabular value', () => {
    const { container } = render(
      <Slider ariaLabel="Font size" min={8} max={32} step={1} value={14} valueLabel="14px" onChange={() => {}} />
    )

    const root = container.querySelector('[data-ui="slider"]')
    expect(root).not.toBeNull()
    expect(screen.getByRole('slider', { name: 'Font size' })).toHaveValue('14')
    expect(root?.querySelector('output')?.textContent).toBe('14px')

    const trackRule = fieldCss.match(/\.sliderTrack\s*\{([^}]+)\}/)?.[1] ?? ''
    expect(trackRule).toContain('var(--surface-sunken)')
    expect(trackRule).toContain('var(--bd-control)')

    const fillRule = fieldCss.match(/\.sliderFill\s*\{([^}]+)\}/)?.[1] ?? ''
    expect(fillRule).toContain('var(--accent)')

    const focusRule = fieldCss.match(/\.sliderInput:focus-visible\s*\{([^}]+)\}/)?.[1] ?? ''
    expect(focusRule).toContain('outline:')
    expect(focusRule).toContain('var(--focus-ring)')

    const valueRule = fieldCss.match(/\.sliderValue\s*\{([^}]+)\}/)?.[1] ?? ''
    expect(valueRule).toContain('var(--font-mono)')
    expect(valueRule).toContain('tabular-nums')
  })

  test('Terminal uses the Slider inside SettingRow for its five settings, 180 to 220 px wide', () => {
    const { container } = renderTerminalSettings()

    const sliders = Array.from(container.querySelectorAll('[data-ui="slider"]'))
    expect(sliders).toHaveLength(5)

    for (const slider of sliders) {
      expect(slider.closest('[data-ui="setting-row"]')).not.toBeNull()
    }

    const rawRangesOutsideSlider = Array.from(container.querySelectorAll('input[type="range"]')).filter(
      input => !input.closest('[data-ui="slider"]')
    )
    expect(rawRangesOutsideSlider).toHaveLength(0)

    const controlRule = fieldCss.match(/\.sliderControl\s*\{([^}]+)\}/)?.[1] ?? ''
    const widthMatch = controlRule.match(/(?:inline-size|width)\s*:\s*(\d+)px/)
    expect(widthMatch).not.toBeNull()
    const widthPx = Number(widthMatch![1])
    expect(widthPx).toBeGreaterThanOrEqual(180)
    expect(widthPx).toBeLessThanOrEqual(220)
  })

  test("arrow keys move the Slider by the setting's step and the terminal follows", async () => {
    const user = userEvent.setup()
    renderTerminalSettings()

    const initialSize = useTerminalPrefsStore.getState().global.fontSize
    const fontSizeSlider = screen.getByRole('slider', { name: /size/i })
    fontSizeSlider.focus()

    await user.keyboard('{ArrowRight}')
    expect(useTerminalPrefsStore.getState().global.fontSize).toBe(initialSize + 1)

    await user.keyboard('{ArrowLeft}')
    expect(useTerminalPrefsStore.getState().global.fontSize).toBe(initialSize)

    const initialLineHeight = useTerminalPrefsStore.getState().global.lineHeight
    const lineHeightSlider = screen.getByRole('slider', { name: /line height/i })
    lineHeightSlider.focus()

    await user.keyboard('{ArrowRight}')
    expect(useTerminalPrefsStore.getState().global.lineHeight).toBe(Number((initialLineHeight + 0.1).toFixed(1)))
  })
})
