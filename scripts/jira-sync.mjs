// Keeps the Jira items of the OXE project in step with the repository (1.5.2, the user's ALM setup of 13/11).
//
// The flow (12 columns, accepted by the user on 14/11; OXE-119): Backlog → Em grooming → Em refinamento → Pronto para
// desenvolvimento → Em desenvolvimento → Em revisão → Testado → Na fila → Na main → Em homologação → Homologado → Lançado.
// The columns before Em desenvolvimento belong to people and to oxe-build (grill, alm refine, the ready gate).
//
// A pull request names its items with the key in its title or branch (`fix(x): ... (OXE-123)`, `oxe-123-...`).
//   open                                 → Em revisão
//   open, CI result and pr:ready green on its head → Testado
//   labelled `na-fila`                   → Na fila
//   merged                               → Na main
//   branch release/X.Y.Z, or `stage X.Y.Z homologacao` → the version's items in Na main → Em homologação
//   `stage X.Y.Z homologado`             → the version's items in Em homologação → Homologado
//   release vX.Y.Z                       → the Jira version X.Y.Z is released and its items in Na main, Em homologação
//                                          or Homologado → Lançado
// Forward only. The one way back is inside review: a new push that loses pr:ready, or the train taking a PR out of
// the queue, sends the item back to Testado or Em revisão. Nothing goes back from Na main.
//
// Runs on pull request events (immediate) and every 15 minutes (the train merges and unlabels with GITHUB_TOKEN,
// whose events start no workflow, so the schedule is what sees those). A Jira failure is reported and never fails
// the run. The token comes from the environment (JIRA_API_TOKEN) and is never printed.
//
//   node scripts/jira-sync.mjs                          reconcile (needs GITHUB_TOKEN, GITHUB_REPOSITORY, JIRA_*)
//   node scripts/jira-sync.mjs stage 1.5.2 homologacao  the version's items in Na main → Em homologação (needs JIRA_*)
//   node scripts/jira-sync.mjs stage 1.5.2 homologado   the version's items in Em homologação → Homologado
//   JIRA_SYNC_DRY_RUN=1 node scripts/...                says what it would do, writes nothing

import { pathToFileURL } from 'node:url'

export const KEY_PATTERN = /\b(OXE)-(\d+)\b/gi
export const QUEUE_LABEL = 'na-fila'
/** Workflow order; a target only applies to an item in an earlier state. */
export const STATES = ['Backlog', 'Em grooming', 'Em refinamento', 'Pronto para desenvolvimento', 'Em desenvolvimento', 'Em revisão', 'Testado', 'Na fila', 'Na main', 'Em homologação', 'Homologado', 'Lançado']
/** The states a pull request under review moves between, back and forth. */
export const REVIEW = ['Em revisão', 'Testado', 'Na fila']
/** The commit statuses that make a pull request Testado: CI's verdict and the pr:ready marker. */
export const TESTED_CONTEXTS = ['CI result', 'pr:ready']
/** Release stages a person starts (`stage <version> <name>`): the state they move from and to. */
export const STAGES = { homologacao: { from: 'Na main', to: 'Em homologação' }, homologado: { from: 'Em homologação', to: 'Homologado' } }
/** The states a published release lands as Lançado. */
export const RELEASED_FROM = ['Na main', 'Em homologação', 'Homologado']
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
  if (pr.labels.includes(QUEUE_LABEL)) return 'Na fila'
  return pr.tested ? 'Testado' : 'Em revisão'
}

/** Whether a head's statuses (GitHub lists them newest first) have every TESTED_CONTEXTS green at its latest. */
export function isTested(statuses) {
  const latest = new Map()
  for (const status of statuses ?? []) if (!latest.has(status.context)) latest.set(status.context, status.state)
  return TESTED_CONTEXTS.every(context => latest.get(context) === 'success')
}

/**
 * Whether an item in `current` moves to `target`. Forward only, except inside review (Em revisão, Testado, Na fila),
 * where a lost pr:ready or a PR taken out of the queue moves it back. Unknown states are left alone.
 */
export function shouldMove(current, target) {
  const from = STATES.indexOf(current), to = STATES.indexOf(target)
  if (from < 0 || to < 0 || from === to) return false
  if (REVIEW.includes(current) && REVIEW.includes(target)) return true
  return to > from
}

/** `release/1.5.2` → `1.5.2`; any other branch → null. */
export function versionOfBranch(name) {
  const match = /^release\/(\d+\.\d+\.\d+)$/.exec(name ?? '')
  return match ? match[1] : null
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

/** Moves the version's items from one state to another (a stage, or a release landing them). */
async function moveVersion(jira, project, version, from, to, why, { dry, log }) {
  let moved = 0
  for (const key of await jira.keysIn(project, version, from)) {
    log(`jira-sync: ${key} ${from} → ${to} (${why})${dry ? ' [dry run]' : ''}`)
    if (!dry) await jira.moveTo(key, to)
    moved += 1
  }
  return moved
}

/** `stage <version> homologacao|homologado`: a person starts a release stage. */
export async function stage(version, name, env = process.env, log = console.log) {
  const step = STAGES[name]
  if (!step || !/^\d+\.\d+\.\d+$/.test(version ?? '')) throw new Error(`usage: stage <X.Y.Z> ${Object.keys(STAGES).join('|')}`)
  if (!env.JIRA_SITE || !env.JIRA_EMAIL || !env.JIRA_API_TOKEN) throw new Error('JIRA_SITE, JIRA_EMAIL or JIRA_API_TOKEN is not set')
  const moved = await moveVersion(jiraClient(env), env.JIRA_PROJECT ?? 'OXE', version, step.from, step.to, `stage ${name}`, { dry: env.JIRA_SYNC_DRY_RUN === '1', log })
  log(`jira-sync: ${moved} move(s)`)
  return { moved }
}

export async function reconcile(env = process.env, log = console.log) {
  if (!env.JIRA_SITE || !env.JIRA_EMAIL || !env.JIRA_API_TOKEN) { log('jira-sync: JIRA_SITE, JIRA_EMAIL or JIRA_API_TOKEN is not set; nothing to do'); return { moved: 0, failed: 0 } }
  const dry = env.JIRA_SYNC_DRY_RUN === '1'
  const jira = jiraClient(env)
  const since = Date.now() - RECENT_HOURS * 3600_000
  const open = await github(env, '/pulls?state=open&per_page=100')
  // Testado: the head's statuses; a read failure leaves the PR in review.
  const tested = new Set()
  for (const pr of open) {
    if (pr.draft || !pr.head?.sha) continue
    try { if (isTested(await github(env, `/commits/${pr.head.sha}/statuses?per_page=100`))) tested.add(pr.number) } catch (error) { log(`::warning::jira-sync: #${pr.number} statuses: ${error.message}`) }
  }
  const closed = (await github(env, '/pulls?state=closed&sort=updated&direction=desc&per_page=100')).filter(pr => pr.merged_at && Date.parse(pr.merged_at) >= since)
  let moved = 0, failed = 0
  for (const [key, { target, pr }] of plan([...open, ...closed].map(prOf).map(each => ({ ...each, tested: tested.has(each.number) })))) {
    try {
      const current = await jira.status(key)
      if (!shouldMove(current, target)) continue
      log(`jira-sync: ${key} ${current} → ${target} (#${pr})${dry ? ' [dry run]' : ''}`)
      if (!dry) await jira.moveTo(key, target)
      moved += 1
    } catch (error) { failed += 1; log(`::warning::jira-sync: ${key}: ${error.message}`) }
  }
  const project = env.JIRA_PROJECT ?? 'OXE'
  // Release branches: release/X.Y.Z cut means the version is in homologation.
  try {
    for (const branch of await github(env, '/branches?per_page=100')) {
      const name = versionOfBranch(branch.name)
      if (!name || !(await jira.version(project, name))) continue
      moved += await moveVersion(jira, project, name, 'Na main', 'Em homologação', branch.name, { dry, log })
    }
  } catch (error) { failed += 1; log(`::warning::jira-sync: release branches: ${error.message}`) }
  // Releases: a published stable tag releases its Jira version and lands its items.
  for (const release of await github(env, '/releases?per_page=5')) {
    const name = versionOfTag(release.tag_name)
    if (!name || release.draft || release.prerelease) continue
    try {
      const version = await jira.version(project, name)
      if (!version) continue
      for (const from of RELEASED_FROM) moved += await moveVersion(jira, project, name, from, 'Lançado', release.tag_name, { dry, log })
      if (!version.released) { log(`jira-sync: version ${name} released${dry ? ' [dry run]' : ''}`); if (!dry) await jira.release(version.id) }
    } catch (error) { failed += 1; log(`::warning::jira-sync: ${release.tag_name}: ${error.message}`) }
  }
  log(`jira-sync: ${moved} move(s), ${failed} failure(s)`)
  return { moved, failed }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  // A Jira or GitHub failure is a warning: the sync never fails the run.
  const [command, version, name] = process.argv.slice(2)
  if (command === 'stage') stage(version, name).catch(error => { console.error(`jira-sync: ${error.message}`); process.exitCode = 1 })
  else reconcile().catch(error => console.log(`::warning::jira-sync: ${error.message}`))
}
