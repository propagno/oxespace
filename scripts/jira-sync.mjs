// Keeps the Jira items of the OXE project in step with the repository (1.5.2, the user's ALM setup of 13/11).
//
// A pull request names its items with the key in its title or branch (`fix(x): ... (OXE-123)`, `oxe-123-...`).
//   open, not queued      → Em revisão
//   labelled `na-fila`    → Na fila
//   merged                → Na main
//   release vX.Y.Z        → the Jira version X.Y.Z is released and its items in Na main → Lançado
// An item never goes back from Na main or Lançado, and only an item in an earlier state moves forward.
//
// Runs on pull request events (immediate) and every 15 minutes (the train merges and unlabels with GITHUB_TOKEN,
// whose events start no workflow, so the schedule is what sees those). A Jira failure is reported and never fails
// the run. The token comes from the environment (JIRA_API_TOKEN) and is never printed.
//
//   node scripts/jira-sync.mjs            reconcile (needs GITHUB_TOKEN, GITHUB_REPOSITORY, JIRA_*)
//   JIRA_SYNC_DRY_RUN=1 node scripts/...  says what it would do, writes nothing

import { pathToFileURL } from 'node:url'

export const KEY_PATTERN = /\b(OXE)-(\d+)\b/gi
export const QUEUE_LABEL = 'na-fila'
/** Workflow order; a target only applies to an item in an earlier state. */
export const STATES = ['A fazer', 'Em andamento', 'Em revisão', 'Na fila', 'Na main', 'Lançado']
export const RECENT_HOURS = 72

/** The item keys a pull request names, from its title and its branch, once each, upper case. */
export function keysOf(pr) {
  const text = `${pr.title ?? ''} ${pr.branch ?? ''}`
  const keys = new Set()
  for (const match of text.matchAll(KEY_PATTERN)) keys.add(`${match[1].toUpperCase()}-${Number(match[2])}`)
  return [...keys]
}

/** The state a pull request asks of its items, or null. */
export function targetOf(pr) {
  if (pr.merged) return 'Na main'
  if (pr.state !== 'open') return null
  return pr.labels.includes(QUEUE_LABEL) ? 'Na fila' : 'Em revisão'
}

/**
 * Whether an item in `current` moves to `target`. Forward only, except that an item the train took out of the
 * queue (Na fila, label gone) goes back to Em revisão. Unknown states are left alone.
 */
export function shouldMove(current, target) {
  const from = STATES.indexOf(current), to = STATES.indexOf(target)
  if (from < 0 || to < 0 || from === to) return false
  if (current === 'Na fila' && target === 'Em revisão') return true
  return to > from
}

/** `v1.5.2` → `1.5.2`; anything that is not a stable release tag → null. */
export function versionOfTag(tag) {
  const match = /^v(\d+\.\d+\.\d+)$/.exec(tag ?? '')
  return match ? match[1] : null
}

/** Pull requests touching several items move each; two PRs on one item: the furthest state wins. */
export function plan(prs) {
  const wanted = new Map()
  for (const pr of prs) {
    const target = targetOf(pr)
    if (!target) continue
    for (const key of keysOf(pr)) {
      const before = wanted.get(key)
      if (!before || STATES.indexOf(target) > STATES.indexOf(before.target)) wanted.set(key, { target, pr: pr.number })
    }
  }
  return wanted
}

function jiraClient(env) {
  const site = (env.JIRA_SITE ?? '').replace(/\/+$/, '')
  const auth = 'Basic ' + Buffer.from(`${env.JIRA_EMAIL}:${env.JIRA_API_TOKEN}`).toString('base64')
  const call = async (method, path, body) => {
    const response = await fetch(`${site}${path}`, {
      method, headers: { Authorization: auth, Accept: 'application/json', ...(body ? { 'Content-Type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined
    })
    if (!response.ok) throw new Error(`Jira ${method} ${path.split('?')[0]}: ${response.status}`)
    return response.status === 204 ? null : response.json()
  }
  return {
    async status(key) { return (await call('GET', `/rest/api/3/issue/${key}?fields=status`)).fields.status.name },
    async moveTo(key, name) {
      const { transitions } = await call('GET', `/rest/api/3/issue/${key}/transitions`)
      const transition = transitions.find(each => each.to?.name === name || each.name === name)
      if (!transition) throw new Error(`no transition to ${name} for ${key}`)
      await call('POST', `/rest/api/3/issue/${key}/transitions`, { transition: { id: transition.id } })
    },
    async version(project, name) { return (await call('GET', `/rest/api/3/project/${project}/versions`)).find(each => each.name === name) ?? null },
    async release(id) { await call('PUT', `/rest/api/3/version/${id}`, { released: true, releaseDate: new Date().toISOString().slice(0, 10) }) },
    async keysIn(project, version, status) {
      const jql = encodeURIComponent(`project = ${project} AND fixVersion = "${version}" AND status = "${status}"`)
      return (await call('GET', `/rest/api/3/search/jql?jql=${jql}&maxResults=200&fields=status`)).issues.map(each => each.key)
    }
  }
}

async function github(env, path) {
  const response = await fetch(`https://api.github.com/repos/${env.GITHUB_REPOSITORY}${path}`, {
    headers: { Authorization: `Bearer ${env.GITHUB_TOKEN}`, Accept: 'application/vnd.github+json' }
  })
  if (!response.ok) throw new Error(`GitHub ${path.split('?')[0]}: ${response.status}`)
  return response.json()
}

const prOf = pr => ({ number: pr.number, title: pr.title, branch: pr.head?.ref, state: pr.state, merged: Boolean(pr.merged_at), labels: (pr.labels ?? []).map(each => each.name) })

export async function reconcile(env = process.env, log = console.log) {
  if (!env.JIRA_SITE || !env.JIRA_EMAIL || !env.JIRA_API_TOKEN) { log('jira-sync: JIRA_SITE, JIRA_EMAIL or JIRA_API_TOKEN is not set; nothing to do'); return { moved: 0, failed: 0 } }
  const dry = env.JIRA_SYNC_DRY_RUN === '1'
  const jira = jiraClient(env)
  const since = Date.now() - RECENT_HOURS * 3600_000
  const open = await github(env, '/pulls?state=open&per_page=100')
  const closed = (await github(env, '/pulls?state=closed&sort=updated&direction=desc&per_page=100')).filter(pr => pr.merged_at && Date.parse(pr.merged_at) >= since)
  let moved = 0, failed = 0
  for (const [key, { target, pr }] of plan([...open, ...closed].map(prOf))) {
    try {
      const current = await jira.status(key)
      if (!shouldMove(current, target)) continue
      log(`jira-sync: ${key} ${current} → ${target} (#${pr})${dry ? ' [dry run]' : ''}`)
      if (!dry) await jira.moveTo(key, target)
      moved += 1
    } catch (error) { failed += 1; log(`::warning::jira-sync: ${key}: ${error.message}`) }
  }
  // Releases: a published stable tag releases its Jira version and lands its merged items.
  const project = env.JIRA_PROJECT ?? 'OXE'
  for (const release of await github(env, '/releases?per_page=5')) {
    const name = versionOfTag(release.tag_name)
    if (!name || release.draft || release.prerelease) continue
    try {
      const version = await jira.version(project, name)
      if (!version) continue
      for (const key of await jira.keysIn(project, name, 'Na main')) {
        log(`jira-sync: ${key} Na main → Lançado (${release.tag_name})${dry ? ' [dry run]' : ''}`)
        if (!dry) await jira.moveTo(key, 'Lançado')
        moved += 1
      }
      if (!version.released) { log(`jira-sync: version ${name} released${dry ? ' [dry run]' : ''}`); if (!dry) await jira.release(version.id) }
    } catch (error) { failed += 1; log(`::warning::jira-sync: ${release.tag_name}: ${error.message}`) }
  }
  log(`jira-sync: ${moved} move(s), ${failed} failure(s)`)
  return { moved, failed }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  // A Jira or GitHub failure is a warning: the sync never fails the run.
  reconcile().catch(error => console.log(`::warning::jira-sync: ${error.message}`))
}
