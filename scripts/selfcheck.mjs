/**
 * Self-check for dsh-control-center.
 *
 * Runs the host half's pure logic and both file-backed stores against a
 * throwaway `DSH_HOME` and a throwaway profile directory, so the checks are
 * real filesystem round trips rather than mocks. No dependencies, no network:
 *
 *     node scripts/selfcheck.mjs
 *
 * `skill.pull` is the one operation that needs the network and is therefore
 * exercised only for its URL parsing here; the GitHub install path is verified
 * against a real repository from the running harness.
 */
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { gzipSync } from 'node:zlib'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const here = fileURLToPath(new URL('..', import.meta.url))
/** Dynamic import of a local module, spelled the way Node's ESM loader accepts on every platform. */
const load = (relative) => import(pathToFileURL(join(here, relative)).href)

let failures = 0
let checks = 0

function check(label, condition, detail) {
  checks += 1
  if (condition) {
    console.log(`  ok   ${label}`)
  } else {
    failures += 1
    console.log(`  FAIL ${label}${detail === undefined ? '' : ` — ${detail}`}`)
  }
}

function equal(label, actual, expected) {
  check(label, JSON.stringify(actual) === JSON.stringify(expected), `got ${JSON.stringify(actual)}, want ${JSON.stringify(expected)}`)
}

// ── the throwaway world ─────────────────────────────────────────────────────
const sandbox = await mkdtemp(join(tmpdir(), 'dsh-control-center-'))
const home = join(sandbox, 'home')
const profile = join(sandbox, 'profile')
await mkdir(home, { recursive: true })
await mkdir(profile, { recursive: true })
await writeFile(join(profile, 'cordis.patch.yml'), '# user patch\n- id: locale\n  name: "@deepseek-ai/dsh-client-locale"\n  config:\n    preference: zh\n')
process.env.DSH_HOME = home
process.env.DSH_AGENTS_HOME = join(sandbox, 'agents')

const { parseSkillFile, composeSkillFile, findSkillDirectories, createSkillApi } = await load('lib/skills.js')
const { renderBlock, composeDocument, stripBlock, createMcpApi } = await load('lib/mcp.js')
const { createPersonaApi } = await load('lib/personas.js')
const { parseRepoUrl } = await load('lib/github.js')
const { parseTar } = await load('lib/tar.js')

// ── skill frontmatter ───────────────────────────────────────────────────────
console.log('\nskill frontmatter')
{
  const text = ['---', 'name: my-skill', 'description: >-', '  a folded', '  description', 'whenToUse: "when: it helps"', '---', '', '# Body', '', 'Text.'].join('\n')
  const parsed = parseSkillFile(text)
  equal('name', parsed.fields.name, 'my-skill')
  equal('folded description', parsed.fields.description, 'a folded description')
  equal('quoted value', parsed.fields.whenToUse, 'when: it helps')
  check('body preserved', parsed.body.startsWith('# Body'), parsed.body)
  check('no error', parsed.error === undefined, parsed.error)
}
{
  const composed = composeSkillFile({ name: 'demo-skill', description: 'Uses: colons, "quotes" and\nnewlines', whenToUse: 'always', body: 'Do the thing.' })
  const parsed = parseSkillFile(composed)
  equal('round-trip name', parsed.fields.name, 'demo-skill')
  equal('round-trip description', parsed.fields.description, 'Uses: colons, "quotes" and\nnewlines')
  equal('round-trip whenToUse', parsed.fields.whenToUse, 'always')
  check('round-trip body', parsed.body.trim() === 'Do the thing.', parsed.body)
}
check('unclosed frontmatter reports an error', parseSkillFile('---\nname: x\n').error !== undefined)

// ── tar ─────────────────────────────────────────────────────────────────────
console.log('\ntar reader')
function writeTar(entries) {
  const chunks = []
  for (const entry of entries) {
    const header = Buffer.alloc(512)
    header.write(entry.name, 0, 100, 'utf8')
    header.write('0000644\0', 100, 8, 'utf8')
    header.write('0000000\0', 108, 8, 'utf8')
    header.write('0000000\0', 116, 8, 'utf8')
    header.write(`${entry.data.length.toString(8).padStart(11, '0')}\0`, 124, 12, 'utf8')
    header.write('00000000000\0', 136, 12, 'utf8')
    header.write('        ', 148, 8, 'utf8')
    header.write(entry.type ?? '0', 156, 1, 'utf8')
    header.write('ustar\0', 257, 6, 'utf8')
    header.write('00', 263, 2, 'utf8')
    chunks.push(header, entry.data, Buffer.alloc((512 - (entry.data.length % 512)) % 512))
  }
  chunks.push(Buffer.alloc(1024))
  return Buffer.concat(chunks)
}
{
  const archive = writeTar([
    { name: 'repo-main/', type: '5', data: Buffer.alloc(0) },
    { name: 'repo-main/README.md', data: Buffer.from('hello') },
    { name: 'repo-main/skills/demo/SKILL.md', data: Buffer.from('---\nname: demo\n---\n') },
  ])
  const gz = gzipSync(archive)
  const { gunzipSync } = await import('node:zlib')
  const parsed = parseTar(gunzipSync(gz))
  equal('entry count', parsed.length, 3)
  equal('first entry', parsed[1].name, 'repo-main/README.md')
  equal('file body', parsed[1].data.toString('utf8'), 'hello')
  equal('dir type', parsed[0].type, 'dir')
}

// ── archive skill discovery ─────────────────────────────────────────────────
console.log('\narchive skill discovery')
{
  const entries = [
    { name: 'SKILL.md', type: 'file', data: Buffer.from('') },
    { name: 'reference.md', type: 'file', data: Buffer.from('') },
    { name: 'skills/other/SKILL.md', type: 'file', data: Buffer.from('') },
    { name: 'skills/other/notes.txt', type: 'file', data: Buffer.from('') },
    { name: 'a/b/c/d/e/f/SKILL.md', type: 'file', data: Buffer.from('') },
  ]
  const found = findSkillDirectories(entries, '')
  equal('two skills at a plausible depth', found.map((item) => item.dir), ['', 'skills/other'])
  equal('members of the nested skill', found[1].members.map((item) => item.path), ['SKILL.md', 'notes.txt'])
  equal('subpath narrows the search', findSkillDirectories(entries, 'skills').map((item) => item.dir), ['skills/other'])
  equal('a deep-only archive finds nothing', findSkillDirectories([{ name: 'x/a/b/c/d/e/f/SKILL.md', type: 'file', data: Buffer.alloc(0) }], '').length, 0)
}

// ── GitHub URL parsing ──────────────────────────────────────────────────────
console.log('\nGitHub URL parsing')
equal('plain repo', parseRepoUrl('https://github.com/obra/superpowers'), { owner: 'obra', repo: 'superpowers', branch: undefined, subpath: '' })
equal('tree branch', parseRepoUrl('https://github.com/obra/superpowers/tree/dev'), { owner: 'obra', repo: 'superpowers', branch: 'dev', subpath: '' })
equal('tree branch subpath', parseRepoUrl('https://github.com/obra/superpowers/tree/dev/skills'), { owner: 'obra', repo: 'superpowers', branch: 'dev', subpath: 'skills' })
equal('ssh form', parseRepoUrl('git@github.com:obra/superpowers.git'), { owner: 'obra', repo: 'superpowers', branch: undefined, subpath: '' })
equal('bare owner/repo', parseRepoUrl('obra/superpowers'), { owner: 'obra', repo: 'superpowers', branch: undefined, subpath: '' })

// ── the MCP managed block ───────────────────────────────────────────────────
console.log('\nMCP managed block')
{
  const servers = [
    { id: 'cc-mcp-github', name: '@deepseek-ai/dsh-mcp-client', enabled: true, config: { serverName: 'github', transport: 'stdio', command: 'npx', args: ['-y', '@modelcontextprotocol/server-github'] } },
    { id: 'cc-mcp-web', name: '@deepseek-ai/dsh-mcp-client', enabled: false, config: { serverName: 'web', transport: 'streamable-http', url: 'http://localhost:3000/mcp' } },
  ]
  const block = renderBlock(servers)
  check('block has both markers', block.includes('>>> dsh-control-center:mcp') && block.includes('<<< dsh-control-center:mcp'))
  const payload = JSON.parse(block.split('\n')[1].slice('- insert: '.length))
  equal('disabled servers are not inserted', payload.length, 1)
  equal('row id', payload[0].id, 'cc-mcp-github')
  equal('row name', payload[0].name, '@deepseek-ai/dsh-mcp-client')
  equal('row config', payload[0].config.serverName, 'github')
  check('a value with a colon cannot break the document', JSON.parse(renderBlock([
    { id: 'cc-mcp-x', name: '@deepseek-ai/dsh-mcp-client', enabled: true, config: { serverName: 'x', transport: 'streamable-http', url: 'http://h/mcp', headers: { Authorization: 'Bearer a: b # c' } } },
  ]).split('\n')[1].slice('- insert: '.length))[0].config.headers.Authorization === 'Bearer a: b # c')
  check('no enabled servers renders no block', renderBlock([servers[1]]) === undefined)

  const document = '# user patch\n- id: locale\n  config:\n    preference: zh\n'
  const once = composeDocument(document, block)
  check('unrelated content survives', once.startsWith('# user patch\n- id: locale\n  config:\n    preference: zh'))
  check('unrelated content survives exactly once', once.indexOf('preference: zh') === once.lastIndexOf('preference: zh'))
  const twice = composeDocument(once, block)
  equal('a second write is stable', twice, once)
  const cleaned = stripBlock(once)
  equal('removing the block restores the document', cleaned.trim(), document.trim())
  equal('an empty patch array is handled', composeDocument('[]\n', block), block)
  equal('emptying the block restores an empty document', composeDocument('[]\n', undefined), '[]\n')
}

// ── the MCP API over real files ─────────────────────────────────────────────
console.log('\nMCP API')
{
  const ctx = fakeContext(profile)
  const api = createMcpApi(ctx)
  let state = await api['mcp.state']()
  equal('starts empty', state.servers.length, 0)
  await api['mcp.save']({ server: { serverName: 'github', transport: 'stdio', command: 'npx', args: 'a\nb', env: 'TOKEN=1' } })
  state = await api['mcp.state']()
  equal('one server after save', state.servers.length, 1)
  equal('args parsed from lines', state.servers[0].config.args, ['a', 'b'])
  equal('env parsed from lines', state.servers[0].config.env, { TOKEN: '1' })
  const patch = await readFile(join(profile, 'cordis.patch.yml'), 'utf8')
  check('the profile patch gained the managed block', patch.includes('dsh-control-center:mcp'))
  check('the profile patch kept its user rows', patch.includes('preference: zh'))
  await api['mcp.toggle']({ id: state.servers[0].id, enabled: false })
  check('a disabled server leaves the block', !(await readFile(join(profile, 'cordis.patch.yml'), 'utf8')).includes('dsh-mcp-client'))
  await api['mcp.toggle']({ id: state.servers[0].id, enabled: true })
  check('re-enabling restores it', (await readFile(join(profile, 'cordis.patch.yml'), 'utf8')).includes('dsh-mcp-client'))
  let rejected = null
  try {
    await api['mcp.save']({ server: { serverName: 'bad name', transport: 'stdio', command: 'x' } })
  } catch (error) {
    rejected = error.code
  }
  equal('an invalid server name is refused', rejected, 'invalid-server-name')
  try {
    await api['mcp.save']({ server: { serverName: 'github', transport: 'stdio', command: 'x' } })
    rejected = null
  } catch (error) {
    rejected = error.code
  }
  equal('a duplicate name is refused', rejected, 'duplicate-server-name')

  // Reconciliation is what makes the store authoritative: the uninstall script
  // cleans the managed block, so a reinstall must put the rows back.
  const stored = JSON.parse(await readFile(join(home, 'control-center', 'mcp-servers.json'), 'utf8'))
  equal('one definition is stored', stored.servers.length, 1)
  await writeFile(join(profile, 'cordis.patch.yml'), stripBlock(await readFile(join(profile, 'cordis.patch.yml'), 'utf8')))
  check('the block was cleaned by hand', !(await readFile(join(profile, 'cordis.patch.yml'), 'utf8')).includes('dsh-mcp-client'))
  equal('reconcile re-mounts the stored row', await api.reconcile(), 1)
  check('the row is back', (await readFile(join(profile, 'cordis.patch.yml'), 'utf8')).includes('cc-mcp-github'))
  equal('reconcile is idempotent', await api.reconcile(), 1)
  const settled = await readFile(join(profile, 'cordis.patch.yml'), 'utf8')
  await api.reconcile()
  equal('a second reconcile rewrites nothing', await readFile(join(profile, 'cordis.patch.yml'), 'utf8'), settled)

  await api['mcp.remove']({ id: state.servers[0].id })
  state = await api['mcp.state']()
  equal('removal empties the list', state.servers.length, 0)
  const final = await readFile(join(profile, 'cordis.patch.yml'), 'utf8')
  check('removal cleaned the block', !final.includes('dsh-control-center:mcp'))
  check('removal kept the user rows', final.includes('preference: zh'))
}

// ── the skill API over real files ───────────────────────────────────────────
console.log('\nSkill API')
{
  const ctx = fakeContext(profile)
  const api = createSkillApi(ctx)
  let state = await api['skill.state']()
  equal('starts empty', state.skills.length, 0)
  await api['skill.save']({ name: 'demo-skill', description: 'A demo', whenToUse: 'testing', body: '# Demo\n\nDo it.' })
  state = await api['skill.state']()
  equal('one skill after save', state.skills.length, 1)
  equal('installed under the user root', state.skills[0].rootId, 'user-dsh')
  equal('discovered name', state.skills[0].name, 'demo-skill')
  equal('bundles are directories', state.skills[0].kind, 'bundle')
  check('the file exists at <root>/<name>/SKILL.md', state.skills[0].path.endsWith(join('skills', 'demo-skill', 'SKILL.md')))
  const read = await api['skill.read']({ id: state.skills[0].id })
  check('read returns the file', read.text.includes('Do it.'))
  let rejected = null
  try {
    await api['skill.save']({ name: 'Not Kebab', description: 'x' })
  } catch (error) {
    rejected = error.code
  }
  equal('a non-kebab name is refused', rejected, 'invalid-skill-name')
  rejected = null
  try {
    await api['skill.write']({ id: state.skills[0].id, text: 'no frontmatter' })
  } catch (error) {
    rejected = error.code
  }
  equal('a file without frontmatter is refused', rejected, 'invalid-skill-file')
  await api['skill.write']({ id: state.skills[0].id, text: read.text.replace('Do it.', 'Do it well.') })
  const reread = await api['skill.read']({ id: state.skills[0].id })
  check('the raw editor writes through', reread.text.includes('Do it well.'))
  // A flat `<name>.md` file is the provider's second shape.
  await writeFile(join(home, 'skills', 'flat-skill.md'), '---\nname: flat-skill\ndescription: Flat\n---\nBody\n')
  state = await api['skill.state']()
  equal('a flat file is discovered too', state.skills.length, 2)
  const flat = state.skills.find((item) => item.name === 'flat-skill')
  equal('flat kind', flat.kind, 'flat')
  await api['skill.remove']({ id: flat.id })
  state = await api['skill.state']()
  equal('a flat file is removed', state.skills.length, 1)
  await api['skill.remove']({ id: state.skills[0].id })
  state = await api['skill.state']()
  equal('a bundle is removed', state.skills.length, 0)
}

// ── the persona API + the prompt section ────────────────────────────────────
console.log('\nPersona API')
{
  const mounted = []
  const ctx = fakeContext(profile, {
    systemPrompt: {
      section(section) {
        mounted.push(section)
        return () => {
          const index = mounted.indexOf(section)
          if (index >= 0) mounted.splice(index, 1)
        }
      },
    },
  })
  const api = createPersonaApi(ctx)
  await api.install()
  equal('nothing mounted without a persona', mounted.length, 0)
  let view = await api['persona.save']({ name: 'Terse engineer', description: 'short answers', body: 'Answer in short commands.' })
  equal('the first persona activates itself', view.activeId, view.personas[0].id)
  equal('one section mounted', mounted.length, 1)
  equal('section name', mounted[0].name, 'control-center:persona')
  equal('section text is the document', mounted[0].text, 'Answer in short commands.\n')
  check('the section is literal', mounted[0].interpolate === false)
  view = await api['persona.save']({ id: view.personas[0].id, name: 'Terse engineer', description: 'short answers', body: 'Now with {{braces}}.' })
  equal('a rewrite replaces the section, not adds one', mounted.length, 1)
  equal('rewritten text', mounted[0].text, 'Now with {{braces}}.\n')
  const second = await api['persona.save']({ name: 'Reviewer', body: 'Review.' })
  equal('a second persona does not steal the seat', second.activeId, view.personas[0].id)
  await api['persona.activate']({ id: second.id })
  equal('activation swaps the text', mounted[0].text, 'Review.\n')
  view = await api['persona.activate']({ id: null })
  equal('clearing deactivates', view.activeId, null)
  equal('clearing unmounts the section', mounted.length, 0)
  await api['persona.remove']({ id: second.id })
  view = await api['persona.state']()
  equal('removal shrinks the library', view.personas.length, 1)
  api.dispose()
}

// ── done ────────────────────────────────────────────────────────────────────
await rm(sandbox, { recursive: true, force: true })
console.log(`\n${checks - failures}/${checks} checks passed`)
process.exit(failures === 0 ? 0 : 1)

/** The smallest host context the host half touches. */
function fakeContext(profileDir, extra = {}) {
  return {
    profileContext: { dir: profileDir, patchPath: join(profileDir, 'cordis.patch.yml'), name: 'selfcheck' },
    loader: { entries: () => [], await: async () => {} },
    logger: { warn: () => {}, info: () => {} },
    get(name) {
      if (name === 'profileContext') return this.profileContext
      if (name === 'systemPrompt') return extra.systemPrompt
      return undefined
    },
    ...extra,
  }
}
