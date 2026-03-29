# 后台启动脚本
$process = Start-Process -FilePath "node" -ArgumentList "server.js" -WorkingDirectory $PSScriptRoot -PassThru -WindowStyle Hidden
Write-Host "Server started with PID: $($process.Id)"
Write-Host "HTTP: http://localhost:3001"
Write-Host "WebSocket: ws://localhost:3001"
