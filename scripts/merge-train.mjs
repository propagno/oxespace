// The merge train (S0.2): PRs labelled `na-fila` merge one at a time, each only after a green CI
// run on its current head, with that head up to date with main. Run by .github/workflows/merge-train.yml.
//
// Every run drives the OLDEST labelled PR one step (see `step`): unlabel it with the cause, update its
// branch with main, wait, or merge it. A merge moves on to the next PR in the same run.
//
// GITHUB_TOKEN caveat: what this token does (update a branch, merge) does not start other workflows, so the
// train dispatches the PR's CI on the updated branch and `ci.yml` on main after each merge itself.
//
// The decision is a pure function (`step`), and the GitHub calls sit behind a small `api` object, so the
// unit tests (tests/unit/merge-train.test.ts) drive both with a fake API.

import { appendFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'

export const LABEL = 'na-fila'
export const PREFIX = 'merge-train:'
export const STATE_MARKER = 'merge-train-state'
/** The workflow's own job name: its check run on a PR head is never a check the PR must pass. */
export const TRAIN_JOB_NAME = 'Merge train step'
export const CI_WORKFLOW = 'CI and Release'
/** Workflows whose run on the head must be finished before the PR can merge (when they ran for it). */
export const WATCHED_WORKFLOWS = [CI_WORKFLOW, 'Accessibility scan (axe)', 'Memory compatibility']
/**
 * Workflows the train dispatches on a branch it updated, because a GITHUB_TOKEN push starts none of them.
 * ci.yml always; the others only when they ran on the head before the update.
 */
export const DISPATCHABLE_WORKFLOWS = ['ci.yml', 'a11y-axe.yml', 'memory-compatibility.yml', 'android.yml']
export const DEFAULT_TIMEOUT_MINUTES = 60
/** How long a head may sit with no CI run at all before the train dispatches one itself. */
export const DISPATCH_GRACE_MS = 3 * 60_000
const IGNORED_CONCLUSIONS = new Set(['skipped', 'neutral'])
const STATE_RE = new RegExp(`<!-- ${STATE_MARKER} (\\{.*?\\}) -->`)

const short = (sha) => String(sha ?? '').slice(0, 7)
const time = (iso) => (iso ? Date.parse(iso) : 0)

/** The train's saved state (which head it waits on, since when, for which labelling) from its comment. */
export function parseTrainState(body) {
  const match = STATE_RE.exec(body ?? '')
  if (!match) return null
  try {
    const value = JSON.parse(match[1])
    return value && typeof value === 'object' ? value : null
  } catch {
    return null
  }
}

/** The comment body the train keeps on a PR: one line for people, the state for the next run. */
export function renderComment(message, state) {
  const line = `${PREFIX} ${message}`
  return state ? `${line}\n\n<!-- ${STATE_MARKER} ${JSON.stringify(state)} -->` : line
}

/** Oldest labelling first (then lowest number); a PR listed twice counts once, at its latest labelling. */
export function orderQueue(entries) {
  const byNumber = new Map()
  for (const entry of entries) {
    const known = byNumber.get(entry.number)
    if (!known || time(entry.labeledAt) > time(known.labeledAt)) byNumber.set(entry.number, entry)
  }
  return [...byNumber.values()].sort((a, b) => {
    const at = (e) => (e.labeledAt ? time(e.labeledAt) : Number.POSITIVE_INFINITY)
    return at(a) - at(b) || a.number - b.number
  })
}

/** The most recent item per name (by `createdAt`/`startedAt`, else the later one in the list). */
function latestByName(items) {
  const byName = new Map()
  for (const item of items) {
    const known = byName.get(item.name)
    const stamp = (x) => time(x.createdAt ?? x.startedAt)
    if (!known || stamp(item) >= stamp(known)) byName.set(item.name, item)
  }
  return [...byName.values()]
}

/**
 * One step of the train for the PR at the head of the queue.
 *
 * input: {
 *   pr: { number, draft, isFork, headSha, headRef, mergeable (true|false|null), mergeableState, changesRequested, labeledAt } | null,
 *   behindBy,                          // commits of main the head lacks
 *   runs:   [{ name, path, headSha, status, conclusion, htmlUrl, createdAt }],   // workflow runs on the head
 *   checks: [{ name, headSha, status, conclusion, htmlUrl, failedStep, startedAt }], // check runs on the head
 *   requiredChecks: string[],          // from branch protection; empty = every check run on the head
 *   trainState: { head, since, labeledAt } | null,
 *   now: ms, timeoutMinutes
 * }
 * output: { type: 'idle' | 'unlabel' | 'update' | 'dispatch' | 'wait' | 'merge', message, state, dispatch?, expectedHead? }
 */
export function step(input) {
  const { pr } = input
  if (!pr) return { type: 'idle', message: 'no pull request is labelled ' + LABEL }

  const now = input.now
  const timeoutMinutes = input.timeoutMinutes ?? DEFAULT_TIMEOUT_MINUTES
  const labeledAt = pr.labeledAt ?? null
  // A state saved for an earlier labelling (the label was removed and added again) is ignored.
  const saved = input.trainState && input.trainState.labeledAt === labeledAt ? input.trainState : null
  const since = saved && saved.head === pr.headSha && saved.since ? saved.since : new Date(now).toISOString()
  const state = { head: pr.headSha, since, labeledAt }
  if (saved?.dispatch) state.dispatch = saved.dispatch
  if (saved?.dispatchedFor) state.dispatchedFor = saved.dispatchedFor
  const unlabel = (message) => ({ type: 'unlabel', message: `left the queue: ${message}`, state: null })
  const wait = (message) => {
    if (now - time(since) > timeoutMinutes * 60_000) {
      return unlabel(`waited more than ${timeoutMinutes} minutes for CI on ${short(pr.headSha)} (${message}). Label it again to retry.`)
    }
    return { type: 'wait', message: `waiting: ${message}.`, state }
  }

  if (pr.draft) return unlabel('the pull request is a draft. Mark it ready and label it again.')
  if (pr.isFork) return unlabel('the train only merges branches of this repository.')
  if (pr.mergeable === false || pr.mergeableState === 'dirty') {
    return unlabel('it conflicts with main. Merge main into it, resolve the conflicts and label it again.')
  }
  if (pr.changesRequested) return unlabel('a review requests changes.')
  if (pr.mergeable == null) return wait('GitHub is still computing whether it can merge')

  if (input.behindBy > 0) {
    const ran = new Set((input.runs ?? []).filter((r) => r.headSha === pr.headSha).map((r) => String(r.path ?? '').split('/').pop()))
    const dispatch = DISPATCHABLE_WORKFLOWS.filter((file) => file === 'ci.yml' || ran.has(file))
    return {
      type: 'update',
      message: `updating the branch with main (${input.behindBy} commit${input.behindBy === 1 ? '' : 's'} behind); CI then runs on the new head.`,
      // The head changes with the update, so the next run starts a fresh wait.
      state: { head: null, since: new Date(now).toISOString(), labeledAt, dispatch, dispatchedFor: null },
      dispatch,
      expectedHead: pr.headSha,
    }
  }

  const head = pr.headSha
  const runs = latestByName((input.runs ?? []).filter((r) => r.headSha === head && WATCHED_WORKFLOWS.includes(r.name)))
  if (!runs.some((r) => r.name === CI_WORKFLOW)) {
    // Nothing started CI on this head (a GITHUB_TOKEN update starts no workflow, and the dispatch right after it
    // may have missed): after a short grace, so a push's own run can show up first, the train dispatches it once.
    const timedOut = wait(`${CI_WORKFLOW} has not started on ${short(head)}`)
    if (timedOut.type === 'wait' && saved?.dispatchedFor !== head && now - time(since) >= DISPATCH_GRACE_MS) {
      const dispatch = saved?.dispatch?.length ? saved.dispatch : ['ci.yml']
      return {
        type: 'dispatch',
        message: `waiting: started ${CI_WORKFLOW} on ${short(head)}.`,
        state: { ...state, dispatch, dispatchedFor: head },
        dispatch,
      }
    }
    return timedOut
  }
  const running = runs.filter((r) => r.status !== 'completed')
  if (running.length) return wait(`${running.map((r) => r.name).join(', ')} still running on ${short(head)}`)

  const checks = latestByName((input.checks ?? []).filter((c) => c.headSha === head && c.name !== TRAIN_JOB_NAME))
  const required = input.requiredChecks ?? []
  let considered
  if (required.length) {
    const missing = required.filter((name) => !checks.some((c) => c.name === name))
    if (missing.length) return wait(`required check ${missing.join(', ')} has not run on ${short(head)}`)
    considered = checks.filter((c) => required.includes(c.name))
  } else {
    considered = checks.filter((c) => !IGNORED_CONCLUSIONS.has(c.conclusion))
  }
  const pending = considered.filter((c) => c.status !== 'completed')
  if (pending.length) return wait(`${pending.map((c) => c.name).join(', ')} still running on ${short(head)}`)

  const failed = considered.find((c) => c.conclusion !== 'success' && !IGNORED_CONCLUSIONS.has(c.conclusion))
  if (failed) {
    const where = failed.failedStep ? ` at step "${failed.failedStep}"` : ''
    const link = failed.htmlUrl ? ` (${failed.htmlUrl})` : ''
    return unlabel(`"${failed.name}" ${failed.conclusion ?? 'failed'}${where} on ${short(head)}${link}. Fix it and label it again.`)
  }
  const failedRun = runs.find((r) => r.conclusion !== 'success' && !IGNORED_CONCLUSIONS.has(r.conclusion))
  if (failedRun) {
    const link = failedRun.htmlUrl ? ` (${failedRun.htmlUrl})` : ''
    return unlabel(`${failedRun.name} ended ${failedRun.conclusion ?? 'without a result'} on ${short(head)}${link}. Fix it and label it again.`)
  }

  return { type: 'merge', message: `merged ${short(head)}, green and up to date with main.`, state: null, expectedHead: head }
}

/** The train's own comments: written by a bot, starting with the prefix. */
const trainComments = (comments) => comments.filter((c) => c.isBot && typeof c.body === 'string' && c.body.startsWith(PREFIX))

/** Writes the train's comment, editing its previous one instead of adding another; unchanged text is not rewritten. */
export async function upsertComment(api, number, body) {
  const own = trainComments(await api.listComments(number))
  const previous = own[own.length - 1]
  if (!previous) return api.createComment(number, body)
  if (previous.body === body) return previous
  return api.updateComment(previous.id, body)
}

/** A GitHub refusal in a few words; a workflow file is the usual one, since GITHUB_TOKEN may not push those. */
function refusal(error) {
  const text = String(error?.message ?? error)
  if (/workflow/i.test(text) && /permission/i.test(text)) return 'it changes a file in .github/workflows, which the train token may not push'
  return text.replace(/\s+/g, ' ').slice(0, 200)
}

/** Everything `step` needs about one PR, read through the api. */
export async function loadInput(api, entry, { now, timeoutMinutes }) {
  const pr = await api.getPull(entry.number)
  if (!pr || pr.state !== 'open') return null
  const [behindBy, changesRequested, runs, checks, requiredChecks, comments] = await Promise.all([
    api.behindBy(pr.headSha),
    api.changesRequested(entry.number),
    api.listRuns(pr.headSha),
    api.listChecks(pr.headSha),
    api.requiredChecks(),
    api.listComments(entry.number),
  ])
  const own = trainComments(comments)
  return {
    pr: { ...pr, changesRequested, labeledAt: entry.labeledAt ?? null },
    behindBy,
    runs,
    checks,
    requiredChecks,
    trainState: parseTrainState(own[own.length - 1]?.body),
    now,
    timeoutMinutes,
  }
}

/**
 * Drives the queue: steps the oldest PR, and after a merge or an unlabel moves on to the next one. Stops at the
 * first PR it must wait for (or update), so only one PR at a time is being tested for a merge.
 */
export async function runTrain(
  api,
  {
    now = Date.now(),
    timeoutMinutes = DEFAULT_TIMEOUT_MINUTES,
    maxSteps = 10,
    log = () => {},
    sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    headPolls = 10,
  } = {},
) {
  const queue = orderQueue(await api.listQueue())
  const actions = []
  /** Takes the PR at the head of the queue out of it, with the cause in the train's comment. */
  const leave = async (number, cause) => {
    const message = `left the queue: ${cause}`
    actions.push({ type: 'unlabel', message, state: null, number })
    log(`#${number}: unlabel — ${message}`)
    await upsertComment(api, number, renderComment(message, null))
    await api.removeLabel(number)
    queue.shift()
  }
  while (actions.length < maxSteps) {
    const entry = queue[0]
    if (!entry) {
      actions.push({ type: 'idle', message: `no pull request is labelled ${LABEL}` })
      break
    }
    const input = await loadInput(api, entry, { now, timeoutMinutes })
    if (!input) {
      queue.shift()
      continue
    }
    const action = step(input)
    actions.push({ ...action, number: entry.number })
    log(`#${entry.number}: ${action.type} — ${action.message}`)

    if (action.type === 'unlabel') {
      await upsertComment(api, entry.number, renderComment(action.message, null))
      await api.removeLabel(entry.number)
      queue.shift()
      continue
    }
    if (action.type === 'update') {
      try {
        await api.updateBranch(entry.number, action.expectedHead)
      } catch (error) {
        // 422 with an expected_head_sha mismatch: the head moved, the next step sees it.
        if (error?.status === 422 && /expected head sha/i.test(String(error?.message))) continue
        await leave(entry.number, `GitHub refused to update the branch (${refusal(error)}). Merge main into it yourself and label it again.`)
        continue
      }
      // The update is asynchronous: dispatch only once the branch has its new head, or CI would test the old one.
      let state = action.state
      for (let poll = 0; poll < headPolls; poll++) {
        const fresh = await api.getPull(entry.number)
        if (fresh?.headSha && fresh.headSha !== action.expectedHead) {
          for (const file of action.dispatch) await api.dispatchWorkflow(file, input.pr.headRef)
          state = { ...state, head: fresh.headSha, dispatchedFor: fresh.headSha }
          break
        }
        await sleep(3000)
      }
      // When the head did not move in time, the next run sees no CI on the new head and dispatches it then.
      await upsertComment(api, entry.number, renderComment(action.message, state))
      break
    }
    if (action.type === 'dispatch') {
      for (const file of action.dispatch) await api.dispatchWorkflow(file, input.pr.headRef)
      await upsertComment(api, entry.number, renderComment(action.message, action.state))
      break
    }
    if (action.type === 'merge') {
      // Checked again right before merging: never merge on an old base. The merge itself pins the head SHA.
      if ((await api.behindBy(action.expectedHead)) > 0) continue
      try {
        await api.merge(entry.number, action.expectedHead)
      } catch (error) {
        // 409: the head moved after the green run; the next step sees the new head.
        if (error?.status === 409) continue
        await leave(entry.number, `GitHub refused the merge (${refusal(error)}). It needs a merge by hand.`)
        continue
      }
      await upsertComment(api, entry.number, renderComment(action.message, null))
      // A merge by GITHUB_TOKEN starts no push run on main, so main's CI is dispatched here.
      await api.dispatchWorkflow('ci.yml', 'main')
      queue.shift()
      continue
    }
    if (action.type === 'wait') await upsertComment(api, entry.number, renderComment(action.message, action.state))
    break
  }
  return actions
}

/** The GitHub REST calls the train makes, with the workflow's GITHUB_TOKEN. */
export function createGitHubApi({ token, repo, base = 'main', fetchImpl = globalThis.fetch, apiUrl = 'https://api.github.com' }) {
  const request = async (method, path, body) => {
    const response = await fetchImpl(path.startsWith('http') ? path : `${apiUrl}${path}`, {
      method,
      headers: {
        authorization: `Bearer ${token}`,
        accept: 'application/vnd.github+json',
        'x-github-api-version': '2022-11-28',
        ...(body ? { 'content-type': 'application/json' } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    })
    if (!response.ok) {
      const error = new Error(`${method} ${path}: ${response.status} ${await response.text()}`)
      error.status = response.status
      throw error
    }
    return { data: response.status === 204 ? null : await response.json(), link: response.headers.get('link') ?? '' }
  }
  const paginate = async (path, pick = (d) => d) => {
    const items = []
    let next = path
    for (let page = 0; next && page < 20; page++) {
      const { data, link } = await request('GET', next)
      items.push(...pick(data))
      next = /<([^>]+)>;\s*rel="next"/.exec(link)?.[1] ?? null
    }
    return items
  }
  const r = `/repos/${repo}`
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
  return {
    async listQueue() {
      const issues = await paginate(`${r}/issues?state=open&labels=${encodeURIComponent(LABEL)}&per_page=100`)
      const entries = []
      for (const issue of issues.filter((i) => i.pull_request)) {
        const events = await paginate(`${r}/issues/${issue.number}/events?per_page=100`)
        const labeled = events.filter((e) => e.event === 'labeled' && e.label?.name === LABEL)
        entries.push({ number: issue.number, labeledAt: labeled[labeled.length - 1]?.created_at ?? null })
      }
      return entries
    },
    async getPull(number) {
      let pr
      // GitHub computes mergeability on request; give it a moment before reporting "unknown".
      for (let attempt = 0; attempt < 3; attempt++) {
        pr = (await request('GET', `${r}/pulls/${number}`)).data
        if (pr.mergeable !== null) break
        await sleep(3000)
      }
      return {
        number,
        state: pr.state,
        draft: Boolean(pr.draft),
        isFork: pr.head?.repo?.full_name !== repo,
        headSha: pr.head.sha,
        headRef: pr.head.ref,
        mergeable: pr.mergeable,
        mergeableState: pr.mergeable_state,
      }
    },
    async behindBy(sha) {
      return (await request('GET', `${r}/compare/${base}...${sha}`)).data.behind_by
    },
    async changesRequested(number) {
      const reviews = await paginate(`${r}/pulls/${number}/reviews?per_page=100`)
      const latest = new Map()
      for (const review of reviews) if (review.state !== 'COMMENTED') latest.set(review.user?.login, review.state)
      return [...latest.values()].includes('CHANGES_REQUESTED')
    },
    async listRuns(sha) {
      const runs = await paginate(`${r}/actions/runs?head_sha=${sha}&per_page=100`, (d) => d.workflow_runs)
      return runs.map((run) => ({
        name: run.name,
        path: run.path,
        headSha: run.head_sha,
        status: run.status,
        conclusion: run.conclusion,
        htmlUrl: run.html_url,
        createdAt: run.created_at,
      }))
    },
    async listChecks(sha) {
      const checks = await paginate(`${r}/commits/${sha}/check-runs?per_page=100`, (d) => d.check_runs)
      const out = []
      for (const check of checks) {
        let failedStep = null
        if (check.status === 'completed' && !['success', 'skipped', 'neutral'].includes(check.conclusion)) {
          // An Actions check run's id is its job's id: the job lists the step that failed.
          try {
            const job = (await request('GET', `${r}/actions/jobs/${check.id}`)).data
            failedStep = job.steps?.find((s) => s.conclusion === 'failure')?.name ?? null
          } catch {
            failedStep = null
          }
        }
        out.push({
          name: check.name,
          headSha: check.head_sha,
          status: check.status,
          conclusion: check.conclusion,
          htmlUrl: check.html_url,
          startedAt: check.started_at,
          failedStep,
        })
      }
      return out
    },
    async requiredChecks() {
      try {
        // The branch endpoint shows protection's required checks to a contents:read token.
        const protection = (await request('GET', `${r}/branches/${base}`)).data.protection
        const status = protection?.required_status_checks ?? {}
        return [...new Set([...(status.contexts ?? []), ...(status.checks ?? []).map((c) => c.context)])]
      } catch {
        return []
      }
    },
    async listComments(number) {
      const comments = await paginate(`${r}/issues/${number}/comments?per_page=100`)
      return comments.map((c) => ({ id: c.id, body: c.body, isBot: c.user?.type === 'Bot' }))
    },
    async createComment(number, body) {
      return (await request('POST', `${r}/issues/${number}/comments`, { body })).data
    },
    async updateComment(id, body) {
      return (await request('PATCH', `${r}/issues/comments/${id}`, { body })).data
    },
    async removeLabel(number) {
      try {
        await request('DELETE', `${r}/issues/${number}/labels/${encodeURIComponent(LABEL)}`)
      } catch (error) {
        if (error.status !== 404) throw error
      }
    },
    async updateBranch(number, expectedHeadSha) {
      await request('PUT', `${r}/pulls/${number}/update-branch`, { expected_head_sha: expectedHeadSha })
    },
    async merge(number, sha) {
      // `sha` makes GitHub refuse the merge if the head moved since the green run.
      await request('PUT', `${r}/pulls/${number}/merge`, { merge_method: 'merge', sha })
    },
    async dispatchWorkflow(file, ref) {
      await request('POST', `${r}/actions/workflows/${file}/dispatches`, { ref })
    },
  }
}

async function main() {
  const token = process.env.GITHUB_TOKEN
  const repo = process.env.GITHUB_REPOSITORY
  if (!token || !repo) throw new Error('GITHUB_TOKEN and GITHUB_REPOSITORY are required')
  const minutes = Number(process.env.MERGE_TRAIN_TIMEOUT_MINUTES)
  const timeoutMinutes = Number.isFinite(minutes) && minutes > 0 ? minutes : DEFAULT_TIMEOUT_MINUTES
  const actions = await runTrain(createGitHubApi({ token, repo }), { timeoutMinutes, log: (line) => console.log(line) })
  const summary = process.env.GITHUB_STEP_SUMMARY
  if (summary) {
    const lines = actions.map((a) => `- ${a.number ? `#${a.number} ` : ''}**${a.type}**: ${a.message}`)
    appendFileSync(summary, `### Merge train\n\n${lines.join('\n')}\n`)
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
}
