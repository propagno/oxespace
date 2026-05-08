import type { OxeApi } from '../../shared/types/ipc'

declare global {
  interface Window {
    oxe: OxeApi
  }
}

export {}
