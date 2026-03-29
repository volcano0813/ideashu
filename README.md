# IdeaShu 灵感书

小红书图文创作增强工具。AI 辅助你完成从热点发现、素材整理到内容打磨的全流程。

## 功能

- 多账号矩阵管理（每个账号独立的 brand-voice 风格配置）
- 热点抓取（多源聚合 → 选题卡片 → 一键写稿）
- 素材银行（图文素材存储 + 语义匹配）
- AI 草稿生成（风格学习飞轮 + 原创度声明）
- 封面生成（文生图 / 图生图）
- 飞书同步（可选）

## 前置要求

- Node.js >= 18
- Python >= 3.10
- [OpenClaw](https://openclaw.ai/)（按官方文档安装与配置）
- SiliconFlow API Key（可选，用于封面生成）

## 安装

### 方式一：PowerShell 一键配置

在仓库根目录执行：

```powershell
.\setup.ps1
```

脚本会检查 Node/Python、安装前端依赖、从 `.env.example` 生成 `.env`（若不存在），并尝试将 `skill` 目录符号链接到 `%USERPROFILE%\.openclaw\workspace\skills\ideashu-v5`。若符号链接失败（权限不足），请用**管理员**打开 PowerShell，或开启 Windows「开发者模式」，或**手动**将 `skill` 文件夹复制到上述路径。

### 方式二：手动安装

1. `git clone` 本仓库并进入根目录。
2. 安装前端依赖：`cd frontend && npm install`
3. 安装同步服务依赖：`cd ../sync && npm install`
4. 将本仓库的 `skill` 目录**复制或符号链接**到 OpenClaw workspace：`%USERPROFILE%\.openclaw\workspace\skills\ideashu-v5`
5. 复制 `.env.example` 为根目录 `.env`，按需填写 `SILICONFLOW_API_KEY`、`OPENCLAW_WORKSPACE`（把 `YOUR_USERNAME` 换成你的 Windows 用户名）等。  
   **说明**：请用 **UTF-8（无 BOM）** 保存 `.env`（VS Code 右下角编码可选）。若曾用错误编码保存，中文注释会乱码；模板现为英文注释，变量名不受影响。

## 使用

### 启动服务

- **前端开发**：`cd frontend && npm run dev`
- **同步服务（可选）**：在仓库根目录执行 `node sync/server.js`（需先 `cd sync && npm install`）
- 打开 OpenClaw，确认 **ideashu** Skill 已加载（`skills/ideashu-v5` 指向本仓库 `skill`）

### 基本流程

1. 新建账号 → 冷启动配置 brand-voice  
2. 找热点 → 选方向 → 生成草稿  
3. 编辑打磨 → 评分 → 封面生成  
4. 保存到作品集  

### 配置说明

- **`skill/config/config.json`**：`sync.clientPath` 默认为 `../sync/sync-client.js`（相对 **Skill 根目录**）。若仓库位置与 OpenClaw 安装不同，请改为本机上的绝对路径或正确相对路径。`serverUrl` 默认为 `http://localhost:3001`；若修改 `SYNC_PORT`，须同步修改此处与前端 [`frontend/src/hooks/useIdeashuSync.ts`](frontend/src/hooks/useIdeashuSync.ts) 中的默认地址（或保持端口 3001 不变）。
- **`OPENCLAW_WORKSPACE`**：同步服务启动时会在日志中打印（若已设置），便于排查路径问题。

## 项目结构

| 目录 | 说明 |
|------|------|
| `skill/` | OpenClaw Skill（`SKILL.md`、Python 脚本、`config/config.json`）；用户需链接或复制到 workspace |
| `frontend/` | React + Vite 前端 |
| `sync/` | Node.js WebSocket/HTTP 同步服务，连接飞书侧与本地前端 |

## 技术栈

- 前端：React + TypeScript + Tailwind CSS + Vite
- Skill：OpenClaw `SKILL.md` + Python 脚本
- 同步：Node.js WebSocket 服务
- 封面：SiliconFlow API（Kolors 模型）

## License

MIT — 见 [LICENSE](LICENSE)。
