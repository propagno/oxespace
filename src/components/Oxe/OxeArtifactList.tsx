import { FileText } from 'lucide-react'
import type { ReactElement } from 'react'
import type { OxeArtifactGroup, OxeArtifactSummary } from '../../../shared/types/ipc'

interface OxeArtifactListProps {
  artifacts: OxeArtifactSummary[]
  onOpenArtifact: (relativePath: string) => void
}

export function OxeArtifactList({ artifacts, onOpenArtifact }: OxeArtifactListProps): ReactElement {
  const existingArtifacts = artifacts.filter((artifact) => artifact.exists)

  if (existingArtifacts.length === 0) {
    return <div className="oxe-panel-empty">No OXE artifacts found</div>
  }

  return (
    <div className="oxe-artifact-list" aria-label="OXE artifacts">
      {groupArtifacts(existingArtifacts).map(([group, groupArtifacts]) => (
        <section key={group} className="oxe-artifact-group" aria-label={`${labelForGroup(group)} artifacts`}>
          <div className="oxe-artifact-group-title">{labelForGroup(group)}</div>
          {groupArtifacts.map((artifact) => (
            <button key={artifact.relativePath} type="button" className="oxe-artifact-item" onClick={() => onOpenArtifact(artifact.relativePath)}>
              <FileText size={13} aria-hidden="true" />
              <span>{artifact.label}</span>
              <small>{artifact.relativePath}</small>
            </button>
          ))}
        </section>
      ))}
    </div>
  )
}

function groupArtifacts(artifacts: OxeArtifactSummary[]): Array<[OxeArtifactGroup, OxeArtifactSummary[]]> {
  const groups = new Map<OxeArtifactGroup, OxeArtifactSummary[]>()
  for (const artifact of artifacts) {
    const group = artifact.group ?? 'operational'
    groups.set(group, [...(groups.get(group) ?? []), artifact])
  }
  return Array.from(groups.entries())
}

function labelForGroup(group: OxeArtifactGroup): string {
  switch (group) {
    case 'operational':
      return 'Operational State'
    case 'rationality':
      return 'Rationality Packs'
    case 'runtime':
      return 'Runtime'
    case 'evidence':
      return 'Evidence'
    case 'context':
      return 'Context'
    case 'product':
      return 'Product Source'
    case 'release':
      return 'Release'
    default:
      return 'Artifacts'
  }
}
