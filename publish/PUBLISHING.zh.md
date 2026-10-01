# 上架 DSH 插件市场 · 操作清单

目标：把 `dsh-control-center` 收录进 [awesome-dsh-plugin](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin) 精选列表，从而出现在 `dshmarket` 插件市场里。

目标仓库：**https://github.com/MYanhui/DSH-plug-in**（默认分支 `master`）

---

## 0. 先理解链路

「插件市场」本身**不是目录**，它只是读取一份精选列表：

```
你的仓库 github.com/MYanhui/DSH-plug-in
   └─ 提 PR 到 awesome-dsh-plugin/awesome-dsh-plugin
         └─ data/plugins/MYanhui__DSH-plug-in.yml    ← 只加这一个文件
               └─ CI 检查 + 维护者读你的仓库源码 → 合并
                     └─ awesome-dsh-plugin.com/plugins.json（CI 每日刷新）
                           └─ dshmarket 读到它 → 卡片出现，用户一键安装
```

两个直接结论：

- **提 PR 是唯一入口。** 市场只允许安装精选列表内的来源，其它一律拒绝。往 `dsh-market` 仓库提插件条目是无效的（那个仓库是市场应用本身）。
- **不要求发 npm。** 收录只看仓库；发 npm 只是让安装体验更好（免构建授权、能显示下载量）。

### 前置条件对照表（CI 按这个顺序查）

PR 随时可以开，但 CI 不过就等于没提。逐条对上再提交：

| # | CI 检查 | 要求 | 状态 |
|---|---|---|---|
| 1 | 条目数 | 一个 PR 最多 3 条 | ✅ 只提 1 条 |
| 2 | `dsh.bundle` | 从仓库 `package.json`（根，或 `packages/` · `plugins/` · `apps/` 子包）读到 | ❌ **代码还没推** |
| 3a | 仓库年龄 | 创建满 1 天 | ✅ **2020-06-30 创建**，早已满足 |
| 3b | 提交数 | ≥ 10 | ❌ **当前 2 次**（都是 2020-06-30 的旧提交） |
| 4 | `awesome-lint` + 站点构建 | 条目格式、双语一致性、README 能重新生成 | ✅ 条目文件已用 `validate-entry.mjs` 校验 |

> 唯一剩下要攒的是 **3b**，以及推送本身。仓库年龄这条用现在这个仓库已经过了，不用等。

---

## 1. 我已经准备好的东西

| 文件 | 作用 |
|---|---|
| `dsh-control-center/**` | 插件包本体（21 个文件） |
| `dsh-control-center/package.json` | 市场合规版：无 `private`，含 `license` / `repository` / `homepage` / `bugs` / `keywords` / `engines.dsh` / `peerDependencies` / `dsh.manifestVersion` |
| `dsh-control-center/locale/{en,zh}.json` | 市场卡片的中英文标题与描述 |
| `dsh-control-center/LICENSE` | MIT |
| `dsh-control-center/.gitignore` | 忽略 `node_modules/`、`*.tgz`、`*.log` |
| `publish/awesome-dsh-plugin/MYanhui__DSH-plug-in.yml` | 提交给精选列表的条目文件（**只有这一个**） |
| `publish/validate-entry.mjs` | 提交前机械校验 |
| `publish/screenshots.example.json` | 市场截图声明模板 |

仓库引用已经全部改成 `MYanhui/DSH-plug-in`：

- `package.json` → `repository.url` = `git+https://github.com/MYanhui/DSH-plug-in.git`（**无 `directory`**，因为包就在仓库根）
- `package.json` → `homepage` / `bugs`
- 条目文件 → `url` / `name` / 文件名三者一致

---

## 2. 你要做的：清空旧内容并推送

因为仓库名已经是插件专用的 `DSH-plug-in`，**采用仓库根布局**：仓库根 == npm 包本身。

```
MYanhui/DSH-plug-in/          ← 默认分支 master
├── package.json
├── cordis.patch.yml
├── index.js                  ← 宿主端
├── client.js                 ← 浏览器端
├── lib/                      ← 7 个模块
├── locale/                   ← en.json / zh.json
├── scripts/                  ← 自检 + 一键安装/还原
├── icon.svg  LICENSE  README.md  README.zh.md
└── publish/                  ← 上架工具包（不进 npm 包）
```

```powershell
cd C:\Users\Thinkpad\Documents
git clone https://github.com/MYanhui/DSH-plug-in.git
cd DSH-plug-in

$work = 'C:\Users\Thinkpad\Documents\deepseek-harness\default-workspace'

# 1) 清空旧内容（aria2.tar / index.html / 旧 LICENSE），保留 .git
Get-ChildItem -Force | Where-Object { $_.Name -ne '.git' } | Remove-Item -Recurse -Force

# 2) 拷入插件（根布局：包内容直接落在仓库根）
Copy-Item -Recurse "$work\dsh-control-center\*" . -Force
Copy-Item -Recurse "$work\publish" .

# 3) 提交
git add .
git commit -m "feat: dsh-control-center plugin"
git push
```

推完后：

1. **给仓库加 `dsh-plugin` topic** —— 仓库首页右上角齿轮 → Topics。**CI 会检查**，你仓库现在是空数组。
2. **确认默认分支是 `master`** —— 条目文件用的是无 tree 路径的 `url`，所以分支名不影响条目；但你自己推送时是在 `master` 上，别搞混。

### 关于「提交数 ≥ 10」

仓库现在只有 2 次 2020 年的旧提交，**还差 8 次**。⚠️ **不要造空提交凑数** —— 这条规则的目的就是筛掉「PR 前几分钟才建好的仓库」，而维护者会实际读你的仓库，凑数的痕迹很明显。

诚实的做法是**按自然边界提交**。这个插件本身就有若干互相独立的交付单元，分开提交是正常习惯：

| 建议的提交边界 | 内容 |
|---|---|
| 1 | `package.json`、`cordis.patch.yml`、`icon.svg`（包骨架与清单） |
| 2 | `index.js`（宿主端入口：路由 + 人设段落 + MCP 对账） |
| 3 | `lib/wire.js`、`lib/paths.js`（基础设施） |
| 4 | `lib/mcp.js`（MCP 存储 + profile patch 托管块） |
| 5 | `lib/tar.js`、`lib/github.js`、`lib/skills.js`（Skill 与 GitHub 安装） |
| 6 | `lib/personas.js`（人设与提示词段落） |
| 7 | `client.js`（浏览器端三个设置页面） |
| 8 | `locale/`（双语元数据） |
| 9 | `scripts/selfcheck.mjs`、`scripts/clientsmoke.mjs`（自检） |
| 10 | `scripts/install.ps1`、`scripts/uninstall.ps1`（一键安装/还原） |
| 11 | `README.md`、`README.zh.md`、`LICENSE`、`.gitignore` |
| 12 | `publish/`（上架工具包） |

加上原有的 2 次，轻松过 10。**关键是每个提交都是一块真实的工作**，而不是 `--allow-empty`。

如果你不想拆，那就等后续真实迭代（修 bug、补截图、按市场反馈调整）自然积累 —— 这条门槛本来就是这个意思。

---

## 3. 你要做的：发 npm 包（推荐，非必须）

```powershell
cd DSH-plug-in
npm login
npm publish
```

- 包名就用 **`dsh-control-center`**（`registry.npmjs.org` 上目前是空的，可以直接占）。
  想用带 scope 的写法（例如 `@myanhui/dsh-control-center`）也行，但**改了包名就要同步改** `cordis.patch.yml` 里的 `name:` 和两个安装脚本里的引用，别漏。
- **不需要通知列表维护者。** npm 映射会从 registry 自动采集；在条目 yml 里手写 `npm:` 会被校验**直接拒绝**。
- 发布前可以先干跑确认打包内容：`npm pack --dry-run`（应该正好是 21 个文件，`publish/`、`.gitignore`、`.tgz` 都不在包里）。

---

## 4. 你要做的：提 PR 到 awesome-dsh-plugin

```powershell
git clone https://github.com/awesome-dsh-plugin/awesome-dsh-plugin.git
cd awesome-dsh-plugin
npm ci

# 放进唯一的那个条目文件（用工作目录里的 publish/…）
Copy-Item <工作目录>\publish\awesome-dsh-plugin\MYanhui__DSH-plug-in.yml data\plugins\

node scripts/generate-readme.mjs        # ← 必须跑：两个 README 是生成的

git checkout -b add-dsh-control-center
git add data/plugins/MYanhui__DSH-plug-in.yml README.md README.zh.md
git commit -m "Add dsh-control-center"
git push -u origin add-dsh-control-center
```

然后在 GitHub 上开 PR。

**PR 规则（违反会被 CI 或评审打回）：**

| 规则 | 说明 |
|---|---|
| 一个 PR 最多 3 条 | 你只提 1 条，没问题 |
| 只改自己的文件 | 改到别人的条目会被 gate 点名 |
| 不要手改 README | 它们是生成的，手改会让改动落到邻居头上 |
| 描述含 `: ` 必须加引号 | 条目文件已经加好了（单引号包裹） |
| 不要在 yml 里写 `npm:` | 会被校验拒绝 |
| 描述必须属实 | 评审会**逐句对着你的源码核**。我写的是功能陈述，不带数字、不带营销词 |

**CI 依次检查：** 条目数 → 从你仓库读 `dsh.bundle` → 仓库年龄/提交数 → `awesome-lint` 与站点构建。
失败会明确说改什么，**在同一分支推修复即可，不用重开 PR**。

---

## 5. 合并之后

- 网站自动重建，通常**一天内**出现在 `dshmarket` 的列表里；
- 想换截图：推你自己仓库的 `screenshots.json`，**不用再提 PR**，次日构建自动生效；
- 条目失效（仓库归档、停更）会被定期扫描标记后移除。

> ⚠️ 这个仓库在 2020-06-30 之后一直停更，现在被复用。收录后请保持正常维护 —— 官方有定期扫描，长时间停更的条目会被汇总、复核后移除。

---

## 6. 截图（可选，推荐）

市场支持 App Store 式截图。把 `publish/screenshots.example.json` 改名成 `screenshots.json`，放到**仓库根**（也就是 `package.json` 旁边），填 1–8 张图片：

```jsonc
// DSH-plug-in/screenshots.json
[
  "assets/screenshot-mcp.png",
  "assets/screenshot-skills.png"
]
```

- 路径相对该文件本身，指向仓库里已有的图片；
- 相对路径不能以 `/` 开头、不能含 `..`；
- 也接受绝对 URL，但必须是 **GitHub 托管**的 https（`raw.githubusercontent.com`、`github.com` 附件等），第三方图床会被拒；
- 不声明也行：市场会从你的 README 自动抽图。

> **我无法代你生成截图。** 我没有浏览器控制能力，按 Harness 插件规范也不允许用光栅化工具或模拟 DOM 去伪造预览图 —— 那种截图不算对运行中插件的验证。启动 DSH、刷新页面后自己截最直接。

---

## 7. 引用一致性（已经改好，改动前请对照）

| 位置 | 值 |
|---|---|
| `package.json` → `repository.url` | `git+https://github.com/MYanhui/DSH-plug-in.git` |
| `package.json` → `homepage` | `https://github.com/MYanhui/DSH-plug-in` |
| `package.json` → `bugs.url` | `https://github.com/MYanhui/DSH-plug-in/issues` |
| 条目文件路径 | `data/plugins/MYanhui__DSH-plug-in.yml` |
| 条目 `url` | `https://github.com/MYanhui/DSH-plug-in` |
| 条目 `name` | `MYanhui/DSH-plug-in` |

`url` / `name` / 文件名三者必须互相吻合，`validate-entry.mjs` 会校验。改完打包相关字段后重新跑一遍：

```powershell
node dsh-control-center\scripts\selfcheck.mjs
node dsh-control-center\scripts\clientsmoke.mjs
node publish\validate-entry.mjs publish\awesome-dsh-plugin\MYanhui__DSH-plug-in.yml
powershell -NoProfile -ExecutionPolicy Bypass -File dsh-control-center\scripts\install.ps1
```

---

## 8. 分类

选的是 **`ui`**（三个菜单本质是设置页 UI）。官方原话：**分类选不准不会被打回，维护者会直接改**。备选 `dev`。

合法取值：
`agi` `ui` `usage` `theme` `model` `identity` `session` `memory` `tools` `browser` `vision` `voice` `docs` `skill` `workflow` `git` `notify` `dev` `security` `remote` `market` `fun`
