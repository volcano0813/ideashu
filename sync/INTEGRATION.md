# IdeaShu Sync 整合指南

## 目标
让飞书中的 ideashu-v5 对话内容实时同步到前端 http://127.0.0.1:5173/workspace

## 方案对比

| 方案 | 复杂度 | 实时性 | 推荐度 |
|------|--------|--------|--------|
| A. 文件共享 | 低 | 慢(轮询) | ⭐⭐ |
| B. HTTP API | 中 | 快 | ⭐⭐⭐ |
| **C. WebSocket** | 中 | **实时** | ⭐⭐⭐⭐⭐ |

**当前实现**: 方案 C (WebSocket + SQLite)

---

## 架构图

```
┌─────────────┐      ┌──────────────┐      ┌─────────────────┐
│   飞书用户   │──────▶│  OpenClaw    │──────▶│ ideashu-v5 Skill│
└─────────────┘      └──────────────┘      └─────────────────┘
                                                     │
                                                     │ 生成 json:draft
                                                     ▼
                                           ┌─────────────────┐
                                           │  sync-client.js │
                                           └─────────────────┘
                                                     │
                                                     │ POST /api/sync
                                                     ▼
                                           ┌─────────────────┐
                                           │  Sync Server    │
                                           │  :3001          │
                                           │  SQLite + WS    │
                                           └─────────────────┘
                                                     │
                                                     │ WebSocket 推送
                                                     ▼
                                           ┌─────────────────┐
                                           │  React Frontend │
                                           │  :5173          │
                                           │  useIdeashuSync │
                                           └─────────────────┘
```

---

## 实施步骤

### 步骤 1: 启动同步服务

```bash
cd C:\Users\volcano\.openclaw\workspace\ideashu-sync
npm install
npm start

# 或者用一键脚本
call start.bat
```

确认服务运行:
- HTTP: http://localhost:3001/api/health
- WebSocket: ws://localhost:3001

---

### 步骤 2: 前端集成

**1. 复制 Hook 到前端项目**

```bash
cp C:\Users\volcano\.openclaw\workspace\ideashu-sync\useIdeashuSync.ts \
   D:\your-frontend\src\hooks\
```

**2. 在工作区组件中使用**

```tsx
// src/pages/Workspace.tsx
import { useIdeashuSync } from '../hooks/useIdeashuSync';

export function Workspace() {
  const { 
    drafts,           // 所有草稿列表
    latestDraft,      // 最新草稿
    topics,           // 选题列表
    isConnected,      // WebSocket 连接状态
    isLoading,        // 加载状态
    error             // 错误信息
  } = useIdeashuSync({
    userId: 'default',  // 当前用户ID
    serverUrl: 'http://localhost:3001',
    wsUrl: 'ws://localhost:3001',
    
    // 回调函数
    onDraftUpdate: (draft) => {
      // 收到新草稿时的处理
      console.log('新草稿:', draft.title);
      // 可以显示通知、自动打开编辑器等
    },
    
    onTopicsUpdate: (topics) => {
      // 收到新选题时的处理
      console.log('收到选题:', topics.length);
    }
  });

  return (
    <div className="workspace">
      {/* 连接状态指示器 */}
      <div className="connection-status">
        {isConnected ? '🟢 已连接' : '🔴 未连接'}
      </div>

      {/* 最新草稿 */}
      {latestDraft && (
        <div className="latest-draft">
          <h2>最新生成</h2>
          <h3>{latestDraft.title}</h3>
          <pre>{latestDraft.body}</pre>
          <div className="tags">
            {latestDraft.tags?.map(t => `#${t} `)}
          </div>
        </div>
      )}

      {/* 草稿列表 */}
      <div className="draft-list">
        <h2>历史草稿 ({drafts.length})</h2>
        {drafts.map(draft => (
          <DraftCard key={draft.id} draft={draft} />
        ))}
      </div>
    </div>
  );
}
```

**3. 确保前端能跨域访问**

如果前端是 Vite，在 `vite.config.ts` 中添加:

```ts
export default defineConfig({
  server: {
    proxy: {
      '/api': {
        target: 'http://localhost:3001',
        changeOrigin: true
      }
    }
  }
});
```

---

### 步骤 3: Skill 集成 (关键)

需要在 ideashu-v5 生成内容时，同时推送到同步服务。

#### 方案 A: 修改 SKILL.md (推荐)

在 `C:\Users\volcano\.openclaw\workspace\skills\ideashu-v5\SKILL.md` 中，
找到输出 `json:draft` 的部分，添加同步调用:

```markdown
然后在回复末尾追加机器可读 JSON 块：

```json:draft
{
  "title": "完整标题",
  "body": "完整正文（保留换行符\\n）",
  "tags": ["标签1", "标签2", "标签3"],
  "cover": {
    "type": "photo|text|collage|compare|list",
    "description": "封面画面描述",
    "overlayText": "封面大字7字以内"
  },
  "status": "draft",
  "mode": "write|polish",
  "structureType": "结构类型"
}
```

```json:originality
{
  "userMaterialPct": 65,
  "aiAssistPct": 35,
  "compliance": "safe|caution|risk",
  "materialSources": ["来源1"]
}
```

<!-- 同步到前端 -->
然后调用同步脚本：
```bash
node C:\Users\volcano\.openclaw\workspace\ideashu-sync\sync-client.js --type draft --data '{"title":"完整标题","body":"完整正文","tags":["标签1"],"status":"draft"}' --userId default
```
```

#### 方案 B: OpenClaw 拦截层 (更干净)

如果不想修改 Skill，可以在 OpenClaw 处理消息回复时，
自动解析 `json:draft` 代码块并推送。

这需要修改 OpenClaw 的核心代码，不在本文档范围。

---

### 步骤 4: 测试完整流程

**1. 启动所有服务**

```bash
# 终端 1: 同步服务
cd C:\Users\volcano\.openclaw\workspace\ideashu-sync
npm start

# 终端 2: 前端
cd D:\your-frontend
npm run dev
```

**2. 在飞书中测试**

发送消息触发 ideashu-v5:
```
@机器人 帮我写个小红书笔记，主题是咖啡探店
```

**3. 观察同步**

- 飞书应该正常返回内容
- 查看同步服务日志，确认收到 POST /api/sync
- 前端应该实时显示新内容

---

## 多用户支持 (未来商业化)

当前架构已为多用户预留:

### 用户识别

飞书消息中包含 `sender_id`，可以用作用户ID:

```json
{
  "sender_id": "ou_49c48aac019f24bc5501e25995a47082"
}
```

### 数据隔离

数据库表都有 `user_id` 字段，自动隔离不同用户数据。

### 权限控制

添加 JWT 验证:

```ts
// server.js 中添加
const jwt = require('jsonwebtoken');

app.use('/api', (req, res, next) => {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'Unauthorized' });
  
  try {
    req.user = jwt.verify(token, process.env.JWT_SECRET);
    next();
  } catch {
    res.status(403).json({ error: 'Invalid token' });
  }
});
```

---

## 故障排查

### 问题 1: 前端收不到更新

检查清单:
- [ ] 同步服务已启动 (`http://localhost:3001/api/health`)
- [ ] 前端 WebSocket 已连接 (浏览器 DevTools → Network → WS)
- [ ] userId 前后端一致
- [ ] 查看同步服务日志是否有广播消息

### 问题 2: 飞书内容未同步

检查清单:
- [ ] sync-client.js 被正确调用
- [ ] 手动测试: `node sync-client.js --type draft --data '{"title":"test"}'`
- [ ] 查看同步服务日志是否收到 POST 请求

### 问题 3: 数据库锁定

SQLite 不支持高并发写入，如果报错:
```
SQLITE_BUSY: database is locked
```

解决:
1. 重启服务
2. 或迁移到 PostgreSQL

---

## 文件清单

```
ideashu-sync/
├── package.json          # 依赖配置
├── server.js             # HTTP + WebSocket 服务器
├── database.js           # SQLite 数据库操作
├── sync-client.js        # Skill 推送客户端
├── useIdeashuSync.ts     # React Hook (前端用)
├── README.md             # 本文档
├── start.bat             # Windows 启动脚本
└── start.sh              # Mac/Linux 启动脚本
```

---

## 下一步

1. ✅ 启动同步服务
2. ✅ 集成前端 Hook
3. ✅ 修改 ideashu-v5 添加同步调用
4. ✅ 测试完整流程
5. 🔄 根据反馈优化
