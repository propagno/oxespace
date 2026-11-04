/* Shapes of the playground's mock data. Loosely modeled on the app's thread, activity and mode records. */
export type ProviderId = 'claude' | 'codex'
export type Access = 'read' | 'edit' | 'full'
export type TaskStatus = 'needs' | 'run' | 'review' | 'err' | 'done' | 'idle'
export interface Project { id: string; name: string; path: string; stack: string; branch: string; remote: string }
export interface Provider { id: ProviderId; name: string; initial: string; account: string; plan: string; models: string[]; efforts: string[]; status: string }
export interface Counts { terminal: number; queries: number; requests: number; containers: number; changes: number; pr: number }
export interface Task {
  id: string; key: string; title: string; project: string; prov: ProviderId; model: string; effort: string; access: Access
  status: TaskStatus; branch: string; worktree: boolean; started: string; mins: number; cost: number; costEst?: boolean
  ctx: [number, string, string]; counts: Counts; gate?: string | null; pr?: number; now: string; pinned?: boolean; ask?: string | null
}
/** [kind, verb, target, meta, detail?, running?] — kind: read | edit | run | fail | done */
export type ToolRow = [string, string, string, string, string?, boolean?]
export interface ConvItem {
  you?: string; agent?: string; at?: string; files?: string[]; tools?: ToolRow[]; ck?: number; label?: string
  gate?: string; done?: string; how?: string; err?: string; sys?: string
  images?: string[]; think?: [number, string]; todos?: [string, string][]; code?: [string, string, string]
  sub?: { name: string; task: string; secs: number; rows: ToolRow[]; result: string }
  plan?: { steps: string[]; state: string; at?: string }
  cmd?: { cmd: string; cwd: string; why: string; state: string; at: string }
  edit?: { path: string; diff: string; state: string; at: string }
  bg?: { id: string; cmd: string; started: string; lines: string[] }
  paths?: string[]; retry?: string; compact?: string; ask?: string; answered?: [string, string][]
  summary?: { text: string; files: [string, number, number][] }
}
export interface Approval {
  id: string; task: string; kind: 'db' | 'box' | 'net'; title: string; verb: string; why: string; where: string; whereSub: string
  rows: string; rowsSub: string; undo: boolean; undoSub: string; irreversible: boolean; risk: 'high' | 'medium' | 'low'
  sql: string; lang?: 'shell'; cols?: string[]; sample?: (string | [string, string])[][]; snapshot: string | null
}
export interface Checkpoint { n: number; at: string; label: string; files: number ; state?: 'ok' | 'failed' }
export interface Connection { id: string; name: string; engine: string; env: string; host: string; db: string; agent: string; status: string; tables: number }
export interface Query { id: string; task: string; by: ProviderId; conn: string; at: string; ms: number; rows: number; kind: string; status: string; sql: string; cols: string[]; data: string[][]; note?: string }
export interface Collection { id: string; name: string; agent: string; reqs: string[] }
export interface Env { id: string; name: string; vars: string[][]; locked?: boolean }
export interface Req {
  id: string; name: string; method: string; url: string; env: string; task?: string; by?: ProviderId; at?: string; status: number; ms: number; size: string
  blocked?: boolean; reqBody: string; resBody: string; headers: string[][]; resHeaders: string[][]
}
export interface Container { id: string; name: string; image: string; status: string; up: string; cpu: string; mem: string; ports: string; stack: string; task: string; vol?: string }
export interface Term { id: string; name: string; shell: string; cwd: string; by: string; lines: string[][] }
export interface FileChange { path: string; add: number; del: number; isNew?: boolean; hunks: string[][] }
export interface PR { n: number; task: string; title: string; state: string; base: string; head: string; commits: number; files: number; add: number; del: number; checks: string[][]; reviewers: string[][]; body: string }
export interface Notice { id: string; kind: string; task: string; text: string; at: string }
