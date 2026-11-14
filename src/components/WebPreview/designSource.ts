import { designSearchTerms, designSourceCandidates, type DesignGrabSource } from '../../../shared/design-source'
import type { DesignGrabContext, DesignGrabPayload } from '../../../shared/types/design-mode'

/** Where an element can be written. Styles and data come after markup: the person picked what they see. */
const SOURCE_GLOBS = ['*.{tsx,jsx,vue,svelte,astro,html,htm,mdx,ts,js,mjs,css,scss,less}', '!*.min.*', '!dist/**', '!build/**', '!out/**', '!coverage/**']
const MARKUP = /\.(tsx|jsx|vue|svelte|astro|html?|mdx)$/i
/** A term found in more files than this says nothing about where the element is. */
const MAX_SEARCH_FILES = 5

interface Project { id: string; rootPath: string }
type Located = Pick<DesignGrabContext, 'source' | 'candidates' | 'components'>

/**
 * The file of the project where the picked element is written.
 * First what the page's framework told (kept only when that file is in the project), then a search of the project for
 * the element's id, own text or most specific class. Nothing found is an answer too: the grab goes without a source.
 */
export async function locateDesignSource(payload: DesignGrabPayload, project: Project): Promise<Located> {
  const components = payload.probe?.components ?? []
  const nothing: Located = { source: null, candidates: [], components }
  if (!project.rootPath) return nothing

  const told = payload.probe ? designSourceCandidates(payload.probe, project.rootPath) : []
  if (told.length > 0) {
    const listed = await window.oxe.search.listFiles({ workspaceId: project.id, rootPath: project.rootPath }).catch(() => null)
    const known = new Map((listed && !listed.error ? listed.files : []).map(file => [file.toLowerCase(), file]))
    const inProject = told.flatMap(item => { const file = known.get(item.file.toLowerCase()); return file ? [{ ...item, file }] : [] })
    if (inProject.length > 0) return { source: inProject[0], candidates: inProject.slice(1, 3), components }
  }

  for (const term of designSearchTerms(payload)) {
    const query = term.kind === 'id' ? `id="${term.query}"` : term.query
    const result = await window.oxe.search.run({ workspaceId: project.id, rootPath: project.rootPath, query, caseSensitive: true, globs: SOURCE_GLOBS }).catch(() => null)
    if (!result || result.error || result.files.length === 0 || result.files.length > MAX_SEARCH_FILES) continue
    const found: DesignGrabSource[] = [...result.files]
      .sort((a, b) => Number(MARKUP.test(b.path)) - Number(MARKUP.test(a.path)))
      .map(file => ({ origin: 'search' as const, file: file.path, line: file.matches[0]?.lineNumber ?? null, column: null, component: components[0] ?? null, approximate: true }))
    return { source: found[0], candidates: found.slice(1, 3), components }
  }
  return nothing
}
