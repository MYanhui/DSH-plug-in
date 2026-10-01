/**
 * GitHub source-archive download.
 *
 * The page accepts an ordinary repository URL and turns it into one archive
 * fetch, never a `git` invocation: the harness runs on machines without git on
 * PATH, and a source tarball carries exactly what a skill install needs. Three
 * URL shapes are understood:
 *
 *   https://github.com/owner/repo
 *   https://github.com/owner/repo/tree/<branch>
 *   https://github.com/owner/repo/tree/<branch>/<subpath>
 *
 * plus the `git@github.com:owner/repo.git` SSH spelling, which is rewritten to
 * the HTTPS form because only HTTPS is fetched.
 */
import { gunzipSync } from 'node:zlib'
import { fail } from './wire.js'
import { parseTar } from './tar.js'

const MAX_ARCHIVE_BYTES = 96 * 1024 * 1024
const DOWNLOAD_TIMEOUT_MS = 120_000

/** Parse a GitHub repository reference into its parts. */
export function parseRepoUrl(input) {
  let text = String(input ?? '').trim()
  if (text === '') fail('bad-request', 'a GitHub repository URL is required')
  const ssh = /^git@github\.com:([^/]+)\/(.+?)(?:\.git)?$/.exec(text)
  if (ssh !== null) text = `https://github.com/${ssh[1]}/${ssh[2]}`
  if (!/^https?:\/\//i.test(text)) text = `https://github.com/${text.replace(/^\/+/, '')}`

  let url
  try {
    url = new URL(text)
  } catch {
    fail('bad-request', `"${input}" is not a usable URL`)
  }
  if (!/(^|\.)github\.com$/i.test(url.hostname)) fail('bad-request', 'only github.com repositories are supported')

  const parts = url.pathname.split('/').filter((part) => part !== '')
  if (parts.length < 2) fail('bad-request', 'the URL must name a repository, for example https://github.com/owner/repo')
  const owner = parts[0]
  const repo = parts[1].replace(/\.git$/i, '')
  let branch
  let subpath = ''
  const marker = parts[2]
  if (marker === 'tree' || marker === 'blob') {
    branch = parts[3]
    subpath = parts.slice(4).join('/')
  }
  return { owner, repo, branch, subpath }
}

async function download(url) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), DOWNLOAD_TIMEOUT_MS)
  try {
    const response = await fetch(url, { signal: controller.signal, redirect: 'follow' })
    if (response.status === 404) return undefined
    if (!response.ok) fail('download-failed', `${url} answered HTTP ${response.status}`)
    const declared = Number(response.headers.get('content-length') ?? '0')
    if (Number.isFinite(declared) && declared > MAX_ARCHIVE_BYTES) {
      fail('download-too-large', 'the repository archive is larger than the 96 MiB limit')
    }
    const buffer = Buffer.from(await response.arrayBuffer())
    if (buffer.length > MAX_ARCHIVE_BYTES) fail('download-too-large', 'the repository archive is larger than the 96 MiB limit')
    return buffer
  } catch (error) {
    if (error?.code !== undefined) throw error
    fail('download-failed', `${url} could not be fetched: ${error instanceof Error ? error.message : String(error)}`)
  } finally {
    clearTimeout(timer)
  }
}

/**
 * Download and unpack one repository archive.
 *
 * @returns `{ owner, repo, branch, subpath, prefix, entries }` where `entries`
 * are the archive's files with the wrapping `<repo>-<branch>/` prefix removed,
 * and `prefix` is that wrapper.
 */
export async function fetchRepoArchive(reference) {
  const { owner, repo, branch, subpath } = parseRepoUrl(reference)
  const candidates = branch !== undefined && branch !== '' ? [branch] : ['main', 'master']
  const attempts = []

  for (const candidate of candidates) {
    const url = `https://codeload.github.com/${owner}/${repo}/tar.gz/refs/heads/${encodeURIComponent(candidate)}`
    const raw = await download(url)
    if (raw === undefined) {
      attempts.push(`${candidate}: not found`)
      continue
    }
    let entries
    try {
      entries = parseTar(gunzipSync(raw))
    } catch (error) {
      fail('archive-failed', `the archive of ${owner}/${repo}@${candidate} could not be read: ${error instanceof Error ? error.message : String(error)}`)
    }
    const first = entries.find((entry) => entry.name.includes('/'))
    const prefix = first === undefined ? '' : `${first.name.split('/')[0]}/`
    const relative = entries
      .filter((entry) => prefix === '' || entry.name === prefix.slice(0, -1) || entry.name.startsWith(prefix))
      .map((entry) => ({
        ...entry,
        name: prefix !== '' && entry.name.startsWith(prefix) ? entry.name.slice(prefix.length) : entry.name,
      }))
      .filter((entry) => entry.name !== '')
    return { owner, repo, branch: candidate, subpath, prefix, entries: relative }
  }

  fail('download-failed', `no branch of ${owner}/${repo} could be downloaded (${attempts.join(', ')})`)
}
