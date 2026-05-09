import { render } from '@testing-library/react'
import { afterEach, describe, expect, test } from 'vitest'
import { ThemeProvider } from '../../src/components/Theme/ThemeProvider'

describe('ThemeProvider', () => {
  afterEach(() => {
    delete document.documentElement.dataset.theme
    delete document.documentElement.dataset.density
  })

  test('applies workspace theme and density to the document root', () => {
    render(
      <ThemeProvider themeId="dracula" density="comfortable">
        <div />
      </ThemeProvider>
    )

    expect(document.documentElement.dataset.theme).toBe('dracula')
    expect(document.documentElement.dataset.density).toBe('comfortable')
  })
})
