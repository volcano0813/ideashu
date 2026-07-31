$ErrorActionPreference = 'Stop'
$repo = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location -LiteralPath $repo
npm run doctor
if ($LASTEXITCODE -ne 0) { throw 'IdeaShu diagnostics failed' }
