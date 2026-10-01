/**
 * Durable locations this plugin owns, plus the small atomic JSON store every
 * page shares.
 *
 * Two roots matter:
 *
 *  - `$DSH_HOME/control-center` — this plugin's own data: the MCP server
 *    definitions, the persona library and the persona index. Nothing else reads
 *    it, so its layout can change freely.
 *  - the active profile directory — the profile's `cordis.patch.yml` is the
 *    user patch layer of the composition, and the only place a row can be added
 *    that the Loader resolves from the dsh installation. The MCP page writes
 *    one clearly marked managed block there (see `mcp.js`).
 *
 * Skills are not stored here at all: they are ordinary files under the user
 * skill root the filesystem skill provider already scans.
 */
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'

/** The harness configuration root (`$DSH_HOME`). */
export function dshHome() {
  const value = process.env.DSH_HOME
  return value !== undefined && value !== '' ? value : join(homedir(), '.dsh')
}

/** The shared agents configuration root (`$DSH_AGENTS_HOME`). */
export function agentsHome() {
  const value = process.env.DSH_AGENTS_HOME
  return value !== undefined && value !== '' ? value : join(homedir(), '.agents')
}

/** This plugin's private data directory. */
export function dataRoot() {
  return join(dshHome(), 'control-center')
}

/** The user-level skill root (`<dshHome>/skills`), the rank-400 provider root. */
export function userSkillRoot() {
  return join(dshHome(), 'skills')
}

/** The shared agent skill root (`<agentsHome>/skills`), the rank-500 provider root. */
export function agentsSkillRoot() {
  return join(agentsHome(), 'skills')
}

/**
 * The profile patch this plugin may edit, or `undefined` when the harness was
 * booted without a profile (no patch file exists then, and the MCP page reports
 * itself unavailable rather than guessing a path).
 */
export function profilePatchPath(ctx) {
  const profile = ctx.get('profileContext')
  if (profile !== undefined && profile !== null) {
    if (typeof profile.patchPath === 'string' && profile.patchPath !== '') return profile.patchPath
    if (typeof profile.dir === 'string' && profile.dir !== '') return join(profile.dir, 'cordis.patch.yml')
  }
  const dir = process.env.DSH_PROFILE_DIR
  return dir !== undefined && dir !== '' ? join(dir, 'cordis.patch.yml') : undefined
}

/** Read a UTF-8 file, returning `undefined` for a missing one. */
export async function readText(path) {
  try {
    return await readFile(path, 'utf8')
  } catch (error) {
    if (error?.code === 'ENOENT') return undefined
    throw error
  }
}

/** Write a UTF-8 file atomically (temp sibling + rename). */
export async function writeText(path, text) {
  await mkdir(dirname(path), { recursive: true })
  const temp = `${path}.tmp-${process.pid}-${Date.now().toString(36)}`
  await writeFile(temp, text, 'utf8')
  await rename(temp, path)
}

/** Read a JSON document, returning `fallback` when it is missing or unparsable. */
export async function readJson(path, fallback) {
  const text = await readText(path)
  if (text === undefined || text.trim() === '') return fallback
  try {
    return JSON.parse(text)
  } catch {
    return fallback
  }
}

/** Serialize a JSON document atomically. */
export async function writeJson(path, value) {
  await writeText(path, `${JSON.stringify(value, null, 2)}\n`)
}
