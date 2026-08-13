/**
 * Code review surface: pull requests, commit history and releases. These are
 * read-mostly and mostly gh; they share the repository summary cache with the
 * other collaborators so commit URLs cost nothing extra.
 */
import type {
  GitHubCommit,
  GitHubCommitDetails,
  GitHubCreatePullRequestInput,
  GitHubCreateReleaseInput,
  GitHubMessageResult,
  GitHubPullRequest,
  GitHubPullRequestListInput,
  GitHubRelease,
  GitHubWorkspaceInput
} from '../../../../shared/types/github'
import { normalizeCommitBody, nullableString, ok, parseJsonArray, readLogin, toNumber, toStringValue } from './parsers'
import type { GhExec } from './gh-exec'
export class GitHubReviewService {
  constructor(private readonly gh: GhExec) {}
  async listPullRequests(input: GitHubPullRequestListInput): Promise<GitHubPullRequest[]> {
    const raw = await this.gh.runGh(['pr', 'list', '--state', input.state, '--limit', '50', '--json', 'number,title,state,author,url,headRefName,baseRefName,updatedAt'], input.rootPath)
    return parseJsonArray<Record<string, unknown>>(raw).map((item) => ({
      number: toNumber(item.number),
      title: toStringValue(item.title),
      state: toStringValue(item.state),
      author: readLogin(item.author),
      url: nullableString(item.url),
      headRefName: nullableString(item.headRefName),
      baseRefName: nullableString(item.baseRefName),
      updatedAt: nullableString(item.updatedAt)
    }))
  }

  async createPullRequest(input: GitHubCreatePullRequestInput): Promise<GitHubMessageResult> {
    const args = ['pr', 'create', '--title', input.title, '--body', input.body]
    if (input.base) args.push('--base', input.base)
    if (input.head) args.push('--head', input.head)
    if (input.draft) args.push('--draft')
    const url = (await this.gh.runGh(args, input.rootPath)).trim()
    return ok(url || 'Pull request criada.')
  }

  async listCommits(input: GitHubWorkspaceInput): Promise<GitHubCommit[]> {
    const [raw, repo] = await Promise.all([
      this.gh.runGit(['log', '-50', '--format=%H%x1f%h%x1f%s%x1f%an%x1f%cI'], input.rootPath),
      this.gh.getRepositorySummary(input.rootPath)
    ])
    return raw.split('\n').filter(Boolean).map((line) => {
      const [oid, shortOid, message, author, committedDate] = line.split('\x1f')
      return {
        oid,
        shortOid,
        message,
        author: author || null,
        committedDate: committedDate || null,
        url: repo.url && oid ? `${repo.url}/commit/${oid}` : null
      }
    })
  }

  async getCommitDetails(input: { rootPath: string; oid: string }): Promise<GitHubCommitDetails> {
    const [repo, raw, filesRaw] = await Promise.all([
      this.gh.getRepositorySummary(input.rootPath),
      this.gh.runGit(['show', '-s', '--format=%H%x1f%h%x1f%s%x1f%B%x1f%an%x1f%cI', input.oid], input.rootPath),
      this.gh.tryGit(['show', '--numstat', '--format=', input.oid], input.rootPath)
    ])
    const [oid, shortOid, subject, bodyRaw, author, committedDate] = raw.split('\x1f')
    const files = filesRaw.split('\n').filter(Boolean).map((line) => {
      const [additionsRaw, deletionsRaw, ...pathParts] = line.split('\t')
      const binary = additionsRaw === '-' || deletionsRaw === '-'
      return {
        path: pathParts.join('\t'),
        additions: binary ? 0 : Number.parseInt(additionsRaw ?? '0', 10) || 0,
        deletions: binary ? 0 : Number.parseInt(deletionsRaw ?? '0', 10) || 0,
        binary
      }
    })
    const additions = files.reduce((sum, file) => sum + file.additions, 0)
    const deletions = files.reduce((sum, file) => sum + file.deletions, 0)

    return {
      oid,
      shortOid,
      message: subject,
      body: normalizeCommitBody(bodyRaw, subject),
      author: author || null,
      committedDate: committedDate || null,
      url: repo.url && oid ? `${repo.url}/commit/${oid}` : null,
      files,
      additions,
      deletions
    }
  }

  async listReleases(input: GitHubWorkspaceInput): Promise<GitHubRelease[]> {
    const raw = await this.gh.runGh(['release', 'list', '--limit', '50', '--json', 'tagName,name,isDraft,isPrerelease,publishedAt'], input.rootPath)
    return parseJsonArray<Record<string, unknown>>(raw).map((item) => ({
      tagName: toStringValue(item.tagName),
      name: nullableString(item.name),
      isDraft: item.isDraft === true,
      isPrerelease: item.isPrerelease === true,
      publishedAt: nullableString(item.publishedAt),
      url: null
    }))
  }

  async createRelease(input: GitHubCreateReleaseInput): Promise<GitHubMessageResult> {
    const args = ['release', 'create', input.tagName]
    if (input.title) args.push('--title', input.title)
    if (input.notes) args.push('--notes', input.notes)
    if (input.generateNotes !== false) args.push('--generate-notes')
    if (input.prerelease) args.push('--prerelease')
    if (input.draft) args.push('--draft')
    const output = (await this.gh.runGh(args, input.rootPath)).trim()
    return ok(output || `Release ${input.tagName} criada.`)
  }
}