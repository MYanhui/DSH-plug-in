/**
 * Skill management.
 *
 * A skill is not a document this plugin owns: the filesystem skill provider
 * (`@deepseek-ai/dsh-skill-filesystem`) discovers `<root>/<name>/SKILL.md`
 * bundles and `<root>/<name>.md` flat files one level below each scanned root,
 * and watches those roots. So this page is a filesystem editor over those
 * roots, not a database:
 *
 *  - The user root `<DSH_HOME>/skills` (provider rank 400) is where installs
 *    go; it is created on demand.
 *  - The shared agent root `<AGENTS_HOME>/skills` (rank 500) and any
 *    `customSkillDirs` declared by a live `skill-filesystem` row are listed
 *    too, so the page shows what the model can actually see.
 *  - Project roots (`.dsh/skills`, `.agents/skills` under a workspace) depend on
 *    the session's working directory rather than on this global page, so they
 *    are deliberately left out.
 *
 * A GitHub install downloads one source archive, finds every `SKILL.md` in it
 * at a plausible depth, and writes each bundle into the user root. Nothing is
 * written outside the resolved root: every candidate path is re-checked against
 * it before use.
 */
import { mkdir, readdir, rm, stat, unlink } from 'node:fs/promises'
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path'
import { agentsSkillRoot, dshHome, readText, userSkillRoot, writeText } from './paths.js'
import { fail } from './wire.js'
import { fetchRepoArchive } from './github.js'

const SKILL_NAME_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

// ── frontmatter ─────────────────────────────────────────────────────────────

/**
 * Split a skill file into its frontmatter fields and body.
 * The parser covers the provider's documented subset: scalar keys, and the
 * literal (`|`) and folded (`>`) block forms.
 */
export function parseSkillFile(text) {
  const normalized = text.replace(/\r\n/g, '\n')
  if (!normalized.startsWith('---\n') && normalized.trimStart() !== '---') {
    return { fields: {}, body: normalized, error: 'the file does not start with a YAML frontmatter block' }
  }
  const start = normalized.indexOf('\n') + 1
  const end = normalized.indexOf('\n---', start)
  if (end < 0) return { fields: {}, body: normalized, error: 'the frontmatter block is not closed with "---"' }
  const header = normalized.slice(start, end)
  let body = normalized.slice(end + 4)
  body = body.replace(/^\n+/, '')

  const fields = {}
  const lines = header.split('\n')
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]
    if (line.trim() === '' || line.trimStart().startsWith('#')) continue
    const match = /^([A-Za-z0-9_.-]+):(.*)$/.exec(line)
    if (match === null) continue
    const key = match[1]
    const rest = match[2].trim()
    if (rest === '|' || rest === '>' || rest === '|-' || rest === '>-' || rest === '|+' || rest === '>+') {
      const collected = []
      while (index + 1 < lines.length && (lines[index + 1].startsWith('  ') || lines[index + 1].trim() === '')) {
        index += 1
        collected.push(lines[index].replace(/^ {1,2}/, ''))
      }
      fields[key] = rest.startsWith('>') ? collected.join(' ').trim() : collected.join('\n').trim()
      continue
    }
    fields[key] = unquote(rest)
  }
  return { fields, body, error: undefined }
}

function unquote(value) {
  const text = value.trim()
  if (text.length >= 2 && text.startsWith('"') && text.endsWith('"')) {
    try {
      return JSON.parse(text)
    } catch {
      return text.slice(1, -1)
    }
  }
  if (text.length >= 2 && text.startsWith("'") && text.endsWith("'")) return text.slice(1, -1)
  return text
}

function scalar(value) {
  const text = String(value ?? '')
  if (text === '') return '""'
  if (/^[A-Za-z0-9][A-Za-z0-9 _.,;!?()/[\]'-]*$/.test(text) && !text.includes(': ') && text.length <= 200) return text
  return JSON.stringify(text)
}

/** Compose a skill file from its fields and body. */
export function composeSkillFile({ name, description, whenToUse, body }) {
  const lines = ['---', `name: ${scalar(name)}`, `description: ${scalar(description)}`]
  if (whenToUse !== undefined && String(whenToUse).trim() !== '') lines.push(`whenToUse: ${scalar(whenToUse)}`)
  lines.push('---', '')
  return `${lines.join('\n')}${String(body ?? '').replace(/\r\n/g, '\n').replace(/\s+$/, '')}\n`
}

function strictBoolean(value, field) {
  if (value === undefined) return undefined
  const text = String(value).trim().toLowerCase()
  if (['true', 'yes', 'on', '1'].includes(text)) return true
  if (['false', 'no', 'off', '0'].includes(text)) return false
  return { invalid: field }
}

// ── roots ───────────────────────────────────────────────────────────────────

/** Whether `target` is inside `root` (a path-escape guard for every write). */
function inside(root, target) {
  const rel = relative(resolve(root), resolve(target))
  return rel !== '' && !rel.startsWith('..') && !isAbsolute(rel)
}

/**
 * The scanned roots this page manages, in provider rank order, with any
 * `customSkillDirs` a live `skill-filesystem` row declares merged in.
 */
export function skillRoots(ctx) {
  const roots = [
    { id: 'user-dsh', label: '用户技能目录 (DSH_HOME/skills)', path: userSkillRoot(), editable: true, rank: 400 },
    { id: 'user-agents', label: '共享 Agent 目录 (~/.agents/skills)', path: agentsSkillRoot(), editable: true, rank: 500 },
  ]
  const loader = ctx?.loader
  if (loader !== undefined && typeof loader.entries === 'function') {
    for (const entry of loader.entries()) {
      if (entry?.options?.name !== '@deepseek-ai/dsh-skill-filesystem') continue
      const dirs = entry.options.config?.customSkillDirs
      if (!Array.isArray(dirs)) continue
      for (const dir of dirs) {
        if (typeof dir !== 'string' || dir === '') continue
        const path = isAbsolute(dir) ? dir : join(dshHome(), dir)
        if (roots.some((root) => resolve(root.path) === resolve(path))) continue
        roots.push({ id: `custom:${path}`, label: `自定义目录 (${dir})`, path, editable: true, rank: 300 })
      }
    }
  }
  return roots
}

/** Locate a skill by the id the list returned, or return `undefined`. */
function locate(roots, id) {
  for (const root of roots) {
    const prefix = `${root.id}:`
    if (!id.startsWith(prefix)) continue
    const rest = id.slice(prefix.length)
    const slash = rest.indexOf('/')
    // A bundle id is `<root>:<name>/SKILL.md`; the skill's own name is the
    // directory, never the file inside it.
    if (slash < 0) return { root, kind: 'flat', name: rest }
    return { root, kind: 'bundle', name: rest.slice(0, slash) }
  }
  return undefined
}

function skillPathFor(root, kind, name) {
  if (kind === 'flat') return join(root.path, `${name}.md`)
  return join(root.path, name, 'SKILL.md')
}

// ── discovery ───────────────────────────────────────────────────────────────

async function describe(root, kind, name, path) {
  let text
  try {
    text = await readText(path)
  } catch {
    return undefined
  }
  if (text === undefined) return undefined
  const { fields, error } = parseSkillFile(text)
  const invalid = strictBoolean(fields['disable-model-invocation'], 'disable-model-invocation')
  const invalidUser = strictBoolean(fields['user-invocable'], 'user-invocable')
  const warnings = []
  if (error !== undefined) warnings.push(error)
  if (typeof fields.name !== 'string' || fields.name === '') warnings.push('frontmatter has no "name"')
  if (typeof fields.description !== 'string' || fields.description === '') warnings.push('frontmatter has no "description"')
  if (invalid !== undefined && typeof invalid === 'object') warnings.push(`invalid ${invalid.invalid} value`)
  if (invalidUser !== undefined && typeof invalidUser === 'object') warnings.push(`invalid ${invalidUser.invalid} value`)

  let mtime = null
  try {
    mtime = (await stat(path)).mtimeMs
  } catch {
    mtime = null
  }

  return {
    id: kind === 'flat' ? `${root.id}:${name}` : `${root.id}:${name}/SKILL.md`,
    name: typeof fields.name === 'string' && fields.name !== '' ? fields.name : name,
    description: typeof fields.description === 'string' ? fields.description : '',
    whenToUse: typeof fields.whenToUse === 'string' ? fields.whenToUse : '',
    disableModelInvocation: invalid === true,
    userInvocable: invalidUser === false ? false : undefined,
    rootId: root.id,
    rootLabel: root.label,
    rootPath: root.path,
    editable: root.editable !== false,
    kind,
    fileName: basename(path),
    path,
    mtime,
    warnings,
  }
}

async function listRoot(root) {
  let entries
  try {
    entries = await readdir(root.path, { withFileTypes: true })
  } catch (error) {
    if (error?.code === 'ENOENT' || error?.code === 'ENOTDIR') return []
    throw error
  }
  const found = []
  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue
    if (entry.isDirectory()) {
      const record = await describe(root, 'bundle', entry.name, join(root.path, entry.name, 'SKILL.md'))
      if (record !== undefined) found.push(record)
      continue
    }
    if (!entry.isFile() || !entry.name.toLowerCase().endsWith('.md')) continue
    if (entry.name.toLowerCase() === 'skill.md') continue
    const record = await describe(root, 'flat', entry.name.slice(0, -3), join(root.path, entry.name))
    if (record !== undefined) found.push(record)
  }
  return found
}

// ── GitHub install ──────────────────────────────────────────────────────────

function installNameFor(skillDir, fields) {
  const declared = typeof fields.name === 'string' ? fields.name.trim() : ''
  if (SKILL_NAME_PATTERN.test(declared)) return declared
  const fallback = basename(skillDir).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
  return SKILL_NAME_PATTERN.test(fallback) ? fallback : 'skill'
}

/**
 * Find every skill bundle in an unpacked archive. A skill directory is any
 * directory holding a `SKILL.md`; `subpath` narrows the search to one subtree.
 * Exported for the package's own checks.
 */
export function findSkillDirectories(entries, subpath) {
  const scope = subpath === undefined || subpath === '' ? '' : `${subpath.replace(/^\/+|\/+$/g, '')}/`
  const scoped = entries.filter((entry) => scope === '' || entry.name.startsWith(scope))
  const files = scoped.filter((entry) => entry.type === 'file')
  const skillFiles = files.filter((entry) => entry.name === 'SKILL.md' || entry.name.endsWith('/SKILL.md'))
  if (skillFiles.length === 0) return []
  const directories = new Set()
  for (const file of skillFiles) {
    const dir = file.name.includes('/') ? file.name.slice(0, file.name.lastIndexOf('/')) : ''
    const depth = dir === '' ? 0 : dir.split('/').length
    // A repository layout never nests a skill deeper than a few levels; a deeper
    // hit is a fixture or an example, not an installable skill.
    if (depth > 5) continue
    directories.add(dir)
  }
  return [...directories].map((dir) => {
    const prefix = dir === '' ? '' : `${dir}/`
    const members = files
      .filter((entry) => (prefix === '' ? !entry.name.includes('/') : entry.name.startsWith(prefix)))
      .map((entry) => ({ path: prefix === '' ? entry.name : entry.name.slice(prefix.length), data: entry.data }))
      .filter((member) => member.path !== '')
    return { dir, members }
  })
}

// ── API ─────────────────────────────────────────────────────────────────────

function requireName(value) {
  const name = String(value ?? '').trim()
  if (!SKILL_NAME_PATTERN.test(name)) {
    fail('invalid-skill-name', 'skill names are kebab-case: lowercase letters, digits and single hyphens')
  }
  return name
}

function requireEditable(root) {
  if (root.editable === false) fail('read-only-root', `the root "${root.label}" is read-only here`)
}

export function createSkillApi(ctx) {
  const roots = () => skillRoots(ctx)

  async function listAll() {
    const all = []
    for (const root of roots()) all.push(...(await listRoot(root)))
    all.sort((a, b) => a.name.localeCompare(b.name) || a.rootId.localeCompare(b.rootId))
    return all
  }

  return {
    async 'skill.state'() {
      const all = await listAll()
      return {
        roots: roots().map((root) => ({ id: root.id, label: root.label, path: root.path, editable: root.editable !== false })),
        skills: all,
        userRoot: userSkillRoot(),
      }
    },

    /** Read one skill's current file. */
    async 'skill.read'(payload) {
      const id = String(payload?.id ?? '')
      const all = await listAll()
      const record = all.find((item) => item.id === id)
      if (record === undefined) fail('not-found', `no installed skill with id "${id}"`)
      const text = (await readText(record.path)) ?? ''
      return { skill: record, text }
    },

    /** Create or overwrite a skill from its form fields. */
    async 'skill.save'(payload) {
      const target = payload?.id === undefined || payload?.id === '' ? undefined : locate(roots(), String(payload.id))
      const name = requireName(payload?.name)
      const description = String(payload?.description ?? '').trim()
      if (description === '') fail('bad-request', 'a description is required — the model reads it to decide when to load the skill')
      const root = target?.root ?? roots()[0]
      requireEditable(root)
      const kind = 'bundle'
      const path = skillPathFor(root, kind, name)

      // A rename leaves the previous bundle behind; refuse rather than guess.
      if (target !== undefined && (target.kind !== kind || target.name !== name)) {
        const previous = skillPathFor(target.root, target.kind, target.name)
        if (previous !== path) await removeSkill(target.root, target.kind, target.name)
      }
      await mkdir(dirname(path), { recursive: true })
      await writeText(path, composeSkillFile({ name, description, whenToUse: payload?.whenToUse, body: payload?.body }))
      const all = await listAll()
      return { skill: all.find((item) => item.path === path) ?? null, skills: all }
    },

    /** Write a skill file verbatim (the raw editor), after validating its frontmatter. */
    async 'skill.write'(payload) {
      const id = String(payload?.id ?? '')
      const all = await listAll()
      const record = all.find((item) => item.id === id)
      if (record === undefined) fail('not-found', `no installed skill with id "${id}"`)
      requireEditable({ editable: record.editable })
      const text = String(payload?.text ?? '')
      const parsed = parseSkillFile(text)
      if (parsed.error !== undefined) fail('invalid-skill-file', parsed.error)
      if (typeof parsed.fields.name !== 'string' || parsed.fields.name === '') fail('invalid-skill-file', 'frontmatter must declare "name"')
      if (typeof parsed.fields.description !== 'string' || parsed.fields.description === '') {
        fail('invalid-skill-file', 'frontmatter must declare "description"')
      }
      await writeText(record.path, text)
      const next = await listAll()
      return { skills: next, text }
    },

    /** Delete one installed skill. */
    async 'skill.remove'(payload) {
      const id = String(payload?.id ?? '')
      const target = locate(roots(), id)
      if (target === undefined) fail('not-found', `no installed skill with id "${id}"`)
      requireEditable(target.root)
      await removeSkill(target.root, target.kind, target.name)
      return { skills: await listAll() }
    },

    /** Install every skill bundle a GitHub repository carries. */
    async 'skill.pull'(payload) {
      const rootId = payload?.rootId === undefined ? undefined : String(payload.rootId)
      const root = rootId === undefined ? roots()[0] : roots().find((item) => item.id === rootId)
      if (root === undefined) fail('not-found', `no skill root with id "${rootId}"`)
      requireEditable(root)
      const archive = await fetchRepoArchive(payload?.url)
      const directories = findSkillDirectories(archive.entries, archive.subpath)
      if (directories.length === 0) {
        fail(
          'no-skill-found',
          `no SKILL.md was found in ${archive.owner}/${archive.repo}@${archive.branch}${archive.subpath === '' ? '' : `/${archive.subpath}`}`,
        )
      }

      await mkdir(root.path, { recursive: true })
      const installed = []
      const skipped = []
      for (const directory of directories) {
        const skillFile = directory.members.find((member) => member.path === 'SKILL.md')
        const parsed = parseSkillFile(skillFile.data.toString('utf8'))
        const name = installNameFor(directory.dir, parsed.fields)
        const targetDir = join(root.path, name)
        if (!inside(root.path, targetDir)) {
          skipped.push({ name, reason: 'the resolved path escapes the skill root' })
          continue
        }
        let exists = false
        try {
          await stat(targetDir)
          exists = true
        } catch {
          exists = false
        }
        if (exists && payload?.overwrite !== true) {
          skipped.push({ name, reason: 'already installed (enable overwrite to replace it)' })
          continue
        }
        if (exists) await rm(targetDir, { recursive: true, force: true })
        for (const member of directory.members) {
          const destination = join(targetDir, member.path)
          if (!inside(targetDir, destination)) continue
          await mkdir(dirname(destination), { recursive: true })
          await writeText(destination, member.data)
        }
        installed.push({ name, path: join(targetDir, 'SKILL.md'), source: `${archive.owner}/${archive.repo}@${archive.branch}` })
      }
      return { skills: await listAll(), installed, skipped, source: `${archive.owner}/${archive.repo}@${archive.branch}` }
    },
  }
}

async function removeSkill(root, kind, name) {
  if (!SKILL_NAME_PATTERN.test(name)) fail('bad-request', `"${name}" is not a valid skill name`)
  const path = skillPathFor(root, kind, name)
  // The guard is on the entry itself: a flat skill's directory IS the root, so
  // checking the parent would reject every flat file.
  const target = kind === 'flat' ? path : dirname(path)
  if (!inside(root.path, target)) fail('bad-request', 'the resolved path escapes the skill root')
  if (kind === 'flat') await unlink(path)
  else await rm(target, { recursive: true, force: true })
}
