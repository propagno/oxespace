import { describe, expect, it } from 'vitest'
import { engineAdvice } from '../../src/components/OxeQuery/EngineBar'
import type { ContainerEngineCandidate } from '../../shared/types/oxequery'

const entry = (change: Partial<ContainerEngineCandidate>): ContainerEngineCandidate => ({ id: 'context:x', label: 'x', endpoint: 'unix:///x', current: false, selected: false, state: 'ready', ...change })

describe('engineAdvice', () => {
  it('points at the engine that has the containers when the chosen one is empty', () => {
    const text = engineAdvice([entry({ id: 'context:desktop-linux', label: 'desktop-linux', selected: true, containers: 0 }), entry({ id: 'socket:system', label: 'System Docker engine', containers: 209 })], 0)
    expect(text).toMatch(/No containers in “desktop-linux”.*“System Docker engine” has 209/)
  })

  it('explains a socket this user may not use, without suggesting sudo', () => {
    const text = engineAdvice([entry({ selected: true, containers: 0 }), entry({ id: 'socket:system', label: 'System Docker engine', endpoint: 'unix:///var/run/docker.sock', state: 'denied' })], 0)
    expect(text).toMatch(/not allowed.*docker group/)
    expect(text).not.toMatch(/sudo/)
  })

  it('says nothing when containers are showing or nothing is wrong', () => {
    expect(engineAdvice([entry({ selected: true, containers: 3 }), entry({ id: 'socket:system', state: 'denied' })], 3)).toBeNull()
    expect(engineAdvice([entry({ selected: true, containers: 0 })], 0)).toBeNull()
  })
})
