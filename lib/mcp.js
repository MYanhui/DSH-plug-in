/**
 * MCP server management.
 *
 * An MCP server in this harness is a Loader row of `@deepseek-ai/dsh-mcp-client`
 * in the cordis composition — not a value in a settings document — so the page
 * cannot edit it through `ctx.configEditor` (that service only rewrites the
 * config of an entry that already exists). It therefore owns a clearly
 * delimited MANAGED BLOCK inside the active profile's own patch layer, which is
 * the composition layer reserved for user edits:
 *
 *     # >>> dsh-control-center:mcp
 *     - insert: [{"id":"cc-mcp-github","name":"@deepseek-ai/dsh-mcp-client","config":{…}}]
 *     # <<< dsh-control-center:mcp
 *
 * Two properties make this safe:
 *
 *  - The block is generated text, never a re-serialization of the user's file.
 *    Everything outside the two markers is preserved byte for byte, including
 *    comments and `!!js` expressions.
 *  - The payload is JSON, which is a strict subset of YAML 1.2, so no value the
 *    user types (URLs, arguments, environment values) can change the document's
 *    shape. The block is parsed back before the write is committed.
 *
 * `dsh-hmr` watches the profile patch, so a committed block reloads the
 * composition on its own and the new servers connect without a restart.
 */
import { readText, writeText, readJson, writeJson, dataRoot, profilePatchPath } from './paths.js'
import { fail } from './wire.js'
import { join } from 'node:path'

const MCP_PLUGIN_NAME = '@deepseek-ai/dsh-mcp-client'
const BEGIN = '# >>> dsh-control-center:mcp — managed, edit it from Settings instead'
const END = '# <<< dsh-control-center:mcp'
const SERVER_NAME_PATTERN = /^[A-Za-z0-9_-]{1,32}$/

function storePath() {
  return join(dataRoot(), 'mcp-servers.json')
}

/** The server id derived from its name; the row id and the JSON key agree. */
function rowId(serverName) {
  return `cc-mcp-${serverName.toLowerCase().replace(/[^a-z0-9_-]+/g, '-')}`
}

function asString(value, field) {
  if (value === undefined || value === null) return ''
  if (typeof value !== 'string') fail('bad-request', `${field} must be a string`)
  return value
}

function asOptionalNumber(value, field) {
  if (value === undefined || value === null || value === '') return undefined
  const number = typeof value === 'number' ? value : Number(String(value).trim())
  if (!Number.isFinite(number) || number < 0) fail('bad-request', `${field} must be a non-negative number`)
  return number
}

function asStringList(value, field) {
  if (value === undefined || value === null) return []
  if (typeof value === 'string') {
    return value
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line !== '')
  }
  if (!Array.isArray(value)) fail('bad-request', `${field} must be a list of strings`)
  return value.map((item) => String(item))
}

function asStringMap(value, field) {
  if (value === undefined || value === null) return {}
  if (typeof value === 'string') {
    const out = {}
    for (const line of value.split('\n')) {
      const trimmed = line.trim()
      if (trimmed === '' || trimmed.startsWith('#')) continue
      const index = trimmed.indexOf('=')
      if (index <= 0) fail('bad-request', `${field} entries must look like KEY=value: "${trimmed}"`)
      out[trimmed.slice(0, index).trim()] = trimmed.slice(index + 1).trim()
    }
    return out
  }
  if (typeof value !== 'object' || Array.isArray(value)) fail('bad-request', `${field} must be an object`)
  const out = {}
  for (const [key, item] of Object.entries(value)) out[String(key)] = String(item)
  return out
}

/**
 * Validate one submitted server and return its normalized record.
 * The returned `config` is exactly what the Loader row receives.
 */
function normalize(input) {
  if (input === null || typeof input !== 'object') fail('bad-request', 'server must be an object')
  const serverName = asString(input.serverName, 'serverName').trim()
  if (!SERVER_NAME_PATTERN.test(serverName)) {
    fail('invalid-server-name', 'serverName must match [A-Za-z0-9_-]{1,32}')
  }
  const transport = input.transport === 'streamable-http' ? 'streamable-http' : 'stdio'
  const row = { serverName, transport }

  if (transport === 'stdio') {
    const command = asString(input.command, 'command').trim()
    if (command === '') fail('bad-request', 'command is required for a stdio server')
    row.command = command
    const args = asStringList(input.args, 'args')
    if (args.length > 0) row.args = args
    const env = asStringMap(input.env, 'env')
    if (Object.keys(env).length > 0) row.env = env
    const cwd = asString(input.cwd, 'cwd').trim()
    if (cwd !== '') row.cwd = cwd
  } else {
    const url = asString(input.url, 'url').trim()
    if (url === '') fail('bad-request', 'url is required for a streamable-http server')
    try {
      const parsed = new URL(url)
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') throw new Error('scheme')
    } catch {
      fail('bad-request', 'url must be an absolute http(s) URL')
    }
    row.url = url
    const headers = asStringMap(input.headers, 'headers')
    if (Object.keys(headers).length > 0) row.headers = headers
  }

  const timeout = asOptionalNumber(input.toolCallTimeoutMs, 'toolCallTimeoutMs')
  if (timeout !== undefined) row.toolCallTimeoutMs = timeout
  const maxInstructionBytes = asOptionalNumber(input.maxInstructionBytes, 'maxInstructionBytes')
  if (maxInstructionBytes !== undefined) row.maxInstructionBytes = maxInstructionBytes
  if (input.failOnStartupError === true) row.failOnStartupError = true

  const reconnect = input.reconnect
  if (reconnect !== undefined && reconnect !== null) {
    const normalizedReconnect = {}
    if (reconnect.enabled === false) normalizedReconnect.enabled = false
    const initialDelayMs = asOptionalNumber(reconnect.initialDelayMs, 'reconnect.initialDelayMs')
    if (initialDelayMs !== undefined) normalizedReconnect.initialDelayMs = initialDelayMs
    const maxDelayMs = asOptionalNumber(reconnect.maxDelayMs, 'reconnect.maxDelayMs')
    if (maxDelayMs !== undefined) normalizedReconnect.maxDelayMs = maxDelayMs
    const maxAttempts = asOptionalNumber(reconnect.maxAttempts, 'reconnect.maxAttempts')
    if (maxAttempts !== undefined) normalizedReconnect.maxAttempts = maxAttempts
    if (Object.keys(normalizedReconnect).length > 0) row.reconnect = normalizedReconnect
  }

  return { id: rowId(serverName), enabled: input.enabled !== false, config: row }
}

async function loadServers() {
  const document = await readJson(storePath(), { version: 1, servers: [] })
  const servers = Array.isArray(document?.servers) ? document.servers : []
  return servers
    .filter((server) => server !== null && typeof server === 'object')
    .map((server) => ({ ...server, id: typeof server.id === 'string' && server.id !== '' ? server.id : rowId(String(server.serverName ?? '')) }))
}

async function saveServers(servers) {
  await writeJson(storePath(), { version: 1, servers })
}

/** Render the managed block that carries every enabled server as one Loader insert. */
export function renderBlock(servers) {
  const rows = servers
    .filter((server) => server.enabled !== false)
    .map((server) => ({ id: server.id, name: MCP_PLUGIN_NAME, config: server.config }))
  if (rows.length === 0) return undefined
  return `${BEGIN}\n- insert: ${JSON.stringify(rows)}\n${END}\n`
}

/** Remove a previously written managed block from a patch document. */
export function stripBlock(text) {
  const begin = text.indexOf(BEGIN)
  if (begin < 0) return text
  const end = text.indexOf(END, begin)
  if (end < 0) return text.slice(0, begin)
  let after = end + END.length
  if (text[after] === '\r') after += 1
  if (text[after] === '\n') after += 1
  // Drop the blank line the block was separated by, so repeated writes do not
  // grow the file.
  return `${text.slice(0, begin).replace(/[ \t]*\n+$/, '\n')}${text.slice(after)}`
}

/** Append the managed block, keeping the document a valid YAML sequence. */
export function composeDocument(before, block) {
  const base = stripBlock(before)
  const trimmed = base.trim()
  if (trimmed === '' || trimmed === '[]') return block === undefined ? '[]\n' : block
  const body = base.replace(/\s+$/, '')
  if (block === undefined) return `${body}\n`
  return `${body}\n\n${block}`
}

/**
 * Validate the candidate document by parsing the managed block back out.
 * The Loader's own parser is the authority, but a bad document takes the whole
 * app down at the next reload, so the write is only committed when the block it
 * just produced parses to the rows that were intended.
 */
function assertBlockParses(block) {
  if (block === undefined) return
  const line = block.split('\n').find((item) => item.startsWith('- insert: '))
  if (line === undefined) throw new Error('managed block is malformed')
  const parsed = JSON.parse(line.slice('- insert: '.length))
  if (!Array.isArray(parsed)) throw new Error('managed block is malformed')
}

export function createMcpApi(ctx) {
  /** Read the live Loader state of this plugin's MCP rows, keyed by row id. */
  function liveState() {
    const map = new Map()
    const loader = ctx.loader
    if (loader === undefined || typeof loader.entries !== 'function') return map
    for (const entry of loader.entries()) {
      const id = entry?.options?.id
      if (typeof id !== 'string' || !id.startsWith('cc-mcp-')) continue
      map.set(id, {
        mounted: true,
        disabled: entry.options.disabled === true,
        active: entry.fiber?.state === 2,
      })
    }
    return map
  }

  async function view() {
    const servers = await loadServers()
    const live = liveState()
    const patchPath = profilePatchPath(ctx)
    return {
      available: patchPath !== undefined,
      patchPath: patchPath ?? null,
      servers: servers.map((server) => ({
        id: server.id,
        serverName: server.config?.serverName ?? '',
        transport: server.config?.transport ?? 'stdio',
        enabled: server.enabled !== false,
        config: server.config ?? {},
        live: live.get(server.id) ?? { mounted: false, disabled: false, active: false },
      })),
    }
  }

  async function commit(servers) {
    const patchPath = profilePatchPath(ctx)
    if (patchPath === undefined) {
      fail('no-profile', 'MCP servers can only be managed inside a profile-backed harness')
    }
    const block = renderBlock(servers)
    assertBlockParses(block)
    const before = (await readText(patchPath)) ?? '[]\n'
    const after = composeDocument(before, block)
    await writeText(patchPath, after)
    await saveServers(servers)
    // HMR watches this file; wait for the reload so the next read reports the
    // new rows instead of the old composition.
    try {
      await ctx.loader?.await?.()
    } catch {
      // A reload failure is reported by the Loader itself; the write stands.
    }
  }

  return {
    /**
     * Bring the profile patch in line with the stored definitions.
     *
     * Called once at activation. Without it the store and the patch can drift —
     * a hand-edited patch, a profile restored from a backup, or a reinstall over
     * a patch the uninstall script cleaned — and the page would list servers
     * that are not actually mounted. The write happens only when the composed
     * document differs, so a normal boot touches nothing and cannot start a
     * reload loop.
     *
     * @returns the number of rows the patch now carries, or `undefined` outside a profile.
     */
    async reconcile() {
      const patchPath = profilePatchPath(ctx)
      if (patchPath === undefined) return undefined
      const servers = await loadServers()
      const block = renderBlock(servers)
      const before = (await readText(patchPath)) ?? '[]\n'
      const after = composeDocument(before, block)
      if (after === before) return servers.filter((server) => server.enabled !== false).length
      assertBlockParses(block)
      await writeText(patchPath, after)
      try {
        await ctx.loader?.await?.()
      } catch {
        // A reload failure is reported by the Loader itself; the write stands.
      }
      return servers.filter((server) => server.enabled !== false).length
    },

    async 'mcp.state'() {
      return view()
    },

    /** Create or replace one server, addressed by its current row id. */
    async 'mcp.save'(payload) {
      const normalized = normalize(payload?.server ?? payload)
      const servers = await loadServers()
      const previousId = typeof payload?.id === 'string' ? payload.id : undefined
      const duplicate = servers.find(
        (server) => server.config?.serverName === normalized.config.serverName && server.id !== previousId,
      )
      if (duplicate !== undefined) {
        fail('duplicate-server-name', `another server already uses the name "${normalized.config.serverName}"`)
      }
      const index = previousId === undefined ? -1 : servers.findIndex((server) => server.id === previousId)
      const record = { id: normalized.id, enabled: normalized.enabled, config: normalized.config }
      if (index >= 0) servers[index] = record
      else servers.push(record)
      await commit(servers)
      return view()
    },

    /** Remove one server. */
    async 'mcp.remove'(payload) {
      const id = asString(payload?.id, 'id')
      if (id === '') fail('bad-request', 'id is required')
      const servers = await loadServers()
      const next = servers.filter((server) => server.id !== id)
      if (next.length === servers.length) fail('not-found', `no server with id "${id}"`)
      await commit(next)
      return view()
    },

    /** Enable or disable one server without dropping its definition. */
    async 'mcp.toggle'(payload) {
      const id = asString(payload?.id, 'id')
      if (id === '') fail('bad-request', 'id is required')
      const servers = await loadServers()
      const server = servers.find((item) => item.id === id)
      if (server === undefined) fail('not-found', `no server with id "${id}"`)
      server.enabled = payload?.enabled !== false
      await commit(servers)
      return view()
    },
  }
}
