import type { ToolEntry } from './tool-registry'

/**
 * OXE-111: Android device lifecycle MCP tools. The descriptors live here; the service and handlers load on demand so
 * the main process entry chunk stays within its byte budget.
 */
export const ANDROID_LIFECYCLE_TOOLS: ToolEntry[] = [
  {
    descriptor: {
      name: 'oxespace_android_avd_start',
      description: 'Start an installed Android Virtual Device (AVD) and wait up to 60s for boot completion. A person approves each call.',
      inputSchema: {
        type: 'object',
        properties: {
          avdName: { type: 'string', description: 'Installed AVD name from the Android SDK.' }
        },
        required: ['avdName'],
        additionalProperties: false
      }
    },
    requiresWorkspace: false,
    handler: async (args, ctx) => (await import('./android-lifecycle-handler')).runAndroidLifecycleTool('avd_start', args, ctx)
  },
  {
    descriptor: {
      name: 'oxespace_android_apk_install',
      description: 'Install an APK file from the current workspace onto a connected Android device with Agents can see enabled. A person approves each call.',
      inputSchema: {
        type: 'object',
        properties: {
          serial: { type: 'string', description: 'Connected Android device serial.' },
          apkPath: { type: 'string', description: 'Absolute path to an .apk file inside the current workspace.' }
        },
        required: ['serial', 'apkPath'],
        additionalProperties: false
      }
    },
    requiresWorkspace: true,
    handler: async (args, ctx) => (await import('./android-lifecycle-handler')).runAndroidLifecycleTool('apk_install', args, ctx)
  },
  {
    descriptor: {
      name: 'oxespace_android_app_launch',
      description: 'Launch an installed Android app package on a connected device with Agents can see enabled. A person approves each call.',
      inputSchema: {
        type: 'object',
        properties: {
          serial: { type: 'string', description: 'Connected Android device serial.' },
          packageName: { type: 'string', description: 'Android application package name (e.g. com.example.app).' }
        },
        required: ['serial', 'packageName'],
        additionalProperties: false
      }
    },
    requiresWorkspace: false,
    handler: async (args, ctx) => (await import('./android-lifecycle-handler')).runAndroidLifecycleTool('app_launch', args, ctx)
  },
  {
    descriptor: {
      name: 'oxespace_android_logcat_tail',
      description: 'Read the last lines (1 to 500, default 100, capped at 64 KB) of logcat from a connected Android device with Agents can see enabled.',
      inputSchema: {
        type: 'object',
        properties: {
          serial: { type: 'string', description: 'Connected Android device serial.' },
          maxLines: { type: 'number', description: 'Number of lines to return (1-500, default 100).' },
          packageName: { type: 'string', description: 'Optional Android package name to filter by PID.' },
          tag: { type: 'string', description: 'Optional logcat tag filter.' }
        },
        required: ['serial'],
        additionalProperties: false
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false }
    },
    requiresWorkspace: false,
    handler: async (args, ctx) => (await import('./android-lifecycle-handler')).runAndroidLifecycleTool('logcat_tail', args, ctx)
  }
]
