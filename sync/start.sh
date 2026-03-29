#!/bin/bash

# IdeaShu Sync 一键启动脚本

echo "🚀 启动 IdeaShu Sync 服务..."

cd "$(dirname "$0")"

# 检查 node_modules
if [ ! -d "node_modules" ]; then
    echo "📦 安装依赖..."
    npm install
fi

echo "📝 服务将运行在:"
echo "   HTTP:  http://localhost:3001"
echo "   WS:    ws://localhost:3001"
echo ""

npm start
