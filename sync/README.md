# IdeaShu Sync - 飞书-前端实时同步服务

让飞书里的 ideashu-v5 对话内容实时同步到前端网页。

## 架构

```
飞书对话 → OpenClaw → ideashu-v5 Skill
                    ↓
            调用 sync-client.js
                    ↓
            POST /api/sync
                    ↓
            SQLite + WebSocket
                    ↓
            前端 React (useIdeashuSync)
```

## 快速开始

### 1. 启动同步服务器

```bash
cd ~/.openclaw/workspace/ideashu-sync
npm install
npm start
```

服务运行在 `http://localhost:3001`

### 2. 前端集成

把 `useIdeashuSync.ts` 复制到你的前端项目:

```bash
cp useIdeashuSync.ts ~/your-frontend/src/hooks/
```

使用:

```tsx
import { useIdeashuSync } from './hooks/useIdeashuSync';

function Workspace() {
  const { 
    drafts, 
    latestDraft, 
    isConnected,
    topics 
  } = useIdeashuSync({
    userId: 'user-123',
    onDraftUpdate: (draft) => {
      console.log('收到新草稿:', draft);
    }
  });

  return (
    <div>
      <div>连接状态: {isConnected ? '🟢' : '🔴'}</div>
      
      {latestDraft && (
        <div className="latest-draft">
          <h2>{latestDraft.title}</h2>
          <p>{latestDraft.body}</p>
          <div>{latestDraft.tags.map(t => `#${t}`).join(' ')}</div>
        </div>
      )}
      
      <div className="draft-list">
        {drafts.map(draft => (
          <DraftCard key={draft.id} draft={draft} />
        ))}
      </div>
    </div>
  );
}
```

### 3. 修改 ideashu-v5 Skill

在 ideashu-v5 SKILL.md 中，找到输出 json:draft 的地方，添加同步调用:

```markdown
然后在回复末尾追加：

```json:draft
{
  "title": "...",
  "body": "...",
  ...
}
```

<!-- 新增：同步到前端 -->
然后调用同步脚本（由系统自动执行）：
```bash
node ~/.openclaw/workspace/ideashu-sync/sync-client.js \
  --type draft \
  --data '{"title":"...","body":"...","tags":["..."]}' \
  --userId {{userId}}
```
```

或者更推荐的方式：在 OpenClaw 的消息处理层统一拦截 json:draft 代码块并推送。

## API 文档

### HTTP API

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/health` | 健康检查 |
| GET | `/api/drafts` | 获取用户草稿列表 |
| GET | `/api/drafts/:id` | 获取单条草稿 |
| GET | `/api/drafts/latest` | 获取最新草稿 |
| POST | `/api/sync` | 接收同步数据 |

### POST /api/sync

请求体:
```json
{
  "type": "draft",      // draft | topics | score
  "userId": "default",
  "sessionId": "...",
  "data": { ... }
}
```

### WebSocket

连接: `ws://localhost:3001?userId=xxx`

消息类型:
- `draft_updated` - 新草稿
- `topics_updated` - 新选题
- `score_updated` - 评分更新
- `connected` - 连接确认

## 数据表结构

### drafts
- id, user_id, session_id
- title, body, tags, cover
- status, platform
- created_at, updated_at

### topics
- id, user_id, session_id
- topics (JSON)
- created_at

### scores
- id, user_id, draft_id
- score_data, originality (JSON)
- created_at

## 商业化扩展

当前架构支持未来多人使用:

1. **用户隔离**: user_id 字段已预留
2. **权限控制**: 可在 API 层添加 JWT 验证
3. **数据库迁移**: SQLite → PostgreSQL 只需改连接字符串
4. **水平扩展**: WebSocket 可用 Redis Pub/Sub 支持多实例

## 故障排查

### 服务启动失败
```bash
# 检查端口占用
lsof -i :3001

# 删除数据库重新初始化
rm ideashu.db
npm start
```

### 前端收不到更新
1. 检查 WebSocket 连接: 浏览器 DevTools → Network → WS
2. 检查 userId 是否一致
3. 查看服务器日志是否有 `Broadcast to user xxx`

### 飞书内容未同步
1. 检查 sync-client.js 是否被正确调用
2. 手动测试: `node sync-client.js --type draft --data '{"title":"test"}'`
3. 查看服务器日志
