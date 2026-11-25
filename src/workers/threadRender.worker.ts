import { parseThreadMarkdown, type ThreadHastRoot } from '../components/Threads/threadRenderCore'

export interface ThreadRenderRequest {
  id: number
  text: string
}

export interface ThreadRenderResponse {
  id: number
  tree: ThreadHastRoot
}

interface RenderWorkerScope {
  onmessage: ((event: MessageEvent<ThreadRenderRequest>) => void) | null
  postMessage: (message: ThreadRenderResponse) => void
}

const workerScope = self as unknown as RenderWorkerScope

workerScope.onmessage = (event: MessageEvent<ThreadRenderRequest>) => {
  const { id, text } = event.data
  workerScope.postMessage({ id, tree: parseThreadMarkdown(text) })
}
