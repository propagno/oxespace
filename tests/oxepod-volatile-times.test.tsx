import { render, screen } from '@testing-library/react'
import { describe, expect, test } from 'vitest'
import { AboutCard } from '../src/components/OxePod/ContainerCards'
import type { ContainerInspect } from '../shared/types/oxepod'

// The visual baselines mask what is the clock of the run instead of rewriting the page's text (#257 review):
// the About card's start is a <time> marked volatile, with the instant in its dateTime.
const inspect: ContainerInspect = {
  id: 'c1', name: 'mongo-dev', image: 'mongo:7', state: 'running', startedAt: Date.UTC(2026, 9, 18, 8, 0, 0),
  command: 'docker-entrypoint.sh', environment: [], mounts: [], networks: [], ports: []
}

describe('OxePod About card', () => {
  test('the start is a volatile <time> with the instant in its dateTime', () => {
    render(<AboutCard inspect={inspect} />)
    const time = screen.getByRole('region', { name: 'About' }).querySelector('time[data-oq-volatile]')
    expect(time).not.toBeNull()
    expect(time).toHaveAttribute('dateTime', '2026-10-18T08:00:00.000Z')
    expect(time?.textContent).toMatch(/2026/)
  })
})
