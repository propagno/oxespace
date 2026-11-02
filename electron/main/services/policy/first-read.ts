import { acceptedConfig, policyStore } from './index'
import { effectiveToolConfig, toolConfigSubject } from './tool-config'

/**
 * B7.4 (A) · The first read of a project's gated files, when the project is registered (a Code workspace, an OxeChat
 * project, a relink): its accepted version exists before any pane, terminal or session of it starts. The floor (R1) still
 * applies, so nothing that could grant is accepted silently; what needs the person is asked now, including a change an
 * earlier sweep of every root parked. Never throws: registration does not fail over policy.
 */
export function firstPolicyRead(root: string): void {
  try {
    const store = policyStore()
    store?.load(root)
    effectiveToolConfig(root)
    const subject = toolConfigSubject(root)
    acceptedConfig()?.reviewPoint([...(store?.subjects(root) ?? []), ...(subject ? [subject] : [])])
  } catch { /* the next launch or Settings read does it */ }
}
