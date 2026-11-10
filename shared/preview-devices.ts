export interface PreviewDevice {
  id: 'desktop' | 'pixel-8' | 'iphone-15' | 'galaxy-s23' | 'ipad-mini'
  name: string
  width: number | null
  height: number | null
  dpr: number
  ua: string
  touch: boolean
}

export interface PreviewEmulation {
  deviceEmulation: {
    screenPosition: 'mobile'
    screenSize: { width: number; height: number }
    viewSize: { width: number; height: number }
    deviceScaleFactor: number
    viewPosition: { x: number; y: number }
    scale: number
  }
  userAgent: string
  touch: boolean
}

export const PREVIEW_DEVICES: readonly PreviewDevice[] = [
  {
    id: 'desktop',
    name: 'Desktop',
    width: null,
    height: null,
    dpr: 1,
    ua: '',
    touch: false
  },
  {
    id: 'pixel-8',
    name: 'Pixel 8',
    width: 412,
    height: 915,
    dpr: 2.625,
    ua: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36',
    touch: true
  },
  {
    id: 'iphone-15',
    name: 'iPhone 15',
    width: 393,
    height: 852,
    dpr: 3,
    ua: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1',
    touch: true
  },
  {
    id: 'galaxy-s23',
    name: 'Galaxy S23',
    width: 360,
    height: 780,
    dpr: 3,
    ua: 'Mozilla/5.0 (Linux; Android 14; SM-S911B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36',
    touch: true
  },
  {
    id: 'ipad-mini',
    name: 'iPad mini',
    width: 744,
    height: 1133,
    dpr: 2,
    ua: 'Mozilla/5.0 (iPad; CPU OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1',
    touch: true
  }
]

export function emulationFor(device: PreviewDevice, rotated: boolean): PreviewEmulation | null {
  if (device.width === null || device.height === null) return null
  const viewSize = rotated
    ? { width: device.height, height: device.width }
    : { width: device.width, height: device.height }
  return {
    deviceEmulation: {
      screenPosition: 'mobile',
      screenSize: viewSize,
      viewSize,
      deviceScaleFactor: device.dpr,
      viewPosition: { x: 0, y: 0 },
      scale: 1
    },
    userAgent: device.ua,
    touch: device.touch
  }
}
