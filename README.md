# dsh-control-center

English | [中文](README.zh.md)

Three visual Settings pages for the DeepSeek Harness: **MCP servers**, **skills**
and **global personas**. One dual-face plugin — a host half that owns the data
and the one model-facing contribution, and a browser half that renders the
pages into the settings shell.

> The Chinese document ([README.zh.md](README.zh.md)) is the fuller one: it adds
> the verification log, troubleshooting, and the one-click script reference.

```
Settings
├── …
├── MCP 管理          MCP server CRUD
├── Skill 管理        author or pull skills, inspect and delete them
└── 全局人设          a library of persona documents, one active
```

## Install

The package is a normal DSH bundle. Any channel works.

**One script (Windows).** Copies the package, backs the patch up once, and
writes the marked mount block — idempotent, `-DryRun` to preview, `-Profile` /
`-DshHome` to target another profile:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\install.ps1
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\uninstall.ps1   # one-key restore
```

**Official CLI**, which also records the bundle in the profile manifest:

```bash
dsh plugin --profile <name> add dsh-control-center
```

**By hand**, for a profile whose `node_modules` is managed manually: copy this
directory to `<profile>/node_modules/dsh-control-center`, then append the mount
row to the profile's own `cordis.patch.yml`:

```yaml
- insert:
    - id: control-center
      name: 'dsh-control-center'
```

`dsh-hmr` watches that file, so the plugin activates on save; the browser half
is part of the client boot graph and needs one page refresh the first time it
appears. After the first installation the script leaves
`cordis.patch.yml.bak-dsh-control-center` as the final rollback point.

## The three pages

### MCP 管理

An MCP server is a Loader row, not a settings value, so the page writes a
delimited **managed block** into the active profile's own patch layer and lets
`dsh-hmr` reload the composition:

```yaml
# >>> dsh-control-center:mcp — managed, edit it from Settings instead
- insert: [{"id":"cc-mcp-github","name":"@deepseek-ai/dsh-mcp-client","config":{…}}]
# <<< dsh-control-center:mcp
```

Everything outside the two markers is preserved byte for byte, and the payload
is JSON — a strict subset of YAML 1.2 — so no URL, argument or environment value
can change the document's shape. The definitions live in
`$DSH_HOME/control-center/mcp-servers.json`; the block is regenerated from them
on every write, so disabling a server removes its row without losing it.

The row reports its live Loader state, so the list distinguishes *configured*,
*enabled* and *connected*.

### Skill 管理

Skills are ordinary files, so this page is a filesystem editor over the roots
`dsh-skill-filesystem` already scans — it keeps no database:

| Root | Source |
|---|---|
| `$DSH_HOME/skills` | `user-dsh`, provider rank 400 — where installs go |
| `$DSH_AGENTS_HOME/skills` | `user-agents`, rank 500 |
| any `customSkillDirs` | from a live `skill-filesystem` row |

Project roots (`.dsh/skills`, `.agents/skills`) depend on the session's working
directory rather than on this global page and are deliberately left out.

* **New skill** writes `<root>/<name>/SKILL.md` with `name`, `description`,
  `whenToUse` and the body.
* **Raw editor** opens the current file verbatim; saving re-validates the
  frontmatter.
* **Pull from GitHub** downloads one source archive, finds every `SKILL.md` at a
  plausible depth, and installs each bundle. Three URL shapes are accepted, plus
  the `git@github.com:owner/repo.git` spelling:

  ```
  https://github.com/owner/repo
  https://github.com/owner/repo/tree/<branch>
  https://github.com/owner/repo/tree/<branch>/<subpath>
  ```

  No `git` binary is needed: the archive is fetched from `codeload` and unpacked
  by a small built-in tar reader. An existing skill is only replaced when
  **overwrite** is on.

The filesystem provider watches its roots, so a created, edited or deleted skill
reaches the next model step without a restart.

### 全局人设

Each persona is a Markdown document under
`$DSH_HOME/control-center/personas/`, with its name and description in
`personas.json`. Exactly one is active, and the page can clear the seat.

The active document is registered as **one** system-prompt section:

```js
ctx.systemPrompt.section({
  name: 'control-center:persona',
  order: 5,
  text: activeDocument,
  interpolate: false,
})
```

Three properties follow, and all are intended:

* **additive** — the harness identity, the deployment persona, tool guidance and
  the environment suffix are untouched; the section lands immediately after the
  deployment persona prefix at order 0;
* **global** — a preset that shadows `deployment:persona-prefix` for one agent
  does not remove it, so every session is covered;
* **literal** — `interpolate: false` keeps `{{…}}` as written, so a stray brace
  in prose can never fail prompt assembly.

Switching the active document disposes and re-registers the section; the next
assembly carries the new text.

## HTTP API

One POST-only route, `/control-center/api`, with a `method` field:

| Method | Purpose |
|---|---|
| `system.info` | paths and version |
| `mcp.state` / `mcp.save` / `mcp.remove` / `mcp.toggle` | MCP servers |
| `skill.state` / `skill.read` / `skill.save` / `skill.write` / `skill.remove` / `skill.pull` | skills |
| `persona.state` / `persona.read` / `persona.save` / `persona.remove` / `persona.activate` | personas |

Responses are `{ ok: true, value }` or `{ ok: false, error: { code, message } }`.
The route is fenced against cross-origin browser callers: an `Origin` header must
name a loopback host, and a present `Content-Type` must be JSON. A caller with no
`Origin` — the Electron IPC bridge, a shell tool — is already running with the
user's own authority.

## Checks

Both scripts need no dependencies and no harness:

```bash
node scripts/selfcheck.mjs     # host half: frontmatter, tar, the managed block, all three stores over real files
node scripts/clientsmoke.mjs   # browser half: bundle, slot registration, every section rendered with stubbed host replies
```

`skill.pull`'s network path is not exercised by either; verify it against a real
repository from the running harness.

## Layout

```
index.js                 host half: route, API table, persona section, MCP reconciliation
client.js                browser half: the three Settings sections
lib/wire.js              body reader, JSON responder, request fence
lib/paths.js             DSH_HOME / profile locations, atomic read-write
lib/mcp.js               MCP store + the managed patch block
lib/skills.js            skill roots, frontmatter, CRUD, GitHub install
lib/github.js            repository reference parsing + archive download
lib/tar.js               minimal tar reader
lib/personas.js          persona store + the prompt section lifecycle
scripts/install.ps1      one-key install (UTF-8 with BOM — see README.zh.md)
scripts/uninstall.ps1    one-key restore
scripts/selfcheck.mjs    host-half checks
scripts/clientsmoke.mjs  browser-half checks
```

## Publishing to the DSH plugin market

`package.json` is already shaped for it (no `private`, `license`, `repository`
with `directory`, `keywords`, `engines.dsh`, `peerDependencies`,
`dsh.manifestVersion`) and `locale/{en,zh}.json` supplies the store card copy.

The catalog is the curated list [awesome-dsh-plugin](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin):
add ONE file under `data/plugins/`, run `node scripts/generate-readme.mjs`, open
a PR. The step-by-step checklist — plus the entry YAML, a pre-flight validator
and the screenshot template — lives in the repository's `publish/` directory.
