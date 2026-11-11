import type { ReactElement } from 'react'
import { Monitor, RotateCw, Smartphone, Tablet } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { PREVIEW_DEVICES, type PreviewDevice } from '../../../shared/preview-devices'
import { Button, IconButton } from '../../ui/Button'
import { Menu, type MenuRadioOption } from '../../ui/Overlay'

export interface DeviceFrameFit {
  scale: number
  width: number
  height: number
  radius: number
}

export function fitDeviceFrame(
  device: PreviewDevice,
  rotated: boolean,
  panel: { width: number; height: number }
): DeviceFrameFit {
  if (device.width === null || device.height === null) {
    return { scale: 1, width: panel.width, height: panel.height, radius: 0 }
  }
  const rawW = rotated ? device.height : device.width
  const rawH = rotated ? device.width : device.height
  const scale = rawW > 0 && rawH > 0 ? Math.min(1, panel.width / rawW, panel.height / rawH) : 1
  return {
    scale,
    width: Math.floor(rawW * scale),
    height: Math.floor(rawH * scale),
    radius: device.id === 'ipad-mini' ? 20 : 28
  }
}

export interface DeviceMenuProps {
  ownerKey: string
  tabId: string
  deviceId: string | null
  rotated: boolean
  onChange?: (next: { deviceId: string | null; rotated: boolean }) => void
}

export function DeviceMenu({
  ownerKey,
  tabId,
  deviceId,
  rotated,
  onChange
}: DeviceMenuProps): ReactElement {
  const { t } = useTranslation('code')
  const active =
    PREVIEW_DEVICES.find(device => device.id === (deviceId ?? 'desktop')) ?? PREVIEW_DEVICES[0]
  const isEmulated = active.id !== 'desktop' && active.width !== null && active.height !== null
  const shownWidth = isEmulated ? (rotated ? active.height : active.width) : null
  const shownHeight = isEmulated ? (rotated ? active.width : active.height) : null

  const triggerText = isEmulated
    ? t('deviceEmulation.activeLabel', {
        name: active.name,
        width: shownWidth,
        height: shownHeight
      })
    : t('deviceEmulation.desktop')

  const Icon =
    active.id === 'desktop' ? Monitor : active.id === 'ipad-mini' ? Tablet : Smartphone

  const options: MenuRadioOption[] = PREVIEW_DEVICES.map(device => {
    if (device.id === 'desktop' || device.width === null || device.height === null) {
      return { value: 'desktop', label: t('deviceEmulation.desktop') }
    }
    return {
      value: device.id,
      label: device.name,
      hint: device.touch
        ? t('deviceEmulation.menuHintTouch', { width: device.width, height: device.height })
        : t('deviceEmulation.menuHintPlain', { width: device.width, height: device.height })
    }
  })

  const applyChoice = (nextValue: string): void => {
    const nextDeviceId = nextValue === 'desktop' ? null : nextValue
    const nextRotated = nextDeviceId === null ? false : rotated
    onChange?.({ deviceId: nextDeviceId, rotated: nextRotated })
    void window.oxe?.browserPreview?.setDevice?.({
      ownerKey,
      tabId,
      deviceId: nextDeviceId,
      rotated: nextRotated
    })
  }

  const handleRotate = (): void => {
    if (!isEmulated) return
    const nextRotated = !rotated
    onChange?.({ deviceId: active.id, rotated: nextRotated })
    void window.oxe?.browserPreview?.setDevice?.({
      ownerKey,
      tabId,
      deviceId: active.id,
      rotated: nextRotated
    })
  }

  return (
    <span className="web-preview-device-controls">
      <Menu
        label={t('deviceEmulation.menuLabel')}
        trigger={
          <Button variant="ghost" size="sm">
            <Icon size={14} aria-hidden="true" />
            <span>{triggerText}</span>
          </Button>
        }
        items={[
          {
            type: 'radio',
            value: active.id,
            options,
            onValueChange: applyChoice
          }
        ]}
      />
      {isEmulated ? (
        <IconButton
          label={t('deviceEmulation.rotate')}
          icon={<RotateCw size={14} />}
          size="sm"
          onClick={handleRotate}
        />
      ) : null}
    </span>
  )
}
