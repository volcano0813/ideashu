@echo off
chcp 65001 > nul

:: IdeaShu Sync 一键启动脚本 (Windows)

echo 🚀 启动 IdeaShu Sync 服务...

cd /d "%~dp0"

:: 检查 node_modules
if not exist "node_modules" (
    echo 📦 安装依赖...
    call npm install
)

echo.
echo 📝 服务将运行在:
echo    HTTP:  http://localhost:3001
echo    WS:    ws://localhost:3001
echo.

npm start
