import { beforeEach, describe, expect, test } from 'vitest'
import { useUIStore } from '../../src/store/ui.store'

describe('UI store Web Preview ownership', () => {
  beforeEach(() => {
    useUIStore.setState({
      webPreviewOpenByWorkspace: {},
      pendingWebPreviewByWorkspace: {}
    })
  })

  test('opens and closes previews independently by workspace', () => {
    useUIStore.getState().openWebPreview('workspace-a')
    useUIStore.getState().openWebPreview('workspace-b')
    useUIStore.getState().closeWebPreview('workspace-a')

    expect(useUIStore.getState().webPreviewOpenByWorkspace).toEqual({
      'workspace-b': true
    })
  })

  test('keeps pending agent URLs isolated until each workspace consumes its own', () => {
    useUIStore.getState().setPendingWebPreview('workspace-a', 'http://localhost:3000')
    useUIStore.getState().setPendingWebPreview('workspace-b', 'http://localhost:8081')
    useUIStore.getState().setPendingWebPreview('workspace-a', null)

    expect(useUIStore.getState().pendingWebPreviewByWorkspace).toEqual({
      'workspace-b': 'http://localhost:8081'
    })
  })
})
