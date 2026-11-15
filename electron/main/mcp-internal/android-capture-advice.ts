import { AndroidCaptureError, type AndroidCaptureFailure } from '../services/android/android-devices'

/**
 * What deviceScreenshot does when a capture throws. Its own module, loaded only when a capture fails, so this
 * handling and its text stay out of the main process's entry chunk.
 */

/** The cause of a failed Android capture and what the person or agent can do next. */
export function captureAdvice(reason: AndroidCaptureFailure, serial: string): string {
  switch (reason) {
    case 'adb-missing':
      return 'adb was not found on this computer. Install the Android SDK platform-tools and set ANDROID_HOME or ANDROID_SDK_ROOT, or add platform-tools to PATH, then try again.'
    case 'no-device':
      return `No Android device is connected (serial "${serial}"). Connect a device with USB debugging on, or start an emulator from the Android device panel, then try again.`
    case 'server-down':
      return 'The adb server is not running and could not be started. Run "adb start-server" or open the Android device panel, then try again.'
    default:
      return 'The Android screenshot failed. Check the device in the Android device panel (on, unlocked and authorized for debugging), then try again.'
  }
}

/**
 * After a capture threw: anything but an AndroidCaptureError is thrown again. When the adb server is down, only the
 * server is started (never an emulator, never kill-server) and the capture is tried once more; otherwise the advice.
 */
export async function recoverAndroidCapture<T>(error: unknown, serial: string, take: () => Promise<T>, startAdbServer: () => Promise<boolean>): Promise<{ shot: T; advice?: undefined } | { advice: string }> {
  if (!(error instanceof AndroidCaptureError)) throw error
  if (error.reason !== 'server-down') return { advice: captureAdvice(error.reason, serial) }
  if (!await startAdbServer()) return { advice: captureAdvice('server-down', serial) }
  try {
    return { shot: await take() }
  } catch (retryError) {
    if (!(retryError instanceof AndroidCaptureError)) throw retryError
    return { advice: captureAdvice(retryError.reason, serial) }
  }
}
