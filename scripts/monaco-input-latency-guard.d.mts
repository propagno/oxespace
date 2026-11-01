import type { Plugin } from 'vite'

export const MONACO_PERFORMANCE_MODULE: RegExp
export function guardMonacoInputLatency(code: string, id?: string): string
export function monacoInputLatencyGuard(): Plugin & { transform(code: string, id: string): { code: string; map: null } | null }
