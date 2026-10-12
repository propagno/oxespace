export interface DocumentationStep {
  id: string
  title: string
  instruction: string
  state: 'pending' | 'captured' | 'verified'
  artifactId?: string
  evidence?: string
}
export interface DocumentationArtifact {
  id: string
  stepId: string
  filename: string
  sha256: string
  capturedAt: number
  pageUrl: string
  width: number
  height: number
  redactionCount: number
}
export interface DocumentationJob {
  id: string
  project: string
  title: string
  revision: number
  createdAt: number
  updatedAt: number
  steps: DocumentationStep[]
  artifacts: DocumentationArtifact[]
  notes: string
}
export interface DocumentationOperation {
  id: string
  requestKey?: string
  jobId: string
  kind: 'capture' | 'export'
  state: 'running' | 'succeeded' | 'failed' | 'interrupted'
  createdAt: number
  updatedAt: number
  result?: unknown
  error?: string
}
