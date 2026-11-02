# Quick Commands Lite - install / restore script
# Usage: powershell -ExecutionPolicy Bypass -File install.ps1
# Copies this folder into Tabby's user plugin directory.
# Never overwrites an existing ai-settings.json (machine-local AI settings).

$ErrorActionPreference = 'Stop'
$src = $PSScriptRoot
$dst = Join-Path $env:APPDATA 'tabby\plugins\node_modules\tabby-quick-cmds-lite'

if (-not (Test-Path (Join-Path $src 'dist'))) {
    Write-Error "请在插件源码目录里运行（找不到 dist/）: $src"
}

New-Item -ItemType Directory -Force -Path $dst | Out-Null

# ai-settings.json 是机器本地的 AI 设置（可能含密钥），已存在就不覆盖
$aiSrc = Join-Path $src 'ai-settings.json'
$aiDst = Join-Path $dst 'ai-settings.json'
if ((Test-Path $aiSrc) -and -not (Test-Path $aiDst)) {
    Copy-Item $aiSrc $aiDst
}

foreach ($name in @('dist', 'package.json', 'README_CN.md', 'CHANGELOG.md', 'LICENSE', '安装说明.txt')) {
    Copy-Item -Recurse -Force (Join-Path $src $name) $dst
}

$node = Get-Command node -ErrorAction SilentlyContinue
if ($node) {
    node --check (Join-Path $dst 'dist\index.js')
    if ($LASTEXITCODE -eq 0) {
        Write-Host '语法检查通过'
    } else {
        Write-Warning '语法检查未通过，请先跑 npm test'
    }
} else {
    Write-Warning '未检测到 node，跳过语法检查'
}

$version = (Get-Content (Join-Path $dst 'package.json') -Raw | ConvertFrom-Json).version
Write-Host "已安装 tabby-quick-cmds-lite v$version 到 $dst"
Write-Host '重启 Tabby 后生效。'
