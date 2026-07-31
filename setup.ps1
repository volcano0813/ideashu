$ErrorActionPreference = 'Stop'

$repo = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location -LiteralPath $repo

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  throw 'Node.js is required. Install Node 22.13 or newer in the Node 22 release line.'
}
$nodeVersion = node -p "process.versions.node"

Write-Host "Installing locked dependencies with npm ci..."
$npmCache = Join-Path $repo '.ideashu\npm-cache'
New-Item -ItemType Directory -Path $npmCache -Force | Out-Null
npm ci --cache $npmCache --no-audit --no-fund
if ($LASTEXITCODE -ne 0) { throw 'npm ci failed' }

Write-Host "Building IdeaShu..."
npm run build
if ($LASTEXITCODE -ne 0) { throw 'IdeaShu build failed' }

Write-Host "Initializing local runtime..."
npm run bootstrap
if ($LASTEXITCODE -ne 0) { throw 'IdeaShu bootstrap failed' }

Write-Host "Running diagnostics..."
npm run doctor
if ($LASTEXITCODE -ne 0) { throw 'IdeaShu diagnostics failed' }

Write-Host "Ready. Run: npm start"
