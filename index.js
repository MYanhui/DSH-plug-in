/**
 * dsh-control-center — host half.
 *
 * Serves one JSON API for the three Settings pages (MCP servers, skills, global
 * personas) and owns the one model-facing contribution this plugin makes: the
 * active persona's system-prompt section.
 *
 * The API is intentionally one route with a `method` field rather than a route
 * per operation: the host webserver matches named routes exactly or by longest
 * prefix, and one prefix keeps the surface small enough to fence in one place
 * (see `lib/wire.js#fenced`).
 *
 * Everything is registered through `ctx.effect`, so disabling the plugin or
 * reloading the profile removes the route and the prompt section together.
 */
import { readText, dataRoot, dshHome, profilePatchPath, userSkillRoot } from './lib/paths.js'
import { createMcpApi } from './lib/mcp.js'
import { createPersonaApi } from './lib/personas.js'
import { createSkillApi } from './lib/skills.js'
import { ControlCenterError, fenced, json, readJsonBody } from './lib/wire.js'

/** Host services this plugin cannot work without. */
export const inject = ['webServer', 'systemPrompt']

export function apply(ctx) {
  const mcp = createMcpApi(ctx)
  const skills = createSkillApi(ctx)
  const personas = createPersonaApi(ctx)

  const table = { ...mcp, ...skills, ...personas, ...environmentApi(ctx) }

  ctx.effect(
    () =>
      ctx.webServer.register({
        kind: 'prefix',
        path: '/control-center/api',
        handler: async (req, res) => {
          if (!fenced(req)) {
            json(res, 403, { ok: false, error: { code: 'forbidden', message: 'untrusted request origin' } })
            return
          }
          if (req.method !== 'POST') {
            json(res, 405, { ok: false, error: { code: 'method-error', message: 'this API is POST-only' } })
            return
          }
          let payload
          try {
            payload = await readJsonBody(req)
          } catch (error) {
            json(res, 400, { ok: false, error: { code: 'bad-request', message: messageOf(error) } })
            return
          }
          const method = typeof payload.method === 'string' ? payload.method : ''
          const handler = table[method]
          if (typeof handler !== 'function') {
            json(res, 404, { ok: false, error: { code: 'not-found', message: `unknown API method "${method}"` } })
            return
          }
          try {
            json(res, 200, { ok: true, value: await handler(payload) })
          } catch (error) {
            const code = error instanceof ControlCenterError ? error.code : 'internal-error'
            if (code === 'internal-error') ctx.logger?.warn?.('dsh-control-center: %s failed: %o', method, error)
            json(res, 200, { ok: false, error: { code, message: messageOf(error) } })
          }
        },
      }),
    'dsh-control-center: /control-center/api route',
  )

  // The persona section lives on this plugin's context, so a profile reload or a
  // plugin disable disposes it with everything else. The install is not awaited:
  // a broken persona document must not keep the pages themselves from loading.
  ctx.effect(() => {
    void personas.install().catch((error) => {
      ctx.logger?.warn?.('dsh-control-center: the active persona could not be mounted: %o', error)
    })
    return () => personas.dispose()
  }, 'dsh-control-center: active persona prompt section')

  // Re-assert the stored MCP definitions in the profile patch. This is what
  // makes the store authoritative: after an uninstall that cleaned the managed
  // block, or a profile restored from a backup, reinstalling restores the rows
  // without the user re-entering anything. A patch that already agrees is not
  // touched, so an ordinary boot writes nothing.
  ctx.effect(() => {
    void mcp.reconcile()
      .then((rows) => {
        if (typeof rows === 'number' && rows > 0) {
          ctx.logger?.info?.('dsh-control-center: %d MCP server row(s) are mounted', rows)
        }
      })
      .catch((error) => {
        ctx.logger?.warn?.('dsh-control-center: the MCP managed block could not be reconciled: %o', error)
      })
    return () => {}
  }, 'dsh-control-center: MCP managed block reconciliation')
}

/** Paths and versions the pages display; no mutation lives here. */
function environmentApi(ctx) {
  return {
    async 'system.info'() {
      const patchPath = profilePatchPath(ctx)
      const profile = ctx.get('profileContext')
      const packageDocument = await readText(new URL('./package.json', import.meta.url))
      let version = '0.0.0'
      try {
        version = JSON.parse(packageDocument ?? '{}').version ?? version
      } catch {
        // A malformed manifest is not worth failing the page over.
      }
      return {
        version,
        dshHome: dshHome(),
        dataRoot: dataRoot(),
        skillsRoot: userSkillRoot(),
        profilePatch: patchPath ?? null,
        profile: profile?.name ?? process.env.DSH_PROFILE ?? null,
      }
    },
  }
}

function messageOf(error) {
  return error instanceof Error ? error.message : String(error)
}
