# IdeaShu 仓库一键配置（Windows）
$ErrorActionPreference = "Stop"
$Root = if ($PSScriptRoot) { $PSScriptRoot } else { Split-Path -Parent $MyInvocation.MyCommand.Path }
Set-Location $Root

function Test-NodeVersion {
    $v = & node -v 2>$null
    if (-not $v) { throw "未检测到 Node.js，请先安装 https://nodejs.org/ （需要 >= 18）" }
    $major = [int]($v -replace '^v(\d+)\..*', '$1')
    if ($major -lt 18) { throw "Node.js 需要 >= 18，当前: $v" }
    Write-Host "[OK] Node $v"
}

function Test-PythonVersion {
    $py = Get-Command python -ErrorAction SilentlyContinue
    if (-not $py) {
        Write-Warning "未检测到 python，热点脚本需要 Python >= 3.10，请自行安装。"
        return
    }
    $ver = & python --version 2>&1
    Write-Host "[OK] $ver"
}

Write-Host "=== IdeaShu setup ===" 
Test-NodeVersion
Test-PythonVersion

Write-Host "`nInstalling frontend dependencies..."
Push-Location (Join-Path $Root "frontend")
npm install
Pop-Location

Write-Host "Installing sync dependencies..."
Push-Location (Join-Path $Root "sync")
npm install
Pop-Location

$envExample = Join-Path $Root ".env.example"
$envFile = Join-Path $Root ".env"
if (-not (Test-Path $envFile) -and (Test-Path $envExample)) {
    Copy-Item $envExample $envFile
    Write-Host "Created .env from .env.example — 请按需填写 SILICONFLOW_API_KEY 等。"
} elseif (Test-Path $envFile) {
    Write-Host ".env 已存在，跳过复制。"
}

$skillSrc = Join-Path $Root "skill"
$skillLink = Join-Path $env:USERPROFILE ".openclaw\workspace\skills\ideashu-v5"
$parentDir = Split-Path -Parent $skillLink
if (-not (Test-Path $parentDir)) {
    Write-Host "创建目录: $parentDir"
    New-Item -ItemType Directory -Path $parentDir -Force | Out-Null
}
if (Test-Path $skillLink) {
    Write-Host "已存在: $skillLink （跳过符号链接）"
} else {
    try {
        New-Item -ItemType SymbolicLink -Path $skillLink -Target $skillSrc -Force | Out-Null
        Write-Host "[OK] SymbolicLink: $skillLink -> $skillSrc"
    } catch {
        Write-Warning "符号链接失败（需管理员或开发者模式）: $($_.Exception.Message)"
        Write-Host "请手动复制或链接 skill 目录到: $skillLink"
    }
}

Write-Host "`n=== 完成 ==="
Write-Host "启动前端:  cd frontend`n           npm run dev"
Write-Host "启动同步:  node sync/server.js  （仓库根目录）"
Write-Host "可选: 在 .env 中配置 SILICONFLOW_API_KEY（封面生图）`n"
