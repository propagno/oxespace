import type { AgentProvider } from './agent'

export interface ModelDefinition {
  id: string
  label: string
  provider: AgentProvider
  cliFlag: string         // CLI flag value passed via --model
  contextLimit: number    // input + output tokens budget
  hint: string             // short user-facing description
  tier: 'flagship' | 'balanced' | 'fast'
  inputCostPerMTok?: number   // USD per million input tokens
  outputCostPerMTok?: number  // USD per million output tokens
}

export const MODEL_REGISTRY: ModelDefinition[] = [
  // Claude family — Opus/Sonnet 4.x usam janela estendida de 1M tokens via caching
  // (Pro/Enterprise). Haiku permanece em 200k.
  {
    id: 'claude-opus-4-7',
    label: 'Opus 4.7',
    provider: 'claude',
    cliFlag: 'claude-opus-4-7',
    contextLimit: 1_000_000,
    hint: 'Reasoning de ponta. Janela de 1M tokens.',
    tier: 'flagship',
    inputCostPerMTok: 15,
    outputCostPerMTok: 75
  },
  {
    id: 'claude-sonnet-4-6',
    label: 'Sonnet 4.6',
    provider: 'claude',
    cliFlag: 'claude-sonnet-4-6',
    contextLimit: 1_000_000,
    hint: 'Equilíbrio ideal. Janela de 1M tokens.',
    tier: 'balanced',
    inputCostPerMTok: 3,
    outputCostPerMTok: 15
  },
  {
    id: 'claude-haiku-4-5',
    label: 'Haiku 4.5',
    provider: 'claude',
    cliFlag: 'claude-haiku-4-5-20251001',
    contextLimit: 200_000,
    hint: 'Rápido e barato. Janela padrão de 200k.',
    tier: 'fast',
    inputCostPerMTok: 0.8,
    outputCostPerMTok: 4
  },
  // OpenAI / Codex family
  {
    id: 'gpt-5',
    label: 'GPT-5',
    provider: 'codex',
    cliFlag: 'gpt-5',
    contextLimit: 256_000,
    hint: 'Modelo principal da OpenAI.',
    tier: 'flagship'
  },
  {
    id: 'gpt-5-mini',
    label: 'GPT-5 Mini',
    provider: 'codex',
    cliFlag: 'gpt-5-mini',
    contextLimit: 128_000,
    hint: 'Versão econômica do GPT-5.',
    tier: 'fast'
  },
  // Gemini family
  {
    id: 'gemini-2-5-pro',
    label: 'Gemini 2.5 Pro',
    provider: 'gemini',
    cliFlag: 'gemini-2.5-pro',
    contextLimit: 1_000_000,
    hint: 'Contexto enorme (1M tokens).',
    tier: 'flagship'
  },
  {
    id: 'gemini-2-5-flash',
    label: 'Gemini 2.5 Flash',
    provider: 'gemini',
    cliFlag: 'gemini-2.5-flash',
    contextLimit: 1_000_000,
    hint: 'Rápido com contexto enorme.',
    tier: 'fast'
  },
  // Cursor family — Cursor Agent CLI roteia para o composer model selecionado na conta.
  {
    id: 'cursor-composer',
    label: 'Cursor Composer',
    provider: 'cursor',
    cliFlag: 'composer',
    contextLimit: 200_000,
    hint: 'Modelo padrão do Cursor Agent (composer).',
    tier: 'balanced'
  },
  {
    id: 'cursor-composer-fast',
    label: 'Cursor Composer Fast',
    provider: 'cursor',
    cliFlag: 'composer-fast',
    contextLimit: 200_000,
    hint: 'Variante rápida do composer.',
    tier: 'fast'
  }
]

export function getModelsForProvider(provider: AgentProvider): ModelDefinition[] {
  return MODEL_REGISTRY.filter((m) => m.provider === provider)
}

export function getModelById(id: string): ModelDefinition | null {
  return MODEL_REGISTRY.find((m) => m.id === id) ?? null
}

export function providerSupportsModelSwitch(provider: AgentProvider): boolean {
  return MODEL_REGISTRY.some((m) => m.provider === provider)
}
