/**
 * Global persona management.
 *
 * The user-facing model here is "several named persona documents, one of them
 * active", which is the CLAUDE.md idea generalized: a library of markdown files
 * with exactly one switched on.
 *
 * How the active persona reaches the model is the part worth stating. The
 * harness owns prompt assembly, and its documented extension point for adding
 * prompt text is `ctx.systemPrompt.section()`. This plugin therefore registers
 * ONE section — `control-center:persona` at order `5`, immediately after the
 * deployment persona prefix at order `0` — whose text is the active document.
 * Three consequences follow, and all of them are intended:
 *
 *  - It is additive. The deployment's own persona, the harness identity, the
 *    tool guidance and the environment suffix all stay exactly as they are.
 *  - It is global. A preset that shadows `deployment:persona-prefix` for one
 *    agent does not remove this section, so the page governs every session.
 *  - It is literal. `interpolate: false` keeps `{{…}}` in a persona document as
 *    written; a persona is prose, not a prompt template, and a stray brace must
 *    never fail assembly.
 *
 * Changing the active document disposes and re-registers that section, which is
 * the only supported way to change a section's text. The change reaches the
 * next assembly; a prompt already sent is history.
 */
import { mkdir, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { dataRoot, readJson, readText, writeJson, writeText } from './paths.js'
import { fail } from './wire.js'

/** This plugin's prompt section name; stable, and unique in the composition. */
export const PERSONA_SECTION = 'control-center:persona'
/** Placement: after the deployment persona prefix (order 0), before tool guidance. */
export const PERSONA_ORDER = 5

function indexPath() {
  return join(dataRoot(), 'personas.json')
}
function filePath(id) {
  return join(dataRoot(), 'personas', `${id}.md`)
}

async function loadIndex() {
  const document = await readJson(indexPath(), { version: 1, activeId: null, personas: [] })
  const personas = Array.isArray(document?.personas) ? document.personas : []
  return {
    version: 1,
    activeId: typeof document?.activeId === 'string' && document.activeId !== '' ? document.activeId : null,
    personas: personas
      .filter((persona) => persona !== null && typeof persona === 'object' && typeof persona.id === 'string')
      .map((persona) => ({
        id: persona.id,
        name: typeof persona.name === 'string' && persona.name !== '' ? persona.name : persona.id,
        description: typeof persona.description === 'string' ? persona.description : '',
        updatedAt: typeof persona.updatedAt === 'number' ? persona.updatedAt : null,
      })),
  }
}

async function saveIndex(index) {
  await writeJson(indexPath(), index)
}

function makeId(name, taken) {
  const base = String(name ?? '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
  const seed = base === '' ? 'persona' : base
  if (!taken.has(seed)) return seed
  for (let suffix = 2; suffix < 1000; suffix += 1) {
    const candidate = `${seed}-${suffix}`
    if (!taken.has(candidate)) return candidate
  }
  return `${seed}-${Date.now().toString(36)}`
}

export function createPersonaApi(ctx) {
  /** The live section disposer, replaced whenever the active document changes. */
  let disposeSection
  let mountedText

  function unmount() {
    if (disposeSection !== undefined) {
      try {
        disposeSection()
      } catch {
        // The owning context may already be gone; there is nothing to restore.
      }
    }
    disposeSection = undefined
    mountedText = undefined
  }

  function mount(text) {
    if (text === mountedText) return
    unmount()
    mountedText = text
    if (text === undefined || text.trim() === '') return
    const systemPrompt = ctx.get('systemPrompt')
    if (systemPrompt === undefined || systemPrompt === null || typeof systemPrompt.section !== 'function') return
    disposeSection = systemPrompt.section({
      name: PERSONA_SECTION,
      order: PERSONA_ORDER,
      text,
      interpolate: false,
    })
  }

  /** Re-read the active document and (re)mount its section. */
  async function refresh() {
    const index = await loadIndex()
    if (index.activeId === null) {
      mount(undefined)
      return
    }
    const text = await readText(filePath(index.activeId))
    if (text === undefined) {
      // The index points at a document that is gone; report it as inactive
      // rather than leaving a stale section mounted.
      index.activeId = null
      await saveIndex(index)
      mount(undefined)
      return
    }
    mount(text)
  }

  async function view() {
    const index = await loadIndex()
    return {
      available: ctx.get('systemPrompt') !== undefined,
      sectionName: PERSONA_SECTION,
      sectionOrder: PERSONA_ORDER,
      activeId: index.activeId,
      personas: index.personas,
      storagePath: join(dataRoot(), 'personas'),
    }
  }

  async function readOne(id) {
    const index = await loadIndex()
    const persona = index.personas.find((item) => item.id === id)
    if (persona === undefined) fail('not-found', `no persona with id "${id}"`)
    const text = (await readText(filePath(id))) ?? ''
    return { persona, text, activeId: index.activeId }
  }

  return {
    /** Install the section now and keep it in step with every later mutation. */
    async install() {
      await refresh()
    },

    /** Tear the section down with the plugin. */
    dispose() {
      unmount()
    },

    async 'persona.state'() {
      return view()
    },

    /** Read one persona's document. */
    async 'persona.read'(payload) {
      const id = String(payload?.id ?? '')
      if (id === '') return { persona: null, text: '', activeId: (await loadIndex()).activeId }
      return readOne(id)
    },

    /** Create a persona, or update one in place. */
    async 'persona.save'(payload) {
      const index = await loadIndex()
      const taken = new Set(index.personas.map((persona) => persona.id))
      const requestedId = typeof payload?.id === 'string' && payload.id !== '' ? payload.id : undefined
      const name = String(payload?.name ?? '').trim()
      if (name === '') fail('bad-request', 'a persona name is required')
      const body = String(payload?.body ?? '')

      let id = requestedId
      if (id === undefined) {
        id = makeId(name, taken)
        index.personas.push({ id, name, description: String(payload?.description ?? ''), updatedAt: Date.now() })
      } else {
        const persona = index.personas.find((item) => item.id === id)
        if (persona === undefined) fail('not-found', `no persona with id "${id}"`)
        persona.name = name
        persona.description = String(payload?.description ?? persona.description ?? '')
        persona.updatedAt = Date.now()
      }

      await mkdir(join(dataRoot(), 'personas'), { recursive: true })
      await writeText(filePath(id), body.endsWith('\n') || body === '' ? body : `${body}\n`)

      if (payload?.activate === true || index.activeId === null) index.activeId = id
      await saveIndex(index)
      await refresh()
      return { ...(await view()), id }
    },

    /** Delete a persona and clear it from the active seat when it held it. */
    async 'persona.remove'(payload) {
      const id = String(payload?.id ?? '')
      const index = await loadIndex()
      const next = index.personas.filter((persona) => persona.id !== id)
      if (next.length === index.personas.length) fail('not-found', `no persona with id "${id}"`)
      index.personas = next
      if (index.activeId === id) index.activeId = null
      await saveIndex(index)
      await rm(filePath(id), { force: true })
      await refresh()
      return view()
    },

    /** Switch the active persona (or clear it with a null id). */
    async 'persona.activate'(payload) {
      const index = await loadIndex()
      const raw = payload?.id
      if (raw === null || raw === undefined || raw === '') {
        index.activeId = null
      } else {
        const id = String(raw)
        if (!index.personas.some((persona) => persona.id === id)) fail('not-found', `no persona with id "${id}"`)
        index.activeId = id
      }
      await saveIndex(index)
      await refresh()
      return view()
    },
  }
}
