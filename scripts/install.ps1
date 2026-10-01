#Requires -Version 5.1
<#
.SYNOPSIS
    一键把 dsh-control-center 安装到本机 DSH profile。

.DESCRIPTION
    做三件事，全部可重复执行（幂等）：

      1. 把插件包复制到 <profile>/node_modules/dsh-control-center；
      2. 备份 profile 的 cordis.patch.yml（首次安装时留下 .bak-dsh-control-center）；
      3. 在 patch 末尾写入一段带标记的挂载块（先删旧的，再写新的，不会重复）。

    dsh-hmr 会监听该 patch 文件，所以保存后插件即被加载；浏览器端首次出现
    需要刷新一次页面。

.PARAMETER Profile
    profile 名称。默认取 $env:DSH_PROFILE，否则 desktop。

.PARAMETER DshHome
    DSH 配置根目录。默认取 $env:DSH_HOME，否则 ~/.dsh。

.PARAMETER DryRun
    只打印将要做的改动，不写任何文件。

.EXAMPLE
    powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\install.ps1

.EXAMPLE
    powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\install.ps1 -Profile web -DshHome D:\dsh-home

.NOTES
    本文件是 UTF-8 **带 BOM**。Windows PowerShell 5.1 在无 BOM 时按 ANSI 代码页
    读取 .ps1，中文会乱码并导致语法错误，所以请勿用会去掉 BOM 的编辑器另存。
#>
[CmdletBinding()]
param(
    [string] $Profile = $(if ($env:DSH_PROFILE) { $env:DSH_PROFILE } else { 'desktop' }),
    [string] $DshHome = $(if ($env:DSH_HOME) { $env:DSH_HOME } else { Join-Path $HOME '.dsh' }),
    [switch] $DryRun
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$MountMarker = '# dsh-control-center: managed mount'
$MountBlock = @(
    $MountMarker
    '- insert:'
    '    - id: control-center'
    "      name: 'dsh-control-center'"
) -join "`n"

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
    Remove the previously written mount block: the marker line plus the single
    top-level `- insert:` entry that follows it. A top-level entry ends at the
    next line that starts at column 0 with "- ", so the entry's indented
    children are consumed and the following user rows are left alone.
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

# ── resolve the package and the profile ─────────────────────────────────────

Write-Head 'dsh-control-center 安装'

$packageRoot = Split-Path -Parent $PSScriptRoot
$manifestPath = Join-Path $packageRoot 'package.json'
if (-not (Test-Path -LiteralPath $manifestPath)) {
    throw "找不到 package.json：$manifestPath（请从插件包内的 scripts 目录运行本脚本）"
}
$manifest = (Read-Utf8 $manifestPath) | ConvertFrom-Json
if ($manifest.name -ne 'dsh-control-center') {
    throw "包名不是 dsh-control-center，而是 $($manifest.name)"
}
Write-Step "插件包：$packageRoot  (v$($manifest.version))"

$profilesDir = Join-Path $DshHome 'profiles'
$profileDir = Join-Path $profilesDir $Profile
if (-not (Test-Path -LiteralPath $profileDir)) {
    $available = @()
    if (Test-Path -LiteralPath $profilesDir) {
        $available = Get-ChildItem -LiteralPath $profilesDir -Directory | Select-Object -ExpandProperty Name
    }
    throw "找不到 profile 目录：$profileDir`n可用 profile：$(if ($available.Count) { $available -join ', ' } else { '（无）' })"
}
$patchPath = Join-Path $profileDir 'cordis.patch.yml'
Write-Step "目标 profile：$profileDir"

# ── step 1: copy the package ────────────────────────────────────────────────

Write-Head '1/3  复制插件包'

$moduleDir = Join-Path $profileDir 'node_modules'
$target = Join-Path $moduleDir 'dsh-control-center'
$existed = Test-Path -LiteralPath $target

if ($DryRun) {
    Write-Step "[dry-run] 复制 $packageRoot -> $target"
} else {
    if (-not (Test-Path -LiteralPath $moduleDir)) { New-Item -ItemType Directory -Path $moduleDir -Force | Out-Null }
    if ($existed) { Remove-Item -LiteralPath $target -Recurse -Force }
    Copy-Item -LiteralPath $packageRoot -Destination $target -Recurse -Force
    $count = (Get-ChildItem -LiteralPath $target -Recurse -File | Measure-Object).Count
    Write-Step "$(if ($existed) { '已覆盖' } else { '已安装' }) $count 个文件 -> $target"
}

# ── step 2: back up the patch ───────────────────────────────────────────────

Write-Head '2/3  备份 profile patch'

$backupPath = "$patchPath.bak-dsh-control-center"
if ($DryRun) {
    Write-Step "[dry-run] 备份 $patchPath -> $backupPath（已存在则保留首次备份）"
} elseif (Test-Path -LiteralPath $patchPath) {
    if (Test-Path -LiteralPath $backupPath) {
        Write-Step "备份已存在，保留首次备份：$backupPath"
    } else {
        Copy-Item -LiteralPath $patchPath -Destination $backupPath -Force
        Write-Step "已备份 -> $backupPath"
    }
} else {
    Write-Step "patch 不存在，将新建：$patchPath"
}

# ── step 3: write the mount row ─────────────────────────────────────────────

Write-Head '3/3  写入挂载块'

$before = if (Test-Path -LiteralPath $patchPath) { Read-Utf8 $patchPath } else { "[]`n" }
$stripped = Remove-MountBlock $before
if ($stripped.Trim() -eq '' -or $stripped.Trim() -eq '[]') {
    $after = "$MountBlock`n"
} else {
    $after = "$($stripped.TrimEnd())`n`n$MountBlock`n"
}

if ($after -ceq $before) {
    Write-Step '挂载块已是最新，patch 未改动'
} elseif ($DryRun) {
    Write-Step '[dry-run] 将写入以下内容：'
    Write-Host ''
    Write-Host $MountBlock
    Write-Host ''
} else {
    Write-Utf8NoBom $patchPath $after
    Write-Step "已写入挂载块 -> $patchPath"
}

# ── done ────────────────────────────────────────────────────────────────────

Write-Head '完成'
if ($DryRun) {
    Write-Host '  dry-run：未写入任何文件。'
    exit 0
}
Write-Host @'
  dsh-hmr 会监听到 patch 变化并自动加载插件。
  接下来：

    1. 如果 DSH 正在运行，等待几秒让它热重载（或重启 DSH 桌面版）；
    2. 在浏览器里刷新页面（F5）；
    3. 打开侧边栏底部的「设置」，即可看到：
         MCP 管理 / Skill 管理 / 全局人设

  卸载：powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\uninstall.ps1
'@
