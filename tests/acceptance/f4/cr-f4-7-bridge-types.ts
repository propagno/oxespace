/**
 * CR-F4-7 (TECH LEAD 09/11, A13–A18, A54, A62): the window bridge's place calls, checked by the compiler. Not a test
 * file: cr-f4-7-place-ipc.test.ts runs `tsc -p tsconfig.cr-f4-7.json` over it, so a missing method, or one whose
 * shape the renderer cannot take, fails that test. Each line names the renderer type that reads the bridge.
 */
import type { OxeApi } from '../../../shared/types/ipc'
import type {
  ThreadCollision,
  ThreadPane,
  ThreadPathResolution,
  ThreadPlace,
  ThreadPlaceActionResult,
  ThreadPlaceDiff,
  ThreadPlaceDriftAnswer,
  ThreadPlaceReadResult,
  ThreadPlaces,
  ThreadPlaceUndoInput,
  ThreadPlaceUndoResult
} from '../../../shared/types/thread-places'
import type { MainMessage } from '../../../shared/messages'
import type { PlacesBridge } from '../../../src/components/Threads/placesModel'
import type { ThreadPlaceApi } from '../../../src/components/Threads/OutsideFileTab'
import type { ThreadCollision as RendererCollision } from '../../../src/components/Threads/CollisionChips'
import type { AgentSummary } from '../../../src/components/Threads/pullRequestModel'

type Bridge = NonNullable<OxeApi['thread']>
type PlaceKeys = 'places' | 'placeDiff' | 'placeRead' | 'resolvePath' | 'placeDriftAnswer' | 'placeUndo' | 'placeRestore' | 'placeDiscard'
  | 'panes' | 'collisions' | 'agentSummary' | 'onPlacesChanged'
/** Every call is declared on the bridge (ThreadApi); a missing key is a compile error here. */
type Exposed = Required<Pick<Bridge, PlaceKeys>>

/** Both ways assignable: the bridge's type and main's type say the same thing. */
type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false
function same<T extends true>(): T | undefined { return undefined }
type Result<K extends PlaceKeys> = Exposed[K] extends (...args: never[]) => Promise<infer R> ? R : never

// What main's ThreadOrchestrator returns (shared/types/thread-places.ts), unchanged by the bridge.
same<Same<Result<'places'>, ThreadPlaces>>()
same<Same<Result<'placeDiff'>, ThreadPlaceDiff>>()
same<Same<Result<'placeRead'>, ThreadPlaceReadResult>>()
same<Same<Result<'resolvePath'>, ThreadPathResolution>>()
same<Same<Result<'placeDriftAnswer'>, { ok: true; place: ThreadPlace } | { ok: false; refusal: MainMessage }>>()
same<Same<Result<'placeUndo'>, ThreadPlaceUndoResult>>()
same<Same<Result<'placeRestore'>, ThreadPlaceActionResult>>()
same<Same<Result<'placeDiscard'>, ThreadPlaceActionResult>>()
same<Same<Result<'panes'>, ThreadPane[]>>()
same<Same<Result<'collisions'>, ThreadCollision[]>>()

// The arguments the renderer passes (84440c3c's callers) are accepted.
declare const bridge: Exposed
declare const answer: ThreadPlaceDriftAnswer
declare const undo: ThreadPlaceUndoInput
void bridge.places('thread-A')
void bridge.placeDiff('thread-A', 'place-1')
void bridge.placeRead('thread-A', 'place-1', 'notes/a.md')
void bridge.resolvePath('thread-A', 'src/a.ts', { turnId: 'turn-1' })
void bridge.resolvePath('thread-A', 'src/a.ts', {})
void bridge.placeDriftAnswer('thread-A', 'place-1', answer)
void bridge.placeUndo('thread-A', 'place-1', undo)
void bridge.placeUndo('thread-A', 'place-1', { path: 'src/a.ts', hunk: '@@ -1 +1 @@', seenMtime: 1 })
void bridge.placeRestore('thread-A', 'token-1')
void bridge.placeDiscard('thread-A', 'place-1', { confirmed: true })
void bridge.panes('thread-A')
void bridge.collisions('thread-A')
void bridge.agentSummary('thread-A')
const off: () => void = bridge.onPlacesChanged((event: { threadId: string }) => { void event.threadId })
void off

// The renderer's own bridge types read the real bridge: PlacesChanges, PlaceDriftCard (placesModel), OutsideFileTab and
// PathLink (ThreadPlaceApi), CollisionChips, PullRequestTab.
export const placesBridge: PlacesBridge = bridge
export const placeApi: ThreadPlaceApi = bridge
export const collisionBridge: {
  collisions?: (threadId: string) => Promise<RendererCollision[] | null | undefined>
  onPlacesChanged?: (listener: (event: { threadId?: string } | undefined) => void) => () => void
} = bridge
export const summaryBridge: { agentSummary?: (threadId: string) => Promise<AgentSummary | null | undefined> } = bridge
