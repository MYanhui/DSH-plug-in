#!/usr/bin/env node
/**
 * Pre-flight validator for an awesome-dsh-plugin catalog entry.
 *
 * Checks the mechanical rules the contributing guide documents, so a PR is not
 * bounced by CI over a shape mistake:
 *
 *   - the file name follows `<owner>__<repo>.yml`, or
 *     `<owner>__<repo>--<subpath-with-dashes>.yml` for a subdirectory entry;
 *   - `url`, `name`, `category` and `description.en` are present and agree with
 *     each other (a url pointing somewhere else than the file name claims);
 *   - `category` is one of the published ids;
 *   - only the accepted keys appear, and `npm:` is not among them — the catalog
 *     rejects it because the registry mapping is collected automatically;
 *   - a description containing ': ' is quoted, which is the one YAML mistake
 *     the guide calls out by name.
 *
 * Usage:
 *   node validate-entry.mjs <file.yml> [...]
 *   node validate-entry.mjs --from <dir-with-node_modules> <file.yml> [...]
 *
 * `--from` exists because the YAML parser (`yaml` or `js-yaml`) is usually
 * present in a DSH profile's node_modules rather than beside this script.
 */
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { basename, join } from 'node:path'

const CATEGORIES = [
  'agi', 'ui', 'usage', 'theme', 'model', 'identity', 'session', 'memory', 'tools',
  'browser', 'vision', 'voice', 'docs', 'skill', 'workflow', 'git', 'notify', 'dev',
  'security', 'remote', 'market', 'fun',
]
const ACCEPTED_KEYS = ['url', 'name', 'category', 'description', 'tarball']

const args = process.argv.slice(2)
let base = process.cwd()
const fromIndex = args.indexOf('--from')
if (fromIndex >= 0) {
  base = args[fromIndex + 1]
  args.splice(fromIndex, 2)
}
if (args.length === 0) {
  console.error('usage: node validate-entry.mjs [--from <dir>] <file.yml> [...]')
  process.exit(2)
}

const require = createRequire(join(base, 'noop.cjs'))
let parse
try {
  parse = require('yaml').parse
} catch {
  try {
    parse = require('js-yaml').load
  } catch {
    console.error(`no YAML parser found from "${base}" — install "yaml" or "js-yaml", or pass --from`)
    process.exit(2)
  }
}

let failures = 0
const fail = (file, message) => {
  failures += 1
  console.log(`  FAIL ${file}: ${message}`)
}
const ok = (message) => console.log(`  ok   ${message}`)

/** Split a GitHub repository url into owner, repo, branch and subpath. */
function parseUrl(url) {
  const body = String(url).replace(/^https?:\/\/github\.com\//i, '').replace(/\/+$/, '')
  const segments = body.split('/')
  const owner = segments[0] ?? ''
  const repo = segments[1] ?? ''
  if (segments[2] !== 'tree' && segments[2] !== 'blob') return { owner, repo, branch: undefined, subpath: '' }
  return { owner, repo, branch: segments[3] ?? '', subpath: segments.slice(4).join('/') }
}

for (const file of args) {
  const name = basename(file)
  console.log(`\n${name}`)

  // ── the file name encodes the entry's own path ─────────────────────────────
  const stem = name.replace(/\.ya?ml$/i, '')
  const match = /^([^_]+)__([^_]+?)(?:--(.+))?$/.exec(stem)
  if (match === null) {
    fail(name, 'the file name must be <owner>__<repo>.yml or <owner>__<repo>--<subpath>.yml')
  } else {
    ok(`file name encodes owner="${match[1]}", repo="${match[2]}"${match[3] === undefined ? '' : `, subpath="${match[3]}"`}`)
  }

  // ── it must parse ──────────────────────────────────────────────────────────
  let doc
  try {
    doc = parse(readFileSync(file, 'utf8'))
  } catch (error) {
    fail(name, `YAML does not parse: ${error.message}`)
    continue
  }
  if (doc === null || typeof doc !== 'object' || Array.isArray(doc)) {
    fail(name, 'the document must be a YAML mapping')
    continue
  }

  // ── required keys ──────────────────────────────────────────────────────────
  for (const key of ['url', 'name', 'category']) {
    if (typeof doc[key] !== 'string' || doc[key].trim() === '') fail(name, `"${key}" is required and must be a non-empty string`)
  }
  if (doc.description === null || typeof doc.description !== 'object' || Array.isArray(doc.description)) {
    fail(name, '"description" must be a mapping with at least an "en" key')
  } else {
    if (typeof doc.description.en !== 'string' || doc.description.en.trim() === '') {
      fail(name, '"description.en" is required')
    } else {
      ok('description.en present')
      if (!/[.。]$/.test(doc.description.en.trim())) fail(name, 'description.en should end with a period')
      // The guide's one named YAML trap: `: ` inside an unquoted scalar.
      if (doc.description.en.includes(': ')) {
        const line = readFileSync(file, 'utf8').split(/\r?\n/).find((item) => /\ben:/.test(item))
        if (line === undefined) fail(name, 'could not locate the "en:" line to check quoting')
        else if (!/['"]/.test(line)) fail(name, 'description.en contains ": " and must be quoted')
        else ok('description.en contains ": " and is quoted')
      }
    }
    if (doc.description.zh !== undefined && typeof doc.description.zh !== 'string') {
      fail(name, '"description.zh" must be a string when present')
    } else if (typeof doc.description.zh === 'string') {
      ok('description.zh present')
    }
  }

  // ── category ───────────────────────────────────────────────────────────────
  const categories = (Array.isArray(doc.category) ? doc.category : [doc.category]).filter((item) => typeof item === 'string')
  const unknown = categories.filter((item) => !CATEGORIES.includes(item))
  if (unknown.length > 0) fail(name, `unknown category id(s): ${unknown.join(', ')} — published ids are ${CATEGORIES.join(', ')}`)
  else if (categories.length > 0) ok(`category "${categories.join(', ')}" is published`)

  // ── only accepted keys, and never `npm:` ───────────────────────────────────
  for (const key of Object.keys(doc)) {
    if (key === 'npm') fail(name, 'an "npm:" key is rejected — the registry mapping is collected automatically')
    else if (!ACCEPTED_KEYS.includes(key)) fail(name, `unknown key "${key}" — accepted: ${ACCEPTED_KEYS.join(', ')}`)
  }

  // ── url, name and file name must describe one entry ────────────────────────
  if (match !== null && typeof doc.url === 'string' && typeof doc.name === 'string') {
    const { owner, repo, subpath } = parseUrl(doc.url)
    if (owner.toLowerCase() !== match[1].toLowerCase() || repo.toLowerCase() !== match[2].toLowerCase()) {
      fail(name, `url "${doc.url}" names ${owner}/${repo}, but the file name says ${match[1]}/${match[2]}`)
    } else {
      ok('url matches the file name')
    }
    // The file name cannot round-trip a subpath (slashes become dashes), so the
    // comparison is one-directional: every dashed segment must come from a real
    // path segment.
    if (match[3] !== undefined) {
      const dashed = subpath.split('/').join('-')
      if (dashed !== match[3]) fail(name, `the file name subpath "${match[3]}" does not match the url subpath "${subpath}"`)
      else ok(`subpath "${subpath}" matches the file name`)
    } else if (subpath !== '') {
      fail(name, `the url points into "${subpath}" but the file name has no subpath`)
    }
    const expectedName = subpath === '' ? `${owner}/${repo}` : `${owner}/${repo}#${subpath.split('/').pop()}`
    if (doc.name !== expectedName) fail(name, `"name" should be "${expectedName}", got "${doc.name}"`)
    else ok(`name "${doc.name}" matches the url`)
  }
}

console.log(`\n${failures === 0 ? 'entry(ies) look valid' : `${failures} problem(s) found`}`)
process.exit(failures === 0 ? 0 : 1)
