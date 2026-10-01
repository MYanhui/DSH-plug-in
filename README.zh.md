# dsh-control-center — 中文说明

给 DeepSeek Harness 的**集成控制插件**：在「设置」里新增三个可视化菜单 —— **MCP 管理**、**Skill 管理**、**全局人设**。

一个插件、两半结构：**宿主端**（Node）持有数据与唯一一处面向模型的贡献，**浏览器端**渲染三个页面到设置外壳里。

```
设置
├── …（官方页面）
├── MCP 管理        增删改查 MCP 服务
├── Skill 管理      手写或从 GitHub 拉取、查看、删除
└── 全局人设        多人设库，同时启用一份
```

---

## 一、安装与还原

### 一键安装

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\install.ps1
```

脚本做三件事，**可以反复执行**（幂等）：

1. 把插件包复制到 `<profile>/node_modules/dsh-control-center`；
2. 首次安装时备份 profile 的 `cordis.patch.yml` 为
   `cordis.patch.yml.bak-dsh-control-center`；
3. 在 patch 末尾写入一段带标记的挂载块（先删旧的再写新的，不会重复挂载：

```yaml
# dsh-control-center: managed mount
- insert:
    - id: control-center
      name: 'dsh-control-center'
```

常用参数：

| 参数 | 说明 |
|---|---|
| `-Profile <名称>` | profile 名，默认取 `$env:DSH_PROFILE`，否则 `desktop` |
| `-DshHome <路径>` | DSH 配置根，默认取 `$env:DSH_HOME`，否则 `~/.dsh` |
| `-DryRun` | 只打印将要做的事，不写任何文件 |

### 一键还原

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\uninstall.ps1
```

默认行为（彻底还原到安装之前）：

1. 从 `cordis.patch.yml` 删除挂载块（**只删自己写的那一段**，你的其他配置一律不动）；
2. 删除同一文件里由插件写入的 MCP 托管块；
3. 删除 `node_modules/dsh-control-center`。

**用户数据默认保留**在 `<DSH_HOME>\control-center`（人设 + MCP 定义），所以重新安装后 MCP 行会自动恢复。

| 参数 | 说明 |
|---|---|
| `-KeepMcpServers` | 保留 MCP 托管块，让已配置的 MCP 服务在插件卸载后继续加载 |
| `-RestoreBackup` | 不逐段删除，直接用首次安装的备份整体覆盖 patch |
| `-PurgeData` | 连 `<DSH_HOME>\control-center` 一起删除（人设与 MCP 定义会丢失） |
| `-DryRun` | 只打印将要做的事 |

### 安装之后

1. `dsh-hmr` 会监听到 patch 变化并**自动热重载**（没热重载就重启 DSH 桌面版）；
2. **刷新浏览器页面（F5）** —— 浏览器端的启动图多了一个插件，页面是之前加载的；
3. 打开侧边栏底部的「设置」，三个菜单就在官方页面后面。

### 手动安装（不使用脚本）

```powershell
$profile = "$env:DSH_HOME\profiles\$env:DSH_PROFILE"      # 例如 ...\.dsh\profiles\desktop
Copy-Item .\dsh-control-center "$profile\node_modules\dsh-control-center" -Recurse -Force
# 然后在 $profile\cordis.patch.yml 末尾追加上面那段挂载块
```

---

## 二、三个菜单的用法与原理

### 1. MCP 管理

**能做什么**：新增 / 编辑 / 删除 / 启用停用 MCP 服务；列表区分「已配置」「已启用」「已连接」三种状态。

**为什么这样实现**：在 DSH 里，一个 MCP 服务是**组合树里的一行 Loader 条目**（`@deepseek-ai/dsh-mcp-client`），不是设置文档里的一个值 —— 所以 `ctx.configEditor` 帮不上忙（它只能改已存在条目的 config，不能插入新行）。页面因此往 **profile 自己的 patch 层**（专门留给用户编辑的那一层）写一段带标记的**托管块**：

```yaml
# >>> dsh-control-center:mcp — managed, edit it from Settings instead
- insert: [{"id":"cc-mcp-github","name":"@deepseek-ai/dsh-mcp-client","config":{…}}]
# <<< dsh-control-center:mcp
```

两个性质让它安全：

- **标记之外的内容逐字节保留**，包括注释和 `!!js` 表达式 —— 只删除自己上次写的那一段；
- **负载是 JSON**（YAML 1.2 的严格子集），所以任何 URL、命令行参数、环境变量都不可能出现引号 / 冒号 / `#` 破坏文档结构的问题；写入前还会把自己刚生成的块反解析一次来校验。

真正的数据存在 `$DSH_HOME/control-center/mcp-servers.json`，patch 里的块每次都由它重新生成 —— 所以「停用」只移除行、不丢配置，卸载后重装也会自动恢复。

改动写入后由 `dsh-hmr` 重载组合树，MCP 客户端随之连接。

### 2. Skill 管理

**能做什么**：表单新建、原文编辑器查看/修改、删除、**从 GitHub 仓库地址自动拉取安装**。

**为什么这样实现**：skill 本来就是磁盘上的普通文件，所以这是一个针对 `dsh-skill-filesystem` **已经在扫描的目录**的文件编辑器，不另建数据库：

| 目录 | 来源 |
|---|---|
| `$DSH_HOME/skills` | `user-dsh`，provider 优先级 400 —— 安装落点，不存在会自动创建 |
| `$DSH_AGENTS_HOME/skills` | `user-agents`，优先级 500 |
| 任意 `customSkillDirs` | 从正在运行的 `skill-filesystem` 行读取 |

工程根目录下的 `.dsh/skills`、`.agents/skills` 依赖具体会话的工作目录，而不是这个全局页面，所以刻意不纳入管理。

- **新建**：写入 `<根>/<名称>/SKILL.md`，含 `name` / `description` / `whenToUse` 与正文；
- **原文编辑**：直接编辑文件全文，保存时重新校验 frontmatter（必须有 `name` 和 `description`）；
- **从 GitHub 拉取**：下载一份源码归档 → 找出其中所有深度合理的 `SKILL.md` → 逐个安装为 skill 目录。支持三种 URL 形态，以及 `git@github.com:owner/repo.git` 写法：

  ```
  https://github.com/owner/repo
  https://github.com/owner/repo/tree/<分支>
  https://github.com/owner/repo/tree/<分支>/<子路径>
  ```

  **不需要 git 命令**：归档从 `codeload.github.com` 下载，由内置的 tar 读取器解包（自己实现，无依赖）。同名 skill 只有打开「覆盖安装」才会替换。

因为 provider 会**监听**这些目录，新建 / 修改 / 删除的 skill 无需重启就会进入下一个模型步骤的技能目录。

### 3. 全局人设

**能做什么**：多人设管理 —— 每份人设是一篇 Markdown 文档，同时只有一份「已启用」；支持新建、编辑、Markdown 预览、启用/停用、删除。

**为什么这样实现**：启用的人设通过**唯一一个**系统提示词段落注入：

```js
ctx.systemPrompt.section({
  name: 'control-center:persona',
  order: 5,
  text: 启用的人设全文,
  interpolate: false,
})
```

由此得到三个（都是刻意的）性质：

- **叠加而非替换**：框架身份、部署人设、工具指引、环境信息全部原样保留；这个段落排在 order 0 的部署人设前缀**之后**、工具指引之前；
- **全局生效**：预设（preset）为单个 agent 遮蔽 `deployment:persona-prefix` 也**不会**移除它，所以对所有会话一致生效；
- **字面渲染**：`interpolate: false` 让 `{{…}}` 原样保留 —— 人设是散文而不是提示词模板，写到一个花括号绝不能让提示词组装失败。

切换启用的人设时，会先 dispose 旧段落再注册新的；下一次提示词组装就会带上新内容。文档存放在 `$DSH_HOME/control-center/personas/`，名称与说明存在 `personas.json`。

---

## 三、宿主端 HTTP API

只有一个 POST 路由 `/control-center/api`，用 `method` 字段区分操作：

| method | 作用 |
|---|---|
| `system.info` | 版本与各路径 |
| `mcp.state` / `mcp.save` / `mcp.remove` / `mcp.toggle` | MCP 服务 |
| `skill.state` / `skill.read` / `skill.save` / `skill.write` / `skill.remove` / `skill.pull` | Skill |
| `persona.state` / `persona.read` / `persona.save` / `persona.remove` / `persona.activate` | 人设 |

响应统一是 `{ ok: true, value }` 或 `{ ok: false, error: { code, message } }`。

**请求围栏**：路由会拒绝跨站的浏览器请求 —— 带 `Origin` 头时必须指向回环地址，带 `Content-Type` 时必须是 JSON（这会强制跨域预检，外部站点过不去）。**不带** `Origin` 的调用方（Electron 的 IPC 桥、shell 工具）本身已经拥有用户自己的权限，放行。

---

## 四、自检

两个脚本都不依赖任何三方库，也不需要 Harness 在运行：

```bash
node scripts/selfcheck.mjs      # 宿主端：frontmatter、tar、托管块幂等与转义、三个存储的真实文件往返
node scripts/clientsmoke.mjs    # 浏览器端：bundle、模块 id、插槽注册、三个页面用桩数据真实渲染
```

当前结果：**宿主端 82/82 通过**，**浏览器端 27/27 通过**。

`skill.pull` 的下载路径不在自检里（需要联网），请在运行中的 Harness 里用真实仓库验证。

---

## 五、目录结构

```
index.js                宿主端：路由、API 表、人设段落、MCP 托管块对账
client.js               浏览器端：三个 settings.section 页面
lib/wire.js             请求体读取、JSON 响应、请求围栏
lib/paths.js            DSH_HOME / profile 定位、原子读写
lib/mcp.js              MCP 存储 + profile patch 托管块
lib/skills.js           skill 根目录、frontmatter、增删改查、GitHub 安装
lib/github.js           仓库地址解析 + 归档下载
lib/tar.js              最小 tar 读取器
lib/personas.js         人设库 + 提示词段落生命周期
scripts/install.ps1     一键安装
scripts/uninstall.ps1   一键还原
scripts/selfcheck.mjs   宿主端自检
scripts/clientsmoke.mjs 浏览器端自检
```

---

## 六、实机验证记录

在 Windows + DSH 桌面版（`profile=desktop`）上逐项验证过：

| 项目 | 结果 |
|---|---|
| 宿主端自检 | 82/82 通过 |
| 浏览器端自检 | 27/27 通过 |
| 建 skill | 通过 API 创建后，**本会话的技能目录立刻出现**该 skill（provider 监听生效） |
| GitHub 拉取 | 从 `anthropics/skills` 拉到 **20 个 skill**，全部立即进入会话技能目录 |
| MCP | 写入的行被 HMR 加载、`dsh-mcp-client` 挂载成功，模型侧随即出现对应的 MCP 资源服务 |
| 全局人设 | 启用人设后，人设文本**出现在系统提示词顶部**（order 5 位置正确）；停用后消失 |
| 一键安装 | 幂等：重复执行会报告「挂载块已是最新，patch 未改动」 |
| 一键还原 | 挂载块与包目录被清除、用户原配置不受影响、数据目录保留；重装后自动恢复 |

---

## 七、注意事项与排错

**浏览器端不刷新看不到菜单**
客户端插件的启动图在页面加载时生成。`dsh-hmr` 会把新的图推给已打开的页面，但最稳妥的做法是刷新一次（F5）。

**改了源码但行为没变**
DSH 只对 patch 文件热重载，**不会**热重载已导入的宿主端模块。改动 `index.js` / `lib/*.js` 后需要重启 DSH；改动 `client.js` 需要刷新页面。

**中文乱码 / 脚本报语法错误**
两个 `.ps1` 是 UTF-8 **带 BOM**。Windows PowerShell 5.1 在无 BOM 时按 ANSI 代码页读取 `.ps1`，中文会乱码并直接导致语法错误 —— 请不要用会去掉 BOM 的编辑器另存。若已被去掉，可用下面这段补回：

```powershell
$p = '.\scripts\install.ps1'
$t = [IO.File]::ReadAllText((Resolve-Path $p), [Text.Encoding]::UTF8)
[IO.File]::WriteAllText((Resolve-Path $p), $t, (New-Object Text.UTF8Encoding($true)))
```

**AI 助手说话带问号 / 数据库里存成 `????`**
那是调用方（例如 `Invoke-RestMethod` 在未声明字符集时）把请求体按非 UTF-8 编码发出去了。浏览器端走 `fetch` + `JSON.stringify`，始终是 UTF-8，不受影响；用命令行测试时请用 `curl --data-binary @文件` 并确保文件是 UTF-8 无 BOM。

**MCP 服务加了但没生效**
检查 `cordis.patch.yml` 末尾是否有 `# >>> dsh-control-center:mcp` 块；没有的话在页面上随便改动一次（例如停用再启用）触发重写，或重启 DSH —— 插件启动时会按 `mcp-servers.json` 自动对账。

**关于 MCP 的 profile patch**
插件只增删自己标记的那一段，绝不重写整个文件。`install.ps1` 会在首次安装时留下 `cordis.patch.yml.bak-dsh-control-center` 作为最终回退点。

---

## 八、上架插件市场

`package.json` 已按市场要求加固：去掉 `private`，补上 `license` / `repository`（含 `directory`）/ `homepage` / `bugs` / `author` / `keywords` / `engines.dsh` / `peerDependencies` / `dsh.manifestVersion`；`locale/en.json` 与 `locale/zh.json` 提供市场卡片的中英文文案。

市场的收录入口是精选列表仓库 [awesome-dsh-plugin](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin)：往 `data/plugins/` 加**一个**条目文件 → 跑一次 `node scripts/generate-readme.mjs` → 提 PR。合并后网站自动重建，通常一天内出现在 `dshmarket` 里。

> 注意：`dshmarket` 仓库本身是市场应用，不是插件目录，往那里提条目会被要求转去 awesome-dsh-plugin。

**逐步操作清单见仓库根目录的 `publish/PUBLISHING.zh.md`**，配套文件：

| 文件 | 作用 |
|---|---|
| `publish/awesome-dsh-plugin/*.yml` | 条目文件（大仓库布局 / 仓库根布局，二选一） |
| `publish/validate-entry.mjs` | 提交前机械校验：文件名、字段、分类、`": "` 引号陷阱 |
| `publish/screenshots.example.json` | 市场截图声明模板 |

提交前先跑一次校验：

```bash
node publish/validate-entry.mjs publish/awesome-dsh-plugin/*.yml
```

