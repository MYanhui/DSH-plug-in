/**
 * dsh-control-center — browser half.
 *
 * Registers three Settings sections (MCP servers, skills, global personas) into
 * the shell's `settings.section` ledger and talks to the host half over
 * `/control-center/api`.
 *
 * Two authoring rules from the harness plugin guide shape this file:
 *
 *  - No harness Client package is imported. A plain-JS bundle is not type
 *    checked, and a throwing component blanks its slot entry, so every control
 *    here is written locally and styled only with `--dsw-alias-*` theme tokens,
 *    which degrade gracefully if a token is ever renamed.
 *  - Each section registers through `ctx.slots.inject('settings.section', …)`,
 *    so the sections disappear and reappear with the shell's own declaration
 *    and are disposed with this plugin.
 */
window.__ModuleLoader__.load({
  id: 'dsh-control-center',
  factory: (require) => {
    const React = require('react')
    const { useCallback, useEffect, useMemo, useRef, useState } = React
    const h = React.createElement

    // ── locale ──────────────────────────────────────────────────────────────
    // The locale plugin publishes the active language on <html lang>; a page
    // has no other need for a locale service, so this reads it directly.
    const LANG = (() => {
      try {
        const tag = document.documentElement.lang || navigator.language || 'en'
        return String(tag).toLowerCase().startsWith('zh') ? 'zh' : 'en'
      } catch {
        return 'en'
      }
    })()
    const t = (zh, en) => (LANG === 'zh' ? zh : en)

    // ── styles ──────────────────────────────────────────────────────────────
    const CSS = `
.dcc-root { display: flex; flex-direction: column; gap: 14px; padding: 2px 0 28px; color: var(--dsw-alias-label-primary); font-size: 13px; line-height: 1.55; }
.dcc-head { display: flex; flex-direction: column; gap: 4px; }
.dcc-title { font-size: 15px; font-weight: 600; }
.dcc-intro { color: var(--dsw-alias-label-tertiary); font-size: 12px; }
.dcc-card { border: 1px solid var(--dsw-alias-border-l2); border-radius: 16px; background: var(--dsw-alias-bg-layer-3); padding: 14px 16px; display: flex; flex-direction: column; gap: 12px; }
.dcc-cardhead { display: flex; align-items: center; justify-content: space-between; gap: 10px; flex-wrap: wrap; }
.dcc-h3 { font-size: 13px; font-weight: 600; display: flex; align-items: center; gap: 8px; }
.dcc-note { color: var(--dsw-alias-label-tertiary); font-size: 12px; }
.dcc-mono { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 11.5px; }
.dcc-badge { font-size: 11px; padding: 1px 8px; border-radius: 999px; background: var(--dsw-alias-bg-layer-2); color: var(--dsw-alias-label-secondary); white-space: nowrap; }
.dcc-badge-on { background: var(--dsw-alias-state-success-tertiary); color: var(--dsw-alias-state-success-primary); }
.dcc-badge-warn { background: var(--dsw-alias-state-warn-tertiary); color: var(--dsw-alias-state-warn-primary); }
.dcc-badge-err { background: var(--dsw-alias-state-error-secondary); color: var(--dsw-alias-state-error-primary); }
.dcc-list { display: flex; flex-direction: column; gap: 8px; }
.dcc-row { border: 1px solid var(--dsw-alias-border-l2); border-radius: 12px; background: var(--dsw-alias-bg-layer-2); padding: 10px 12px; display: flex; flex-direction: column; gap: 6px; }
.dcc-rowmain { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.dcc-rowtitle { font-weight: 600; }
.dcc-rowactions { display: flex; gap: 6px; margin-left: auto; flex-wrap: wrap; }
.dcc-btn { font: inherit; font-size: 12px; padding: 5px 12px; border-radius: 8px; border: 1px solid var(--dsw-alias-border-l2); background: var(--dsw-alias-bg-layer-2); color: var(--dsw-alias-label-primary); cursor: pointer; }
.dcc-btn:hover { background: var(--dsw-alias-interactive-bg-hover); }
.dcc-btn:disabled { opacity: 0.5; cursor: default; }
.dcc-btn-primary { background: var(--dsw-alias-button-primary-fill); border-color: var(--dsw-alias-button-primary-fill); color: #fff; }
.dcc-btn-primary:hover { background: var(--dsw-alias-button-primary-hover); }
.dcc-btn-danger { color: var(--dsw-alias-state-error-primary); }
.dcc-btn-sm { padding: 3px 9px; font-size: 11.5px; }
.dcc-form { display: grid; grid-template-columns: 132px minmax(0, 1fr); gap: 10px 12px; align-items: start; }
.dcc-label { color: var(--dsw-alias-label-secondary); padding-top: 6px; font-size: 12px; }
.dcc-input, .dcc-select, .dcc-textarea { width: 100%; box-sizing: border-box; font: inherit; font-size: 12.5px; padding: 6px 10px; border-radius: 8px; border: 1px solid var(--dsw-alias-border-l2); background: var(--dsw-alias-bg-layer-1); color: var(--dsw-alias-label-primary); outline: none; }
.dcc-input:focus, .dcc-select:focus, .dcc-textarea:focus { border-color: var(--dsw-alias-brand-primary); }
.dcc-textarea { min-height: 84px; resize: vertical; line-height: 1.5; }
.dcc-editor { min-height: 320px; font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 12px; }
.dcc-switch { display: inline-flex; align-items: center; gap: 8px; font-size: 12px; color: var(--dsw-alias-label-secondary); cursor: pointer; }
.dcc-switch input { appearance: none; width: 34px; height: 19px; border-radius: 999px; background: var(--dsw-alias-border-l3); position: relative; cursor: pointer; outline: none; transition: background 120ms ease; margin: 0; }
.dcc-switch input::after { content: ''; position: absolute; top: 2px; left: 2px; width: 15px; height: 15px; border-radius: 50%; background: var(--dsw-alias-switch-thumb); transition: transform 120ms ease; }
.dcc-switch input:checked { background: var(--dsw-alias-brand-primary); }
.dcc-switch input:checked::after { transform: translateX(15px); }
.dcc-actions { display: flex; gap: 8px; flex-wrap: wrap; }
.dcc-msg { border-radius: 10px; padding: 8px 12px; font-size: 12px; }
.dcc-msg-ok { background: var(--dsw-alias-state-success-tertiary); color: var(--dsw-alias-state-success-primary); }
.dcc-msg-err { background: var(--dsw-alias-state-error-secondary); color: var(--dsw-alias-state-error-primary); }
.dcc-empty { color: var(--dsw-alias-label-tertiary); font-size: 12px; padding: 8px 2px; }
.dcc-preview { border: 1px solid var(--dsw-alias-border-l2); border-radius: 12px; background: var(--dsw-alias-bg-layer-1); padding: 12px 14px; max-height: 420px; overflow: auto; }
.dcc-preview h1 { font-size: 16px; margin: 8px 0 6px; }
.dcc-preview h2 { font-size: 14px; margin: 8px 0 6px; }
.dcc-preview h3 { font-size: 13px; margin: 8px 0 6px; }
.dcc-preview p { margin: 6px 0; }
.dcc-preview ul { margin: 6px 0; padding-left: 20px; }
.dcc-preview code { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 12px; background: var(--dsw-alias-markdown-inline-code); border-radius: 4px; padding: 1px 4px; }
.dcc-preview pre { background: var(--dsw-alias-markdown-code-block); border-radius: 8px; padding: 10px; overflow: auto; }
.dcc-preview pre code { background: transparent; padding: 0; }
.dcc-two { display: flex; gap: 14px; flex-wrap: wrap; }
.dcc-two > * { flex: 1 1 300px; min-width: 0; }
`

    // ── api ─────────────────────────────────────────────────────────────────
    class ApiError extends Error {
      constructor(code, message) {
        super(message)
        this.code = code
      }
    }

    async function call(method, payload) {
      let response
      try {
        response = await fetch('/control-center/api', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ method, ...(payload ?? {}) }),
        })
      } catch (error) {
        throw new ApiError('network', t('无法连接宿主进程：', 'could not reach the host: ') + String(error))
      }
      if (!response.ok) throw new ApiError('http', `${method} answered HTTP ${response.status}`)
      const envelope = await response.json()
      if (envelope?.ok !== true) {
        throw new ApiError(envelope?.error?.code ?? 'error', envelope?.error?.message ?? 'unknown failure')
      }
      return envelope.value
    }

    // ── primitives ──────────────────────────────────────────────────────────
    function Card(props) {
      return h('div', { className: 'dcc-card' }, props.children)
    }

    function CardHead(props) {
      return h(
        'div',
        { className: 'dcc-cardhead' },
        h('div', { className: 'dcc-h3' }, props.title, props.badge),
        props.actions,
      )
    }

    function Field(props) {
      return h(
        'label',
        { className: 'dcc-label', htmlFor: props.id },
        props.label,
      )
    }

    function Input(props) {
      return h('input', {
        className: 'dcc-input',
        value: props.value,
        placeholder: props.placeholder,
        spellCheck: false,
        disabled: props.disabled === true,
        onChange: (event) => props.onChange(event.target.value),
      })
    }

    function Textarea(props) {
      return h('textarea', {
        className: `dcc-textarea${props.editor === true ? ' dcc-editor' : ''}`,
        value: props.value,
        placeholder: props.placeholder,
        spellCheck: false,
        disabled: props.disabled === true,
        rows: props.rows,
        onChange: (event) => props.onChange(event.target.value),
      })
    }

    function Switch(props) {
      return h(
        'label',
        { className: 'dcc-switch' },
        h('input', {
          type: 'checkbox',
          checked: props.checked === true,
          disabled: props.disabled === true,
          onChange: (event) => props.onChange(event.target.checked),
        }),
        props.label,
      )
    }

    function Button(props) {
      return h(
        'button',
        {
          type: 'button',
          className: `dcc-btn${props.variant === undefined ? '' : ` dcc-btn-${props.variant}`}${props.small === true ? ' dcc-btn-sm' : ''}`,
          disabled: props.disabled === true,
          onClick: props.onClick,
        },
        props.children,
      )
    }

    function Message(props) {
      if (props.message === null || props.message === undefined) return null
      return h('div', { className: `dcc-msg ${props.kind === 'error' ? 'dcc-msg-err' : 'dcc-msg-ok'}` }, props.message)
    }

    function Empty(props) {
      return h('div', { className: 'dcc-empty' }, props.children)
    }

    /** The load/error/notice state every section shares. */
    function useSection(initialMethod) {
      const [data, setData] = useState(null)
      const [error, setError] = useState(null)
      const [notice, setNotice] = useState(null)
      const [busy, setBusy] = useState(false)
      const alive = useRef(true)
      useEffect(() => {
        alive.current = true
        return () => {
          alive.current = false
        }
      }, [])

      const reload = useCallback(async () => {
        try {
          const value = await call(initialMethod)
          if (alive.current) {
            setData(value)
            setError(null)
          }
          return value
        } catch (failure) {
          if (alive.current) setError(failure.message ?? String(failure))
          return null
        }
      }, [initialMethod])

      useEffect(() => {
        void reload()
      }, [reload])

      /** Run one mutation, folding its returned state into the section. */
      const run = useCallback(
        async (method, payload, onDone) => {
          setBusy(true)
          setNotice(null)
          setError(null)
          try {
            const value = await call(method, payload)
            if (onDone !== undefined) onDone(value)
            return value
          } catch (failure) {
            if (alive.current) setError(failure.message ?? String(failure))
            return null
          } finally {
            if (alive.current) setBusy(false)
          }
        },
        [],
      )

      return { data, setData, error, setError, notice, setNotice, busy, run, reload }
    }

    // ── markdown preview ────────────────────────────────────────────────────
    /** A deliberately small markdown renderer: headings, lists, fences, inline code and bold. */
    function inline(text, keyPrefix) {
      const nodes = []
      const pattern = /(`[^`]+`|\*\*[^*]+\*\*)/g
      let last = 0
      let match
      let index = 0
      while ((match = pattern.exec(text)) !== null) {
        if (match.index > last) nodes.push(text.slice(last, match.index))
        const token = match[0]
        if (token.startsWith('`')) nodes.push(h('code', { key: `${keyPrefix}-c${index}` }, token.slice(1, -1)))
        else nodes.push(h('strong', { key: `${keyPrefix}-b${index}` }, token.slice(2, -2)))
        last = match.index + token.length
        index += 1
      }
      if (last < text.length) nodes.push(text.slice(last))
      return nodes
    }

    function Markdown(props) {
      const blocks = useMemo(() => {
        const lines = String(props.text ?? '').replace(/\r\n/g, '\n').split('\n')
        const out = []
        let list = null
        let fence = null
        let buffer = []
        const flush = () => {
          if (buffer.length > 0) {
            out.push({ kind: 'p', text: buffer.join(' ') })
            buffer = []
          }
        }
        for (const line of lines) {
          if (fence !== null) {
            if (line.startsWith('```')) {
              out.push({ kind: 'pre', text: fence.join('\n') })
              fence = null
            } else fence.push(line)
            continue
          }
          if (line.startsWith('```')) {
            flush()
            if (list !== null) {
              out.push(list)
              list = null
            }
            fence = []
            continue
          }
          const heading = /^(#{1,6})\s+(.*)$/.exec(line)
          if (heading !== null) {
            flush()
            if (list !== null) {
              out.push(list)
              list = null
            }
            out.push({ kind: 'h', level: heading[1].length, text: heading[2] })
            continue
          }
          const item = /^\s*[-*+]\s+(.*)$/.exec(line)
          if (item !== null) {
            flush()
            if (list === null) list = { kind: 'ul', items: [] }
            list.items.push(item[1])
            continue
          }
          if (line.trim() === '') {
            flush()
            if (list !== null) {
              out.push(list)
              list = null
            }
            continue
          }
          buffer.push(line)
        }
        if (fence !== null) out.push({ kind: 'pre', text: fence.join('\n') })
        if (list !== null) out.push(list)
        flush()
        return out
      }, [props.text])

      return h(
        'div',
        { className: 'dcc-preview' },
        blocks.length === 0
          ? h(Empty, null, t('（空）', '(empty)'))
          : blocks.map((block, index) => {
              if (block.kind === 'h') return h(`h${Math.min(block.level, 3)}`, { key: index }, inline(block.text, `h${index}`))
              if (block.kind === 'pre') return h('pre', { key: index }, h('code', null, block.text))
              if (block.kind === 'ul') {
                return h('ul', { key: index }, block.items.map((item, itemIndex) => h('li', { key: itemIndex }, inline(item, `l${index}-${itemIndex}`))))
              }
              return h('p', { key: index }, inline(block.text, `p${index}`))
            }),
      )
    }

    // ── MCP servers ─────────────────────────────────────────────────────────
    function emptyServer() {
      return {
        id: '',
        serverName: '',
        transport: 'stdio',
        command: '',
        args: '',
        env: '',
        cwd: '',
        url: '',
        headers: '',
        toolCallTimeoutMs: '',
        maxInstructionBytes: '',
        failOnStartupError: false,
        reconnectEnabled: true,
        reconnectInitialDelayMs: '',
        reconnectMaxDelayMs: '',
        reconnectMaxAttempts: '',
        enabled: true,
      }
    }

    function serverToDraft(server) {
      const config = server.config ?? {}
      const reconnect = config.reconnect ?? {}
      return {
        id: server.id,
        serverName: config.serverName ?? server.serverName ?? '',
        transport: config.transport === 'streamable-http' ? 'streamable-http' : 'stdio',
        command: config.command ?? '',
        args: Array.isArray(config.args) ? config.args.join('\n') : '',
        env: config.env === undefined ? '' : Object.entries(config.env).map(([key, value]) => `${key}=${value}`).join('\n'),
        cwd: config.cwd ?? '',
        url: config.url ?? '',
        headers:
          config.headers === undefined ? '' : Object.entries(config.headers).map(([key, value]) => `${key}: ${value}`).join('\n'),
        toolCallTimeoutMs: config.toolCallTimeoutMs === undefined ? '' : String(config.toolCallTimeoutMs),
        maxInstructionBytes: config.maxInstructionBytes === undefined ? '' : String(config.maxInstructionBytes),
        failOnStartupError: config.failOnStartupError === true,
        reconnectEnabled: reconnect.enabled !== false,
        reconnectInitialDelayMs: reconnect.initialDelayMs === undefined ? '' : String(reconnect.initialDelayMs),
        reconnectMaxDelayMs: reconnect.maxDelayMs === undefined ? '' : String(reconnect.maxDelayMs),
        reconnectMaxAttempts: reconnect.maxAttempts === undefined ? '' : String(reconnect.maxAttempts),
        enabled: server.enabled !== false,
      }
    }

    function draftToServer(draft) {
      return {
        serverName: draft.serverName,
        transport: draft.transport,
        command: draft.command,
        args: draft.args,
        env: draft.env,
        cwd: draft.cwd,
        url: draft.url,
        headers: draft.headers,
        toolCallTimeoutMs: draft.toolCallTimeoutMs,
        maxInstructionBytes: draft.maxInstructionBytes,
        failOnStartupError: draft.failOnStartupError,
        reconnect: {
          enabled: draft.reconnectEnabled,
          initialDelayMs: draft.reconnectInitialDelayMs,
          maxDelayMs: draft.reconnectMaxDelayMs,
          maxAttempts: draft.reconnectMaxAttempts,
        },
        enabled: draft.enabled,
      }
    }

    function McpSection() {
      const section = useSection('mcp.state')
      const [draft, setDraft] = useState(null)
      const patch = (changes) => setDraft((current) => ({ ...current, ...changes }))

      const save = async () => {
        const value = await section.run('mcp.save', { id: draft.id, server: draftToServer(draft) }, (next) => section.setData(next))
        if (value !== null) {
          setDraft(null)
          section.setNotice(t('已保存，配置正在热重载并连接服务。', 'Saved; the profile is reloading and the server is connecting.'))
        }
      }

      return h(
        'div',
        { className: 'dcc-root' },
        h('style', null, CSS),
        h(
          'div',
          { className: 'dcc-head' },
          h('div', { className: 'dcc-title' }, t('MCP 管理', 'MCP servers')),
          h(
            'div',
            { className: 'dcc-intro' },
            t(
              '手动增删改查 MCP 服务。改动写入当前 profile 的 cordis.patch.yml 托管块，热重载即时生效。',
              'Add, edit, inspect and remove MCP servers. Changes are written to a managed block in the active profile patch and hot-reload.',
            ),
          ),
        ),
        h(Message, { kind: 'ok', message: section.notice }),
        h(Message, { kind: 'error', message: section.error }),
        section.data !== null && section.data.available !== true
          ? h(Empty, null, t('当前 Harness 没有 profile，无法管理 MCP 服务。', 'This harness runs without a profile, so MCP servers cannot be managed.'))
          : null,

        h(
          Card,
          null,
          h(CardHead, {
            title: t('已配置的服务', 'Configured servers'),
            badge: h('span', { className: 'dcc-badge' }, String(section.data?.servers?.length ?? 0)),
            actions: h(
              Button,
              { variant: 'primary', onClick: () => setDraft(emptyServer()), disabled: section.busy === true },
              t('新增服务', 'Add server'),
            ),
          }),
          section.data === null
            ? h(Empty, null, t('加载中…', 'Loading…'))
            : section.data.servers.length === 0
              ? h(Empty, null, t('还没有配置任何 MCP 服务。', 'No MCP server is configured yet.'))
              : h(
                  'div',
                  { className: 'dcc-list' },
                  section.data.servers.map((server) =>
                    h(
                      'div',
                      { className: 'dcc-row', key: server.id },
                      h(
                        'div',
                        { className: 'dcc-rowmain' },
                        h('span', { className: 'dcc-rowtitle' }, server.serverName),
                        h('span', { className: 'dcc-badge' }, server.transport),
                        h(
                          'span',
                          { className: `dcc-badge ${server.enabled ? 'dcc-badge-on' : ''}` },
                          server.enabled ? t('已启用', 'enabled') : t('已停用', 'disabled'),
                        ),
                        h(
                          'span',
                          { className: `dcc-badge ${server.live?.active === true ? 'dcc-badge-on' : ''}` },
                          server.live?.active === true ? t('已连接', 'connected') : t('未运行', 'not running'),
                        ),
                        h(
                          'div',
                          { className: 'dcc-rowactions' },
                          h(
                            Switch,
                            {
                              checked: server.enabled,
                              disabled: section.busy === true,
                              label: '',
                              onChange: (checked) =>
                                void section.run('mcp.toggle', { id: server.id, enabled: checked }, (next) => section.setData(next)),
                            },
                          ),
                          h(Button, { small: true, onClick: () => setDraft(serverToDraft(server)) }, t('编辑', 'Edit')),
                          h(
                            Button,
                            {
                              small: true,
                              variant: 'danger',
                              disabled: section.busy === true,
                              onClick: () => {
                                if (typeof confirm === 'function' && !confirm(t(`删除 MCP 服务「${server.serverName}」？`, `Remove MCP server "${server.serverName}"?`))) return
                                void section.run('mcp.remove', { id: server.id }, (next) => {
                                  section.setData(next)
                                  section.setNotice(t('已删除。', 'Removed.'))
                                })
                              },
                            },
                            t('删除', 'Delete'),
                          ),
                        ),
                      ),
                      h(
                        'div',
                        { className: 'dcc-note dcc-mono' },
                        server.transport === 'stdio'
                          ? `stdio · ${server.config.command ?? ''} ${(server.config.args ?? []).join(' ')}`.trim()
                          : `http · ${server.config.url ?? ''}`,
                      ),
                    ),
                  ),
                ),
          section.data !== null && section.data.patchPath !== null
            ? h('div', { className: 'dcc-note dcc-mono' }, section.data.patchPath)
            : null,
        ),

        draft === null ? null : h(McpEditor, { draft, patch, onCancel: () => setDraft(null), onSave: save, busy: section.busy }),
      )
    }

    function McpEditor(props) {
      const { draft, patch } = props
      const stdio = draft.transport === 'stdio'
      const row = (label, control) => [h(Field, { key: `${label}-l`, label }), h('div', { key: `${label}-c` }, control)]

      return h(
        Card,
        null,
        h(CardHead, {
          title: draft.id === '' ? t('新增 MCP 服务', 'New MCP server') : t('编辑 MCP 服务', 'Edit MCP server'),
        }),
        h(
          'div',
          { className: 'dcc-form' },
          ...row(t('服务名', 'Server name'), h(Input, { value: draft.serverName, placeholder: 'github', onChange: (value) => patch({ serverName: value }) })),
          ...row(t('传输方式', 'Transport'), h(
            'select',
            {
              className: 'dcc-select',
              value: draft.transport,
              onChange: (event) => patch({ transport: event.target.value }),
            },
            h('option', { value: 'stdio' }, 'stdio'),
            h('option', { value: 'streamable-http' }, 'streamable-http'),
          )),
          stdio ? row(t('命令', 'Command'), h(Input, { value: draft.command, placeholder: 'npx', onChange: (value) => patch({ command: value }) })) : null,
          stdio ? row(t('参数', 'Arguments'), h(Textarea, { value: draft.args, placeholder: '-y\n@modelcontextprotocol/server-github', onChange: (value) => patch({ args: value }) })) : null,
          stdio ? row(t('环境变量', 'Environment'), h(Textarea, { value: draft.env, placeholder: 'GITHUB_TOKEN=xxx', onChange: (value) => patch({ env: value }) })) : null,
          stdio ? row(t('工作目录', 'Working dir'), h(Input, { value: draft.cwd, onChange: (value) => patch({ cwd: value }) })) : null,
          !stdio ? row('URL', h(Input, { value: draft.url, placeholder: 'http://localhost:3000/mcp', onChange: (value) => patch({ url: value }) })) : null,
          !stdio ? row(t('请求头', 'Headers'), h(Textarea, { value: draft.headers, placeholder: 'Authorization: Bearer xxx', onChange: (value) => patch({ headers: value }) })) : null,
          ...row(t('调用超时 (ms)', 'Call timeout (ms)'), h(Input, { value: draft.toolCallTimeoutMs, placeholder: '60000', onChange: (value) => patch({ toolCallTimeoutMs: value }) })),
          ...row(t('指令上限 (bytes)', 'Instruction cap (bytes)'), h(Input, { value: draft.maxInstructionBytes, placeholder: '32768', onChange: (value) => patch({ maxInstructionBytes: value }) })),
          ...row(t('断线重连', 'Reconnect'), h(
            'div',
            { style: { display: 'flex', flexDirection: 'column', gap: '8px' } },
            h(Switch, { checked: draft.reconnectEnabled, label: t('自动重连', 'Reconnect automatically'), onChange: (checked) => patch({ reconnectEnabled: checked }) }),
            h('div', { style: { display: 'flex', gap: '8px' } },
              h(Input, { value: draft.reconnectInitialDelayMs, placeholder: t('首次延迟 ms', 'initial delay ms'), onChange: (value) => patch({ reconnectInitialDelayMs: value }) }),
              h(Input, { value: draft.reconnectMaxDelayMs, placeholder: t('最大延迟 ms', 'max delay ms'), onChange: (value) => patch({ reconnectMaxDelayMs: value }) }),
              h(Input, { value: draft.reconnectMaxAttempts, placeholder: t('最大次数', 'max attempts'), onChange: (value) => patch({ reconnectMaxAttempts: value }) }),
            ),
          )),
          ...row(t('启用', 'Enabled'), h(Switch, { checked: draft.enabled, label: t('保存后立即启用', 'Enable right after saving'), onChange: (checked) => patch({ enabled: checked }) })),
          ...row(t('启动即失败', 'Fail on startup error'), h(Switch, { checked: draft.failOnStartupError, label: t('连接失败时阻止启动', 'Reject activation when the first connection fails'), onChange: (checked) => patch({ failOnStartupError: checked }) })),
        ),
        h(
          'div',
          { className: 'dcc-actions' },
          h(Button, { variant: 'primary', disabled: props.busy === true, onClick: props.onSave }, t('保存', 'Save')),
          h(Button, { onClick: props.onCancel }, t('取消', 'Cancel')),
        ),
      )
    }

    // ── skills ──────────────────────────────────────────────────────────────
    function SkillsSection() {
      const section = useSection('skill.state')
      const [draft, setDraft] = useState(null)
      const [pulling, setPulling] = useState({ url: '', overwrite: false })
      const [pullResult, setPullResult] = useState(null)
      const [editing, setEditing] = useState(null)

      const root = section.data?.roots?.[0] ?? null

      const openEditor = async (skill) => {
        const value = await section.run('skill.read', { id: skill.id })
        if (value !== null) setEditing({ id: skill.id, name: value.skill.name, path: value.skill.path, text: value.text, dirty: false })
      }

      const newSkill = () => setDraft({ name: '', description: '', whenToUse: '', body: '' })

      return h(
        'div',
        { className: 'dcc-root' },
        h('style', null, CSS),
        h(
          'div',
          { className: 'dcc-head' },
          h('div', { className: 'dcc-title' }, t('Skill 管理', 'Skills')),
          h(
            'div',
            { className: 'dcc-intro' },
            t(
              '手动编写 skill，或从 GitHub 仓库地址自动拉取；已安装的 skill 可查看与删除。安装目录会被 dsh-skill-filesystem 自动扫描。',
              'Author skills by hand or pull them from a GitHub repository; installed skills can be inspected and removed. The install root is scanned by dsh-skill-filesystem.',
            ),
          ),
        ),
        h(Message, { kind: 'ok', message: section.notice }),
        h(Message, { kind: 'error', message: section.error }),

        h(
          Card,
          null,
          h(CardHead, {
            title: t('已安装的 Skill', 'Installed skills'),
            badge: h('span', { className: 'dcc-badge' }, String(section.data?.skills?.length ?? 0)),
            actions: h(Button, { variant: 'primary', onClick: newSkill, disabled: section.busy === true }, t('新建 Skill', 'New skill')),
          }),
          section.data === null
            ? h(Empty, null, t('加载中…', 'Loading…'))
            : section.data.skills.length === 0
              ? h(Empty, null, t('还没有安装任何 skill。', 'No skill is installed yet.'))
              : h(
                  'div',
                  { className: 'dcc-list' },
                  section.data.skills.map((skill) =>
                    h(
                      'div',
                      { className: 'dcc-row', key: `${skill.rootId}|${skill.path}` },
                      h(
                        'div',
                        { className: 'dcc-rowmain' },
                        h('span', { className: 'dcc-rowtitle' }, skill.name),
                        h('span', { className: 'dcc-badge' }, skill.rootLabel),
                        skill.disableModelInvocation ? h('span', { className: 'dcc-badge' }, t('仅人工调用', 'user-only')) : null,
                        skill.warnings.length > 0
                          ? h('span', { className: 'dcc-badge dcc-badge-warn' }, `${skill.warnings.length} ${t('项警告', 'warnings')}`)
                          : null,
                        h(
                          'div',
                          { className: 'dcc-rowactions', style: { marginLeft: 'auto' } },
                          h(Button, { small: true, onClick: () => void openEditor(skill) }, t('查看/编辑', 'Open')),
                          h(
                            Button,
                            {
                              small: true,
                              variant: 'danger',
                              disabled: section.busy === true || skill.editable !== true,
                              onClick: () => {
                                if (typeof confirm === 'function' && !confirm(t(`删除 skill「${skill.name}」？`, `Delete skill "${skill.name}"?`))) return
                                setEditing((current) => (current !== null && current.id === skill.id ? null : current))
                                void section.run('skill.remove', { id: skill.id }, (next) => {
                                  section.setData(next)
                                  section.setNotice(t('已删除。', 'Deleted.'))
                                })
                              },
                            },
                            t('删除', 'Delete'),
                          ),
                        ),
                      ),
                      skill.description === '' ? null : h('div', { className: 'dcc-note' }, skill.description),
                      h('div', { className: 'dcc-note dcc-mono' }, skill.path),
                      skill.warnings.length === 0
                        ? null
                        : h('div', { className: 'dcc-note' }, t('警告：', 'Warnings: ') + skill.warnings.join('; ')),
                    ),
                  ),
                ),
        ),

        draft === null
          ? null
          : h(
              Card,
              null,
              h(CardHead, { title: t('新建 Skill', 'New skill') }),
              h(
                'div',
                { className: 'dcc-form' },
                h(Field, { label: t('名称', 'Name') }),
                h(Input, { value: draft.name, placeholder: 'my-skill', onChange: (value) => setDraft({ ...draft, name: value }) }),
                h(Field, { label: t('描述', 'Description') }),
                h(Input, {
                  value: draft.description,
                  placeholder: t('模型据此判断何时加载该技能', 'the model reads this to decide when to load the skill'),
                  onChange: (value) => setDraft({ ...draft, description: value }),
                }),
                h(Field, { label: t('何时使用', 'When to use') }),
                h(Input, { value: draft.whenToUse, placeholder: t('可选', 'optional'), onChange: (value) => setDraft({ ...draft, whenToUse: value }) }),
                h(Field, { label: t('正文', 'Instructions') }),
                h(Textarea, { editor: true, value: draft.body, onChange: (value) => setDraft({ ...draft, body: value }) }),
              ),
              h(
                'div',
                { className: 'dcc-actions' },
                h(
                  Button,
                  {
                    variant: 'primary',
                    disabled: section.busy === true,
                    onClick: () => {
                      void section.run('skill.save', draft, (next) => {
                        section.setData({ ...section.data, skills: next.skills })
                        setDraft(null)
                        section.setNotice(t('已创建 skill。', 'Skill created.'))
                      })
                    },
                  },
                  t('创建', 'Create'),
                ),
                h(Button, { onClick: () => setDraft(null) }, t('取消', 'Cancel')),
                root === null ? null : h('span', { className: 'dcc-note', style: { alignSelf: 'center' } }, root.path),
              ),
            ),

        editing === null
          ? null
          : h(
              Card,
              null,
              h(CardHead, {
                title: `${t('编辑', 'Editing')} ${editing.name}`,
                actions: h('span', { className: 'dcc-note dcc-mono' }, editing.path),
              }),
              h(Textarea, {
                editor: true,
                rows: 18,
                value: editing.text,
                onChange: (value) => setEditing({ ...editing, text: value, dirty: true }),
              }),
              h(
                'div',
                { className: 'dcc-actions' },
                h(
                  Button,
                  {
                    variant: 'primary',
                    disabled: section.busy === true || editing.dirty !== true,
                    onClick: () =>
                      void section.run('skill.write', { id: editing.id, text: editing.text }, (next) => {
                        section.setData({ ...section.data, skills: next.skills })
                        setEditing(null)
                        section.setNotice(t('已保存。', 'Saved.'))
                      }),
                  },
                  t('保存', 'Save'),
                ),
                h(Button, { onClick: () => setEditing(null) }, t('关闭', 'Close')),
              ),
            ),

        h(
          Card,
          null,
          h(CardHead, { title: t('从 GitHub 拉取', 'Install from GitHub') }),
          h(
            'div',
            { className: 'dcc-form' },
            h(Field, { label: t('仓库地址', 'Repository') }),
            h(Input, {
              value: pulling.url,
              placeholder: 'https://github.com/owner/repo 或 …/tree/main/skills',
              onChange: (value) => setPulling({ ...pulling, url: value }),
            }),
            h(Field, { label: t('覆盖安装', 'Overwrite') }),
            h(Switch, {
              checked: pulling.overwrite,
              label: t('同名 skill 已存在时替换它', 'replace a skill that is already installed under the same name'),
              onChange: (checked) => setPulling({ ...pulling, overwrite: checked }),
            }),
          ),
          h(
            'div',
            { className: 'dcc-actions' },
            h(
              Button,
              {
                variant: 'primary',
                disabled: section.busy === true || pulling.url.trim() === '',
                onClick: async () => {
                  setPullResult(null)
                  const value = await section.run('skill.pull', { url: pulling.url, overwrite: pulling.overwrite })
                  if (value !== null) {
                    section.setData({ ...section.data, skills: value.skills })
                    setPullResult(value)
                    section.setNotice(t(`已从 ${value.source} 安装 ${value.installed.length} 个 skill。`, `Installed ${value.installed.length} skill(s) from ${value.source}.`))
                  }
                },
              },
              t('拉取并安装', 'Pull and install'),
            ),
          ),
          pullResult !== null && pullResult.installed.length > 0
            ? h('div', { className: 'dcc-note' }, t('已安装：', 'Installed: ') + pullResult.installed.map((item) => item.name).join(', '))
            : null,
          pullResult !== null && pullResult.skipped.length > 0
            ? h(
                'div',
                { className: 'dcc-note dcc-badge-warn', style: { padding: '6px 10px', borderRadius: '8px' } },
                t('已跳过：', 'Skipped: ') + pullResult.skipped.map((item) => `${item.name} (${item.reason})`).join('; '),
              )
            : null,
        ),
      )
    }

    // ── personas ────────────────────────────────────────────────────────────
    function PersonaSection() {
      const section = useSection('persona.state')
      const [editing, setEditing] = useState(null)
      const [preview, setPreview] = useState(false)

      const open = async (id) => {
        const value = await section.run('persona.read', { id })
        if (value === null) return
        setEditing({
          id: value.persona === null ? '' : value.persona.id,
          name: value.persona === null ? '' : value.persona.name,
          description: value.persona === null ? '' : value.persona.description,
          body: value.text,
        })
      }

      const save = async (activate) => {
        const value = await section.run(
          'persona.save',
          { id: editing.id, name: editing.name, description: editing.description, body: editing.body, activate: activate === true },
          (next) => {
            section.setData({ activeId: next.activeId, personas: next.personas, storagePath: next.storagePath, sectionName: next.sectionName, available: next.available })
          },
        )
        if (value !== null) {
          setEditing({ ...editing, id: value.id })
          section.setNotice(
            activate === true
              ? t('已保存并启用；下一次对话请求就会带上该人设。', 'Saved and activated; the next model request carries it.')
              : t('已保存。', 'Saved.'),
          )
        }
      }

      const activeId = section.data?.activeId ?? null

      return h(
        'div',
        { className: 'dcc-root' },
        h('style', null, CSS),
        h(
          'div',
          { className: 'dcc-head' },
          h('div', { className: 'dcc-title' }, t('全局人设', 'Global persona')),
          h(
            'div',
            { className: 'dcc-intro' },
            t(
              '多人设管理：每个人设是一份 Markdown 文档，启用其中一份后，其内容会作为一个系统提示词段落注入所有会话。',
              'Multi-persona management: each persona is a Markdown document; the active one is injected into every session as a system-prompt section.',
            ),
          ),
        ),
        h(Message, { kind: 'ok', message: section.notice }),
        h(Message, { kind: 'error', message: section.error }),

        h(
          Card,
          null,
          h(CardHead, {
            title: t('人设列表', 'Personas'),
            badge: h('span', { className: 'dcc-badge' }, String(section.data?.personas?.length ?? 0)),
            actions: h(
              Button,
              { variant: 'primary', onClick: () => setEditing({ id: '', name: '', description: '', body: '' }), disabled: section.busy === true },
              t('新建人设', 'New persona'),
            ),
          }),
          section.data === null
            ? h(Empty, null, t('加载中…', 'Loading…'))
            : section.data.personas.length === 0
              ? h(Empty, null, t('还没有人设。', 'No persona yet.'))
              : h(
                  'div',
                  { className: 'dcc-list' },
                  section.data.personas.map((persona) =>
                    h(
                      'div',
                      { className: 'dcc-row', key: persona.id },
                      h(
                        'div',
                        { className: 'dcc-rowmain' },
                        h('span', { className: 'dcc-rowtitle' }, persona.name),
                        persona.id === activeId ? h('span', { className: 'dcc-badge dcc-badge-on' }, t('已启用', 'active')) : null,
                        h(
                          'div',
                          { className: 'dcc-rowactions', style: { marginLeft: 'auto' } },
                          h(Button, { small: true, onClick: () => void open(persona.id) }, t('编辑', 'Edit')),
                          persona.id === activeId
                            ? h(
                                Button,
                                {
                                  small: true,
                                  disabled: section.busy === true,
                                  onClick: () => void section.run('persona.activate', { id: null }, (next) => {
                                    section.setData(next)
                                    section.setNotice(t('已停用人设。', 'Persona disabled.'))
                                  }),
                                },
                                t('停用', 'Disable'),
                              )
                            : h(
                                Button,
                                {
                                  small: true,
                                  disabled: section.busy === true,
                                  onClick: () => void section.run('persona.activate', { id: persona.id }, (next) => {
                                    section.setData(next)
                                    section.setNotice(t('已启用。', 'Activated.'))
                                  }),
                                },
                                t('启用', 'Activate'),
                              ),
                          h(
                            Button,
                            {
                              small: true,
                              variant: 'danger',
                              disabled: section.busy === true,
                              onClick: () => {
                                if (typeof confirm === 'function' && !confirm(t(`删除人设「${persona.name}」？`, `Delete persona "${persona.name}"?`))) return
                                void section.run('persona.remove', { id: persona.id }, (next) => {
                                  section.setData(next)
                                  setEditing((current) => (current !== null && current.id === persona.id ? null : current))
                                  section.setNotice(t('已删除。', 'Deleted.'))
                                })
                              },
                            },
                            t('删除', 'Delete'),
                          ),
                        ),
                      ),
                      persona.description === '' ? null : h('div', { className: 'dcc-note' }, persona.description),
                      h('div', { className: 'dcc-note dcc-mono' }, `persona: ${persona.id}`),
                    ),
                  ),
                ),
          section.data?.available === false
            ? h(Empty, null, t('宿主未提供 systemPrompt 服务，人设暂时无法注入。', 'The host exposes no systemPrompt service, so personas cannot be injected.'))
            : null,
        ),

        editing === null
          ? null
          : h(
              Card,
              null,
              h(CardHead, {
                title: editing.id === '' ? t('新建人设', 'New persona') : t('编辑人设', 'Edit persona'),
                actions: h(
                  Button,
                  { small: true, onClick: () => setPreview((value) => !value) },
                  preview ? t('编辑', 'Edit') : t('预览', 'Preview'),
                ),
              }),
              h(
                'div',
                { className: 'dcc-form' },
                h(Field, { label: t('名称', 'Name') }),
                h(Input, { value: editing.name, placeholder: t('例如：严谨工程师', 'for example: Terse engineer'), onChange: (value) => setEditing({ ...editing, name: value }) }),
                h(Field, { label: t('说明', 'Description') }),
                h(Input, { value: editing.description, onChange: (value) => setEditing({ ...editing, description: value }) }),
              ),
              preview
                ? h(Markdown, { text: editing.body })
                : h(Textarea, { editor: true, rows: 20, value: editing.body, placeholder: t('写在这里的内容会成为所有会话的全局人设…', 'What you write here becomes the global persona of every session…'), onChange: (value) => setEditing({ ...editing, body: value }) }),
              h(
                'div',
                { className: 'dcc-actions' },
                h(Button, { variant: 'primary', disabled: section.busy === true, onClick: () => void save(false) }, t('保存', 'Save')),
                h(Button, { disabled: section.busy === true, onClick: () => void save(true) }, t('保存并启用', 'Save and activate')),
                h(Button, { onClick: () => setEditing(null) }, t('关闭', 'Close')),
                section.data?.storagePath === undefined
                  ? null
                  : h('span', { className: 'dcc-note dcc-mono', style: { alignSelf: 'center' } }, section.data.storagePath),
              ),
            ),
      )
    }

    // ── plugin ──────────────────────────────────────────────────────────────
    return {
      inject: ['slots'],
      apply(ctx) {
        const sections = [
          { id: 'control-center-mcp', order: 60, label: () => t('MCP 管理', 'MCP servers'), component: McpSection },
          { id: 'control-center-skills', order: 61, label: () => t('Skill 管理', 'Skills'), component: SkillsSection },
          { id: 'control-center-persona', order: 62, label: () => t('全局人设', 'Global persona'), component: PersonaSection },
        ]
        for (const section of sections) {
          ctx.slots.inject('settings.section', () =>
            ctx.slots.register(
              {
                name: 'settings.section',
                id: section.id,
                order: section.order,
                label: section.label,
              },
              section.component,
            ),
          )
        }
      },
    }
  },
})
