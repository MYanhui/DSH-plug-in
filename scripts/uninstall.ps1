#Requires -Version 5.1
<#
.SYNOPSIS
    一键还原：把 dsh-control-center 从本机 DSH profile 中卸载。

.DESCRIPTION
    默认行为（尽可能干净地还原到安装之前）：

      1. 从 profile 的 cordis.patch.yml 中删除挂载块（只删自己写的那一段）；
      2. 删除同一文件里由插件写入的 MCP 托管块（-KeepMcpServers 可保留）；
      3. 删除 <profile>/node_modules/dsh-control-center。

    用户数据（人设、MCP 服务定义）默认保留在 <DSH_HOME>/control-center，
    加 -PurgeData 才会删除；重新安装后插件会自动按这份数据重建 MCP 托管块。

.PARAMETER Profile
    profile 名称。默认取 $env:DSH_PROFILE，否则 desktop。

.PARAMETER DshHome
    DSH 配置根目录。默认取 $env:DSH_HOME，否则 ~/.dsh。

.PARAMETER KeepData
    保留 <DSH_HOME>/control-center（默认即保留，此参数仅为显式说明）。

.PARAMETER PurgeData
    连同 <DSH_HOME>/control-center 一起删除（人设与 MCP 定义会丢失）。

.PARAMETER KeepMcpServers
    保留 patch 中的 MCP 托管块，让已配置的 MCP 服务继续加载。

.PARAMETER RestoreBackup
    不逐段删除，而是直接把首次安装时留下的
    cordis.patch.yml.bak-dsh-control-center 覆盖回去（整体还原）。

.PARAMETER DryRun
    只打印将要做的改动，不写任何文件。

.EXAMPLE
    powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\uninstall.ps1

.EXAMPLE
    powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\uninstall.ps1 -RestoreBackup -PurgeData

.NOTES
    本文件是 UTF-8 **带 BOM**。Windows PowerShell 5.1 在无 BOM 时按 ANSI 代码页
    读取 .ps1，中文会乱码并导致语法错误，所以请勿用会去掉 BOM 的编辑器另存。
#>
[CmdletBinding()]
param(
    [string] $Profile = $(if ($env:DSH_PROFILE) { $env:DSH_PROFILE } else { 'desktop' }),
    [string] $DshHome = $(if ($env:DSH_HOME) { $env:DSH_HOME } else { Join-Path $HOME '.dsh' }),
    [switch] $KeepData,
    [switch] $PurgeData,
    [switch] $KeepMcpServers,
    [switch] $RestoreBackup,
    [switch] $DryRun
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$MountMarker = '# dsh-control-center: managed mount'
$McpBegin = '# >>> dsh-control-center:mcp'
$McpEnd = '# <<< dsh-control-center:mcp'

function Write-Step([string] $Message) { Write-Host "  $Message" }
function Write-Head([string] $Message) { Write-Host "`n$Message" -ForegroundColor Cyan }

function Read-Utf8([string] $Path) {
    return [System.IO.File]::ReadAllText($Path, [System.Text.Encoding]::UTF8)
}

function Write-Utf8NoBom([string] $Path, [string] $Text) {
    $utf8 = New-Object System.Text.UTF8Encoding($false)
    [System.IO.File]::WriteAllText($Path, $Text, $utf8)
}

<#
    Remove the mount block: the marker line plus the single top-level
    `- insert:` entry that follows it. A top-level entry ends at the next line
    starting at column 0 with "- ", so the entry's indented children are
    consumed and the user's following rows survive.
#>
function Remove-MountBlock([string] $Text) {
    $lines = [System.Collections.Generic.List[string]]::new()
    $lines.AddRange([string[]] ($Text -split "`r?`n"))

    $start = -1
    for ($i = 0; $i -lt $lines.Count; $i++) {
        if ($lines[$i].Trim() -eq $MountMarker) { $start = $i; break }
    }
    if ($start -lt 0) { return $Text }

    $i = $start
    while ($i -lt $lines.Count -and -not $lines[$i].StartsWith('- ')) { $i++ }
    $end = $lines.Count
    if ($i -lt $lines.Count) {
        $j = $i + 1
        while ($j -lt $lines.Count -and -not $lines[$j].StartsWith('- ')) { $j++ }
        $end = $j
    }

    $kept = [System.Collections.Generic.List[string]]::new()
    for ($k = 0; $k -lt $start; $k++) { $kept.Add($lines[$k]) }
    for ($k = $end; $k -lt $lines.Count; $k++) { $kept.Add($lines[$k]) }
    return ($kept -join "`n")
}

# Remove the MCP managed block, including the blank line that separated it.
function Remove-McpBlock([string] $Text) {
    $lines = [System.Collections.Generic.List[string]]::new()
    $lines.AddRange([string[]] ($Text -split "`r?`n"))

    $start = -1
    $end = -1
    for ($i = 0; $i -lt $lines.Count; $i++) {
        if ($start -lt 0 -and $lines[$i].StartsWith($McpBegin)) { $start = $i; continue }
        if ($start -ge 0 -and $lines[$i].StartsWith($McpEnd)) { $end = $i; break }
    }
    if ($start -lt 0) { return $Text }
    if ($end -lt 0) { $end = $lines.Count - 1 }
    while ($end + 1 -lt $lines.Count -and $lines[$end + 1].Trim() -eq '') { $end++ }

    $kept = [System.Collections.Generic.List[string]]::new()
    for ($k = 0; $k -lt $start; $k++) { $kept.Add($lines[$k]) }
    for ($k = $end + 1; $k -lt $lines.Count; $k++) { $kept.Add($lines[$k]) }
    return (($kept -join "`n").TrimEnd() + "`n")
}

# ── resolve targets ─────────────────────────────────────────────────────────

Write-Head 'dsh-control-center 卸载'

$profileDir = Join-Path (Join-Path $DshHome 'profiles') $Profile
if (-not (Test-Path -LiteralPath $profileDir)) {
    throw "找不到 profile 目录：$profileDir"
}
$patchPath = Join-Path $profileDir 'cordis.patch.yml'
$backupPath = "$patchPath.bak-dsh-control-center"
$target = Join-Path (Join-Path $profileDir 'node_modules') 'dsh-control-center'
$dataDir = Join-Path $DshHome 'control-center'
Write-Step "目标 profile：$profileDir"

# ── step 1: the patch ───────────────────────────────────────────────────────

Write-Head '1/3  清理 profile patch'

if (-not (Test-Path -LiteralPath $patchPath)) {
    Write-Step 'patch 不存在，跳过'
} elseif ($RestoreBackup) {
    if (-not (Test-Path -LiteralPath $backupPath)) {
        throw "找不到备份：$backupPath（改用默认的逐段删除，或先去备份目录确认）"
    }
    if ($DryRun) {
        Write-Step "[dry-run] 用备份覆盖 $patchPath"
    } else {
        Copy-Item -LiteralPath $backupPath -Destination $patchPath -Force
        Write-Step "已用备份整体还原 -> $patchPath"
    }
} else {
    $before = Read-Utf8 $patchPath
    $after = Remove-MountBlock $before
    $mountRemoved = $after -cne $before

    $mcpRemoved = $false
    if (-not $KeepMcpServers) {
        $withoutMcp = Remove-McpBlock $after
        $mcpRemoved = $withoutMcp -cne $after
        $after = $withoutMcp
    }

    if (-not $mountRemoved -and -not $mcpRemoved) {
        Write-Step 'patch 中没有本插件写入的内容，未改动'
    } elseif ($DryRun) {
        Write-Step "[dry-run] 将删除：$(if ($mountRemoved) { '挂载块 ' })$(if ($mcpRemoved) { 'MCP 托管块' })"
    } else {
        Write-Utf8NoBom $patchPath $after
        Write-Step "已删除：$(if ($mountRemoved) { '挂载块 ' })$(if ($mcpRemoved) { 'MCP 托管块' })"
        if ($mcpRemoved) { Write-Step "MCP 定义仍保存在：$(Join-Path $dataDir 'mcp-servers.json')" }
    }
}

# ── step 2: the package ─────────────────────────────────────────────────────

Write-Head '2/3  删除插件包'

if (-not (Test-Path -LiteralPath $target)) {
    Write-Step '未安装，跳过'
} elseif ($DryRun) {
    Write-Step "[dry-run] 删除 $target"
} else {
    Remove-Item -LiteralPath $target -Recurse -Force
    Write-Step "已删除 $target"
}

# ── step 3: user data ───────────────────────────────────────────────────────

Write-Head '3/3  用户数据'

if ($PurgeData) {
    if (-not (Test-Path -LiteralPath $dataDir)) {
        Write-Step '没有数据目录，跳过'
    } elseif ($DryRun) {
        Write-Step "[dry-run] 删除 $dataDir"
    } else {
        Remove-Item -LiteralPath $dataDir -Recurse -Force
        Write-Step "已删除 $dataDir"
    }
} else {
    Write-Step "已保留 $dataDir（含人设与 MCP 定义；重新安装后会自动恢复 MCP 行）"
}

# ── done ────────────────────────────────────────────────────────────────────

Write-Head '完成'
if ($DryRun) {
    Write-Host '  dry-run：未写入任何文件。'
    exit 0
}
Write-Host @'
  刷新浏览器页面（F5）后，设置里的三个菜单即消失。
  如果 DSH 未自动热重载，重启 DSH 桌面版即可。
'@
