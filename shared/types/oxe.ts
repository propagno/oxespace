/**
 * Types for the native OXE (oxe-cc) integration.
 *
 * OXESpace treats `oxe-cc` as an EXTERNAL, independently-versioned tool — it
 * never bundles its code. We spawn the CLI with `--json` (a stable contract)
 * and read the parts we need, tolerating missing/extra fields so oxe-cc can
 * keep evolving on its own release cadence.
 */

export interface OxeDetect {
  installed: boolean
  /** e.g. "1.12.0", parsed from `oxe --version`. */
  version: string | null
}

/** Compact per-agent skills view (from `status --json --summary`). */
export interface OxeAgentSkill {
  agent: string
  skillsInstalled: boolean
}

/** Detailed per-agent skills view (from `status --json`, oxe-cc ≥ 1.13). */
export interface OxeAgentSkillDetail extends OxeAgentSkill {
  detected?: boolean
  skillsPath?: string
  status?: string
  issues?: string[]
}

/**
 * Compact, versioned projection from `oxe status --json --summary`
 * (`oxeSummarySchema`, oxe-cc ≥ 1.13). ~500 bytes vs ~100KB for the full
 * status — used on the hot path so the panel can update live (cheaply).
 */
export interface OxeStatusSummary {
  oxeSummarySchema?: number
  workspaceMode?: string | null
  phase?: string | null
  healthStatus?: string | null
  activeSession?: string | null
  nextStep?: string | null
  cursorCmd?: string | null
  reason?: string | null
  eventsCount?: number
  warningsCount?: number
  agentSkills?: OxeAgentSkill[]
}

/** What the renderer receives from the cheap summary path. */
export interface OxeSummaryResult {
  installed: boolean
  version: string | null
  isOxeProject: boolean
  summary: OxeStatusSummary | null
  /** False when the installed oxe-cc predates `--summary` (we fall back to full status). */
  supportsSummary: boolean
  error: string | null
}

/** Result of starting/looking up an embedded dashboard server. */
export interface OxeDashboardHandle {
  ok: boolean
  url: string | null
  port: number | null
  /** 'embedded' = got a JSON handle (oxe-cc ≥ 1.14); 'external' = opened in browser (fallback). */
  mode: 'embedded' | 'external' | null
  error: string | null
}

/**
 * Subset of `oxe status --json` (schema 5) that the panel consumes. Everything
 * is optional — never assume a field exists across oxe-cc versions.
 */
export interface OxeStatus {
  /** 'oxe_project' when the workspace is an OXE project. */
  workspaceMode?: string | null
  phase?: string | null
  /** 'healthy' | 'warning' | 'critical' | … */
  healthStatus?: string | null
  activeSession?: string | null
  /** Next-step keyword, e.g. 'plan' / 'execute'. */
  nextStep?: string | null
  /** Slash command to run next, e.g. '/oxe-plan --replan' — what we inject. */
  cursorCmd?: string | null
  /** Human-readable reason for the next step. */
  reason?: string | null
  artifacts?: string[]
  criticalExecutionGaps?: string[]
  planSelfEvaluation?: {
    confidence?: number
    executable?: boolean
    warnings?: string[]
  }
  /** Per-agent skills detection (oxe-cc ≥ 1.13). */
  agentSkills?: OxeAgentSkillDetail[]
}

/** What the renderer receives for a workspace's OXE state. */
export interface OxeStatusResult {
  /** oxe-cc resolved on the machine. */
  installed: boolean
  version: string | null
  /** `<workspaceRoot>/.oxe/` exists (it's an OXE project). */
  isOxeProject: boolean
  /** Parsed `oxe status --json`, when available. */
  status: OxeStatus | null
  /** Populated when the CLI failed (not when it's simply absent). */
  error: string | null
}
