import { expect, test } from 'vitest'
import { paneMenuPlacement, statusBarFloor } from '../../src/components/Grid/paneMenuPlacement'

const viewport = { width: 1280, height: 860 }
const STATUS_TOP = 836 // a 24 px status bar

test('a top-row pane opens its menu below the button, stopping above the status bar', () => {
  const placement = paneMenuPlacement({ top: 60, bottom: 84, right: 1200 }, viewport, STATUS_TOP)
  expect(placement).toEqual({ top: 90, right: 80, maxHeight: STATUS_TOP - 84 - 6 - 8 })
  expect(placement.top! + placement.maxHeight).toBeLessThanOrEqual(STATUS_TOP)
})

test('a bottom-row pane (FINDING M, 6 panes at 1280x860) opens upward, so no item lies under the status bar', () => {
  const placement = paneMenuPlacement({ top: 470, bottom: 494, right: 1270 }, viewport, STATUS_TOP)
  expect(placement.top).toBeUndefined()
  expect(placement.bottom).toBe(860 - 470 + 6)
  expect(placement.maxHeight).toBe(470 - 6 - 8)
  // The menu's lowest edge is the button's top, well above the status bar.
  expect(viewport.height - placement.bottom!).toBeLessThan(STATUS_TOP)
})

test('with little room either way, it takes the larger side and never a negative height', () => {
  const small = { width: 400, height: 200 }
  expect(paneMenuPlacement({ top: 20, bottom: 44, right: 390 }, small, 176)).toMatchObject({ top: 50, right: 10 })
  expect(paneMenuPlacement({ top: 150, bottom: 174, right: 390 }, small, 176)).toMatchObject({ bottom: 56, maxHeight: 136 })
  expect(paneMenuPlacement({ top: 0, bottom: 300, right: 390 }, small, 176).maxHeight).toBe(0)
})

test('the floor is the top of a shown status bar, else the window bottom', () => {
  document.body.innerHTML = '<footer class="app-statusbar"></footer>'
  const bar = document.querySelector('.app-statusbar')!
  bar.getBoundingClientRect = () => ({ top: 836, height: 24, bottom: 860, left: 0, right: 1280, width: 1280, x: 0, y: 836, toJSON: () => ({}) })
  expect(statusBarFloor(document, 860)).toBe(836)
  bar.getBoundingClientRect = () => ({ top: 0, height: 0, bottom: 0, left: 0, right: 0, width: 0, x: 0, y: 0, toJSON: () => ({}) })
  expect(statusBarFloor(document, 860)).toBe(860)
})
