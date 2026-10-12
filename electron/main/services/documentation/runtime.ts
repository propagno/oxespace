import type { AppDatabase } from '../../db'
import { DocumentationService } from './documentation.service'
import { PreviewAutomation } from './preview-automation'

export function createDocumentationRuntime(db: AppDatabase, directory: string) {
  return { documents: new DocumentationService(db, directory), preview: new PreviewAutomation() }
}
