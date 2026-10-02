/**
 * Client-bundle smoke test for dsh-control-center.
 *
 * The browser half cannot be server-rendered here — React ships inside the
 * Harness frontend bundle, not on disk — so this harness supplies its own
 * minimal React: `createElement` returns a plain node, hooks are a tiny scope
 * table keyed by render path, and effects run between passes. That is enough to
 * execute the real bundle, register the real slot entries, and render every
 * section through a loading pass and a data pass with stubbed host responses.
 *
 * It catches what a syntax check cannot: a wrong slot id or order, a component
 * that throws on its first render, a field read from a shape the host does not
 * send.
 *
 *     node scripts/clientsmoke.mjs
 */
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = fileURLToPath(new URL('..', import.meta.url))

let failures = 0
let checks = 0
function check(label, condition, detail) {
  checks += 1
  if (condition) console.log(`  ok   ${label}`)
  else {
    failures += 1
    console.log(`  FAIL ${label}${detail === undefined ? '' : ` — ${detail}`}`)
  }
}
function equal(label, actual, expected) {
  check(label, JSON.stringify(actual) === JSON.stringify(expected), `got ${JSON.stringify(actual)}, want ${JSON.stringify(expected)}`)
}

// ── the stub React ──────────────────────────────────────────────────────────
const scopes = new Map()

const React = {
  Fragment: 'Fragment',
  createElement(type, props, ...children) {
    const flat = children.length === 0 ? undefined : children.length === 1 ? children[0] : children
    return { type, props: { ...(props ?? {}), children: flat } }
  },
  useState(initial) {
    const scope = current()
    const index = scope.cursor++
    if (!(index in scope.state)) scope.state[index] = typeof initial === 'function' ? initial() : initial
    return [
      scope.state[index],
      (next) => {
        scope.state[index] = typeof next === 'function' ? next(scope.state[index]) : next
      },
    ]
  },
  useRef(initial) {
    const scope = current()
    const index = scope.cursor++
    if (!(index in scope.state)) scope.state[index] = { current: initial }
    return scope.state[index]
  },
  useCallback(fn) {
    current().cursor += 1
    return fn
  },
  useMemo(fn) {
    current().cursor += 1
    return fn()
  },
  useEffect(fn) {
    const scope = current()
    const index = scope.cursor++
    if (scope.effects.includes(index)) return
    scope.effects.push(index)
    scope.pending.push(fn)
  },
}

let activeScope = null
function current() {
  if (activeScope === null) throw new Error('a hook ran outside a component')
  return activeScope
}

/**
 * Evaluate one element tree to markup and collect the effects its components
 * registered. Each component occurrence owns one hook scope keyed by its stable
 * render path, which is what makes several passes over the same component share
 * state the way a real renderer does.
 */
function evalNode(node, path, effects) {
  if (node === null || node === undefined || node === false || node === true) return ''
  if (Array.isArray(node)) return node.map((child, index) => evalNode(child, `${path}.${index}`, effects)).join('')
  if (typeof node === 'string' || typeof node === 'number') return String(node)
  const { type, props } = node
  if (typeof type === 'function') {
    const scope = scopes.get(path) ?? { state: {}, cursor: 0, effects: [], pending: [] }
    scopes.set(path, scope)
    const previous = activeScope
    activeScope = scope
    scope.cursor = 0
    scope.pending = []
    let output
    try {
      output = type(props ?? {})
    } finally {
      activeScope = previous
    }
    effects.push(...scope.pending)
    return evalNode(output, `${path}/f`, effects)
  }
  return `<${type}>${evalNode(props?.children, `${path}/c`, effects)}</${type}>`
}

/** Render one pass, then run the effects that pass registered. */
async function pass(component, props) {
  const effects = []
  evalNode(React.createElement(component, props), 'root', effects)
  for (const effect of effects) {
    if (typeof effect === 'function') effect()
  }
  // Two turns let the stubbed fetch resolve and its continuation run.
  await new Promise((resolve) => setTimeout(resolve, 0))
  await new Promise((resolve) => setTimeout(resolve, 0))
}

/** Render once and return the tree's visible text. */
function textOf(component, props) {
  const effects = []
  const markup = evalNode(React.createElement(component, props), 'root', effects)
  return markup.replace(/<\/?[a-zA-Z][^>]*>/g, ' ').replace(/\s+/g, ' ').trim()
}

// ── the browser globals the bundle touches ──────────────────────────────────
const FIXTURES = {
  'mcp.state': {
    available: true,
    patchPath: 'C:\\profile\\cordis.patch.yml',
    servers: [
      {
        id: 'cc-mcp-github',
        serverName: 'github',
        transport: 'stdio',
        enabled: true,
        config: { serverName: 'github', transport: 'stdio', command: 'npx', args: ['-y', 'pkg'] },
        live: { mounted: true, disabled: false, active: true },
      },
    ],
  },
  'skill.state': {
    roots: [{ id: 'user-dsh', label: '用户技能目录', path: 'C:/skills', editable: true }],
    userRoot: 'C:/skills',
    skills: [
      {
        id: 'user-dsh:demo/SKILL.md',
        name: 'demo',
        description: 'A demo skill',
        whenToUse: '',
        disableModelInvocation: false,
        rootId: 'user-dsh',
        rootLabel: '用户技能目录',
        rootPath: 'C:/skills',
        editable: true,
        kind: 'bundle',
        fileName: 'SKILL.md',
        path: 'C:/skills/demo/SKILL.md',
        mtime: 1,
        warnings: [],
      },
    ],
  },
  'persona.state': {
    available: true,
    sectionName: 'control-center:persona',
    sectionOrder: 5,
    activeId: 'p1',
    personas: [{ id: 'p1', name: '严谨工程师', description: 'short answers', updatedAt: 1 }],
    storagePath: 'C:/personas',
  },
}

const calls = []
const fakeWindow = {
  __ModuleLoader__: {
    load(spec) {
      globalThis.__loaded = spec
    },
  },
}
// Node 24 already owns a global `navigator`, so the browser globals are passed
// as function parameters that shadow it rather than assigned globally.
//
// Deliberately adversarial: the browser reports English and `<html lang>` is
// still empty, because the locale plugin writes it asynchronously. Only the
// locale service knows the user's real DSH language ('zh'). A bundle that
// latches the DOM or the browser language renders English here — which is the
// reported bug.
const fakeDocument = { documentElement: { lang: '' } }
const fakeNavigator = { language: 'en-US' }
const localeListeners = new Set()
const fakeLocale = {
  getSnapshot: () => ({ active: fakeLocale.active, locales: [], revision: fakeLocale.revision }),
  subscribe(listener) {
    localeListeners.add(listener)
    return () => localeListeners.delete(listener)
  },
  /** Test helper: switch the DSH language and notify, as the real service does. */
  setActive(id) {
    fakeLocale.active = id
    fakeLocale.revision += 1
    for (const listener of [...localeListeners]) listener()
  },
  active: 'zh',
  revision: 0,
}
const fakeFetch = async (url, options) => {
  const body = JSON.parse(options.body)
  calls.push(body.method)
  const value = FIXTURES[body.method]
  return {
    ok: true,
    status: 200,
    json: async () => (value === undefined ? { ok: false, error: { code: 'not-found', message: body.method } } : { ok: true, value }),
  }
}

// ── load the real bundle ────────────────────────────────────────────────────
const source = await readFile(join(here, 'client.js'), 'utf8')
// eslint-disable-next-line no-new-func
new Function('window', 'document', 'navigator', 'fetch', source)(fakeWindow, fakeDocument, fakeNavigator, fakeFetch)

console.log('\nbundle')
const spec = globalThis.__loaded
check('the bundle registers itself with the module loader', spec !== undefined)
equal('the module id is the package name', spec?.id, 'dsh-control-center')
check('the factory is a function', typeof spec?.factory === 'function')

const plugin = spec.factory((name) => {
  if (name === 'react') return React
  throw new Error(`the bundle required an unexpected module: ${name}`)
})
equal('the plugin injects the slot registry and the locale service', plugin.inject, ['slots', 'locale'])
check('the plugin has an apply', typeof plugin.apply === 'function')

console.log('\nslot registration')
const registered = []
const injected = []
plugin.apply({
  slots: {
    inject(key, callback) {
      injected.push(key)
      callback()
    },
    register(options, component) {
      registered.push({ options, component })
    },
  },
  locale: fakeLocale,
})
equal('every contribution waits on the settings Section ledger', [...new Set(injected)], ['settings.section'])
equal('three sections registered', registered.length, 3)
equal('the MCP section id', registered[0].options.id, 'control-center-mcp')
equal('the skill section id', registered[1].options.id, 'control-center-skills')
equal('the persona section id', registered[2].options.id, 'control-center-persona')
equal('the declared slot name', registered.map((item) => item.options.name), ['settings.section', 'settings.section', 'settings.section'])
check('orders are distinct', new Set(registered.map((item) => item.options.order)).size === 3)
equal('labels follow the page language', registered.map((item) => item.options.label()), ['MCP 管理', 'Skill 管理', '全局人设'])
check('each section has a component', registered.every((item) => typeof item.component === 'function'))

console.log('\nrendering')
const observed = []
for (const { options, component } of registered) {
  // Each section is its own render root; the hook scopes must not leak between
  // them the way two different components never share a fiber.
  scopes.clear()
  calls.length = 0
  // The first pass has no data yet; the effects it registers fetch it.
  await pass(component, {})
  // The second pass sees the response.
  const text = textOf(component, {})
  observed.push(...calls)
  const label = options.label()
  check(`${label}: renders without throwing`, text.length > 0)
  if (options.id === 'control-center-mcp') {
    check(`${label}: shows the configured server`, text.includes('github'), text.slice(0, 200))
    check(`${label}: shows the connected state`, text.includes('已连接'), text.slice(0, 200))
    check(`${label}: shows the patch path`, text.includes('cordis.patch.yml'))
  }
  if (options.id === 'control-center-skills') {
    check(`${label}: shows the installed skill`, text.includes('demo'), text.slice(0, 200))
    check(`${label}: shows the install root`, text.includes('C:/skills'))
    check(`${label}: offers the GitHub pull`, text.includes('拉取并安装') || text.includes('Pull'), text.slice(0, 400))
  }
  if (options.id === 'control-center-persona') {
    check(`${label}: shows the persona`, text.includes('严谨工程师'), text.slice(0, 200))
    check(`${label}: marks the active persona`, text.includes('已启用'), text.slice(0, 200))
    check(`${label}: shows the persona section name in the host reply`, FIXTURES['persona.state'].sectionName === 'control-center:persona')
  }
}

equal(
  'every section asked the host for its state',
  [...new Set(observed)].sort(),
  ['mcp.state', 'persona.state', 'skill.state'],
)

// ── locale ──────────────────────────────────────────────────────────────────
// The regression this guards: the copy was resolved once at module-evaluation
// time from `<html lang>` / `navigator.language`, both of which can disagree
// with the user's DSH language (the attribute is written asynchronously, the
// browser language is a separate fact). The result was copy that depended on
// load order. It must follow the locale service, live.
console.log('\nlocale')

const skillsSection = registered.find((item) => item.options.id === 'control-center-skills')
// The render loop clears the hook scopes between sections, so the skills
// section is re-established here (one pass to fetch, one to render).
scopes.clear()
calls.length = 0
await pass(skillsSection.component, {})

check(
  'the browser language and <html lang> are a deliberate mismatch',
  fakeDocument.documentElement.lang === '' && fakeNavigator.language === 'en-US',
  `lang="${fakeDocument.documentElement.lang}" navigator="${fakeNavigator.language}"`,
)
equal('labels follow the DSH language, not the browser', registered.map((item) => item.options.label()), ['MCP 管理', 'Skill 管理', '全局人设'])

const skillsText = textOf(skillsSection.component, {})
check('the body follows the DSH language too', skillsText.includes('拉取并安装'), skillsText.slice(0, 300))
check('the body does not fall back to the browser language', !skillsText.includes('Pull and install'), skillsText.slice(0, 300))
check('a section subscribes to the locale service', localeListeners.size > 0, `${localeListeners.size} listener(s)`)

fakeLocale.setActive('en')
equal('a live switch updates the labels', registered.map((item) => item.options.label()), ['MCP servers', 'Skills', 'Global persona'])
const englishText = textOf(skillsSection.component, {})
check('a live switch updates the body', englishText.includes('Pull and install'), englishText.slice(0, 300))

fakeLocale.setActive('zh-TW')
equal('a regional zh tag counts as Chinese', registered.map((item) => item.options.label()), ['MCP 管理', 'Skill 管理', '全局人设'])

console.log(`\n${checks - failures}/${checks} checks passed`)
process.exit(failures === 0 ? 0 : 1)
