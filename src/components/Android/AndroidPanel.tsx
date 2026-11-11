import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactElement } from 'react'
import { ArrowLeft, Camera, Circle, RotateCw, Smartphone, Square, Usb, WifiOff } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { AndroidMirrorDevice, AndroidMirrorFrame, AndroidMirrorStatus } from '../../../shared/types/ipc'
import { Button, IconButton } from '../../ui/Button'
import { EmptyState, Spinner, StatusDot } from '../../ui/Display'
import { Switch } from '../../ui/Field'
import { Menu } from '../../ui/Overlay'
import { toast } from '../../ui/Toast'
import './AndroidPanel.css'

function friendlyAvdName(avd: string): string {
  return avd.replace(/_API_\d+$/i, '').replace(/_/g, ' ').trim() || avd
}

function mapDeviceCoords(
  clientX: number,
  clientY: number,
  rect: DOMRect,
  devWidth: number,
  devHeight: number
): { x: number; y: number } | null {
  if (rect.width <= 0 || rect.height <= 0 || devWidth <= 0 || devHeight <= 0) return null
  const px = clientX - rect.left
  const py = clientY - rect.top
  if (px < 0 || py < 0 || px > rect.width || py > rect.height) return null
  const x = Math.min(devWidth - 1, Math.max(0, Math.round((px / rect.width) * devWidth)))
  const y = Math.min(devHeight - 1, Math.max(0, Math.round((py / rect.height) * devHeight)))
  return { x, y }
}

export function AndroidPanel(): ReactElement {
  const { t } = useTranslation('code')
  const [status, setStatus] = useState<AndroidMirrorStatus | null>(null)
  const [selectedSerial, setSelectedSerial] = useState<string | null>(null)
  const [lastConnected, setLastConnected] = useState<{ serial: string; name: string } | null>(null)
  const [frames, setFrames] = useState<Record<string, { width: number; height: number }>>({})
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const pointerDownRef = useRef<{ clientX: number; clientY: number; time: number } | null>(null)

  const refresh = useCallback(async (): Promise<void> => {
    const api = window.oxe?.android
    if (!api) return
    const next = await api.status()
    setStatus(next)
    setSelectedSerial(prev => {
      const keep = prev && next.devices.some(device => device.serial === prev) ? prev : (next.devices[0]?.serial ?? null)
      const chosen = next.devices.find(device => device.serial === keep)
      if (chosen?.state === 'device') {
        setLastConnected({ serial: chosen.serial, name: chosen.name })
      }
      return keep
    })
  }, [])

  useEffect(() => {
    const api = window.oxe?.android
    if (!api) return
    let cancelled = false
    void api.status().then(next => {
      if (cancelled) return
      setStatus(next)
      const first = next.devices[0]
      if (first) {
        setSelectedSerial(prev => prev ?? first.serial)
        if (first.state === 'device') {
          setLastConnected({ serial: first.serial, name: first.name })
        }
      }
    })
    const offChanged = api.onChanged(() => {
      if (!cancelled) void refresh()
    })
    const offFrame = api.onFrame((frame: AndroidMirrorFrame) => {
      if (cancelled) return
      setFrames(prev => {
        const existing = prev[frame.serial]
        if (existing && existing.width === frame.width && existing.height === frame.height) return prev
        return { ...prev, [frame.serial]: { width: frame.width, height: frame.height } }
      })
      const canvas = canvasRef.current
      if (canvas && typeof URL.createObjectURL === 'function') {
        try {
          const ctx = canvas.getContext('2d')
          if (ctx && frame.data.byteLength > 0 && typeof createImageBitmap === 'function') {
            const bytes = new Uint8Array(frame.data.byteLength)
            bytes.set(frame.data)
            const blob = new Blob([bytes], { type: 'image/png' })
            void createImageBitmap(blob).then(bitmap => {
              ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
              bitmap.close()
            }).catch(() => {})
          }
        } catch {
          // Canvas context unavailable in headless/jsdom tests.
        }
      }
    })
    return () => {
      cancelled = true
      offChanged()
      offFrame()
    }
  }, [refresh])

  const devices = status?.devices ?? []
  const activeSerial =
    selectedSerial && devices.some(device => device.serial === selectedSerial)
      ? selectedSerial
      : (devices[0]?.serial ?? null)
  const selectedDevice: AndroidMirrorDevice | null =
    devices.find(device => device.serial === activeSerial) ?? null

  useEffect(() => {
    if (!selectedDevice || selectedDevice.state !== 'device') return
    void window.oxe?.android?.connect({ serial: selectedDevice.serial })
  }, [selectedDevice])

  const formatDeviceLabel = (device: AndroidMirrorDevice): string => {
    const kind =
      device.kind === 'emulator'
        ? t('android.kindEmulator')
        : device.kind === 'wifi'
          ? t('android.kindWifi')
          : t('android.kindUsb')
    return device.api
      ? t('android.deviceWithApi', { name: device.name, kind, api: device.api })
      : t('android.devicePlain', { name: device.name, kind })
  }

  const handleSelectDevice = (serial: string): void => {
    setSelectedSerial(serial)
    const chosen = devices.find(device => device.serial === serial)
    if (chosen?.state === 'device') {
      setLastConnected({ serial: chosen.serial, name: chosen.name })
    }
  }

  const handleReconnect = async (serial?: string): Promise<void> => {
    const api = window.oxe?.android
    if (!api) return
    if (serial) await api.connect({ serial }).catch(() => {})
    await refresh()
  }

  const handleRotate = async (): Promise<void> => {
    if (!selectedDevice) return
    await window.oxe?.android?.rotate({ serial: selectedDevice.serial })
  }

  const handleScreenshot = async (): Promise<void> => {
    if (!selectedDevice) return
    const result = await window.oxe?.android?.screenshot({ serial: selectedDevice.serial })
    if (result?.name) {
      toast({ title: t('android.savedScreenshot', { name: result.name }) })
    }
  }

  const handleKey = async (keycode: number): Promise<void> => {
    if (!selectedDevice) return
    await window.oxe?.android?.key({ serial: selectedDevice.serial, keycode })
  }

  const handleAgentsCanSee = async (serial: string, value: boolean): Promise<void> => {
    await window.oxe?.android?.setAgentsCanSee({ serial, value })
    await refresh()
  }

  const frameSize = (selectedDevice ? frames[selectedDevice.serial] : undefined) ?? {
    width: 1080,
    height: 2400
  }

  const handlePointerDown = (event: ReactPointerEvent<HTMLCanvasElement>): void => {
    pointerDownRef.current = {
      clientX: event.clientX,
      clientY: event.clientY,
      time: Date.now()
    }
  }

  const handlePointerUp = (event: ReactPointerEvent<HTMLCanvasElement>): void => {
    const down = pointerDownRef.current
    pointerDownRef.current = null
    if (!down || !selectedDevice) return
    const rect = event.currentTarget.getBoundingClientRect()
    const start = mapDeviceCoords(down.clientX, down.clientY, rect, frameSize.width, frameSize.height)
    const end = mapDeviceCoords(event.clientX, event.clientY, rect, frameSize.width, frameSize.height)
    if (!start || !end) return
    const moved = Math.hypot(event.clientX - down.clientX, event.clientY - down.clientY)
    if (moved >= 12) {
      const durationMs = Math.max(80, Math.min(1000, Date.now() - down.time))
      void window.oxe?.android?.swipe({
        serial: selectedDevice.serial,
        x1: start.x,
        y1: start.y,
        x2: end.x,
        y2: end.y,
        durationMs
      })
    } else {
      void window.oxe?.android?.tap({
        serial: selectedDevice.serial,
        x: end.x,
        y: end.y
      })
    }
  }

  if (!status) {
    return (
      <div className="android-panel">
        <div className="android-stage">
          <Spinner />
        </div>
      </div>
    )
  }

  if (status.adb === 'missing') {
    return (
      <div className="android-panel">
        <div className="android-stage">
          <EmptyState
            icon={<Smartphone size={20} />}
            title={t('android.adbMissingTitle')}
            actions={
              <Button
                variant="secondary"
                size="sm"
                onClick={() => toast({ title: t('android.adbInstallHint') })}
              >
                {t('android.howToInstall')}
              </Button>
            }
          >
            {t('android.adbMissingDetail')}
          </EmptyState>
        </div>
      </div>
    )
  }

  if (devices.length === 0 && lastConnected) {
    return (
      <div className="android-panel">
        <div className="android-stage">
          <EmptyState
            icon={<WifiOff size={20} />}
            title={t('android.lostTitle', { name: lastConnected.name })}
            actions={
              <Button
                variant="primary"
                size="sm"
                onClick={() => void handleReconnect(lastConnected.serial)}
              >
                {t('android.reconnect')}
              </Button>
            }
          >
            {t('android.lostDetail')}
          </EmptyState>
        </div>
      </div>
    )
  }

  if (devices.length === 0 || !selectedDevice) {
    const firstAvd = status.avds[0]
    return (
      <div className="android-panel">
        <div className="android-stage">
          <EmptyState
            icon={<Smartphone size={20} />}
            title={t('android.noDeviceTitle')}
            actions={
              firstAvd ? (
                <Button
                  variant="primary"
                  size="sm"
                  onClick={() => void window.oxe?.android?.startEmulator(firstAvd)}
                >
                  {t('android.startEmulatorNamed', { name: friendlyAvdName(firstAvd) })}
                </Button>
              ) : undefined
            }
          >
            {t('android.noDeviceDetail')}
          </EmptyState>
        </div>
      </div>
    )
  }

  const renderDeviceNonReadyState = (device: AndroidMirrorDevice): ReactElement | null => {
    if (device.state === 'offline') {
      return (
        <EmptyState
          icon={<WifiOff size={20} />}
          title={t('android.lostTitle', { name: device.name })}
          actions={
            <Button variant="primary" size="sm" onClick={() => void handleReconnect(device.serial)}>
              {t('android.reconnect')}
            </Button>
          }
        >
          {t('android.lostDetail')}
        </EmptyState>
      )
    }
    if (device.state === 'unauthorized') {
      return (
        <EmptyState
          icon={<Usb size={20} />}
          title={t('android.unauthorizedTitle')}
          actions={
            <Button variant="primary" size="sm" onClick={() => void handleReconnect(device.serial)}>
              {t('android.reconnect')}
            </Button>
          }
        >
          {t('android.unauthorizedDetail')}
        </EmptyState>
      )
    }
    if (device.state === 'authorizing') {
      return (
        <EmptyState icon={<Usb size={20} />} title={t('android.authorizingTitle', { name: device.name })}>
          {t('android.authorizingDetail')}
        </EmptyState>
      )
    }
    if (device.state === 'no-permissions') {
      return (
        <EmptyState
          icon={<Usb size={20} />}
          title={t('android.noPermissionsTitle', { name: device.name })}
          actions={
            <>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => toast({ title: t('android.udevHint') })}
              >
                {t('android.howToSetUp')}
              </Button>
              <Button variant="primary" size="sm" onClick={() => void handleReconnect(device.serial)}>
                {t('android.reconnect')}
              </Button>
            </>
          }
        >
          {t('android.noPermissionsDetail')}
        </EmptyState>
      )
    }
    return null
  }

  const nonReady = renderDeviceNonReadyState(selectedDevice)
  const isLive = selectedDevice.state === 'device' && selectedDevice.stream === 'live'

  return (
    <div className="android-panel">
      <header className="android-toolbar">
        <Menu
          label={t('android.deviceMenu')}
          trigger={
            <Button variant="ghost" size="sm">
              <Smartphone size={14} aria-hidden="true" />
              <span>{formatDeviceLabel(selectedDevice)}</span>
            </Button>
          }
          items={[
            {
              type: 'radio',
              value: selectedDevice.serial,
              options: devices.map(device => ({
                value: device.serial,
                label: formatDeviceLabel(device)
              })),
              onValueChange: handleSelectDevice
            }
          ]}
        />

        {isLive ? (
          <span className="android-live-badge">
            <StatusDot status="success" label={t('android.live')} />
            <span>{t('android.live')}</span>
          </span>
        ) : null}

        <span className="android-toolbar-spacer" />

        {selectedDevice.state === 'device' ? (
          <>
            <IconButton
              label={t('android.rotate')}
              icon={<RotateCw size={14} />}
              size="sm"
              onClick={() => void handleRotate()}
            />
            <IconButton
              label={t('android.screenshot')}
              icon={<Camera size={14} />}
              size="sm"
              onClick={() => void handleScreenshot()}
            />
          </>
        ) : null}
      </header>

      <div className="android-stage">
        {nonReady ? (
          nonReady
        ) : isLive ? (
          <>
            <div className="android-phone-frame" style={{ borderRadius: '34px' }}>
              <canvas
                ref={canvasRef}
                role="img"
                aria-label={t('android.screenLive', { name: selectedDevice.name })}
                className="android-screen-canvas"
                width={frameSize.width}
                height={frameSize.height}
                onPointerDown={handlePointerDown}
                onPointerUp={handlePointerUp}
              />
            </div>
            <div className="android-nav-bar">
              <IconButton
                label={t('android.back')}
                icon={<ArrowLeft size={14} />}
                size="sm"
                onClick={() => void handleKey(4)}
              />
              <IconButton
                label={t('android.home')}
                icon={<Circle size={14} />}
                size="sm"
                onClick={() => void handleKey(3)}
              />
              <IconButton
                label={t('android.overview')}
                icon={<Square size={14} />}
                size="sm"
                onClick={() => void handleKey(187)}
              />
            </div>
          </>
        ) : (
          <div className="android-connecting" role="status">
            <Spinner size="sm" decorative />
            <span>{t('android.connecting', { name: selectedDevice.name })}</span>
          </div>
        )}
      </div>

      {selectedDevice.state === 'device' ? (
        <footer className="android-footer">
          <Switch
            checked={Boolean(selectedDevice.agentsCanSee)}
            onChange={value => void handleAgentsCanSee(selectedDevice.serial, value)}
            label={t('android.agentsCanSee')}
          />
          {selectedDevice.agentsCanSee ? (
            <p className="android-agents-hint">{t('android.agentsCanSeeOnHint')}</p>
          ) : null}
        </footer>
      ) : null}
    </div>
  )
}
