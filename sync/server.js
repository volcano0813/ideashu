const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const express = require('express');
const cors = require('cors');
const WebSocket = require('ws');
const http = require('http');
const { v4: uuidv4 } = require('uuid');
const database = require('./database');

const OPENCLAW_WORKSPACE = process.env.OPENCLAW_WORKSPACE
  ? path.resolve(process.env.OPENCLAW_WORKSPACE)
  : null;

async function notifyFeishuIfConfigured(summary) {
  const url = process.env.FEISHU_WEBHOOK_URL;
  if (!url || !summary) return;
  try {
    await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        msg_type: 'text',
        content: { text: String(summary).slice(0, 4000) },
      }),
    });
  } catch (e) {
    console.warn('[Sync] Feishu webhook skipped:', e.message);
  }
}

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

// 存储用户连接 { userId: WebSocket }
const clients = new Map();

app.use(cors());
app.use(express.json({ limit: '10mb' }));

// ===== HTTP API =====

// 健康检查
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// 获取用户所有草稿
app.get('/api/drafts', (req, res) => {
  const userId = req.query.userId || 'default';
  const drafts = database.getUserDrafts(userId, 50);
  res.json({ success: true, data: drafts });
});

// 获取单条草稿
app.get('/api/drafts/:id', (req, res) => {
  const draft = database.getDraft(req.params.id);
  if (!draft) {
    return res.status(404).json({ success: false, error: 'Draft not found' });
  }
  res.json({ success: true, data: draft });
});

// 获取最新草稿
app.get('/api/drafts/latest', (req, res) => {
  const userId = req.query.userId || 'default';
  const draft = database.getLatestDraft(userId);
  if (!draft) {
    return res.status(404).json({ success: false, error: 'No drafts found' });
  }
  res.json({ success: true, data: draft });
});

// 接收来自 Skill 的数据推送 (内部 API)
app.post('/api/sync', (req, res) => {
  const { type, userId, sessionId, data } = req.body;
  
  console.log(`[Sync] Received ${type} from user ${userId}`);
  
  let result;
  let payload = {};
  
  switch (type) {
    case 'draft':
      result = database.saveDraft({
        ...data,
        user_id: userId,
        session_id: sessionId
      });
      payload = { type: 'draft_updated', draftId: result, data };
      break;
      
    case 'topics':
      result = database.saveTopics({
        ...data,
        user_id: userId,
        session_id: sessionId
      });
      payload = { type: 'topics_updated', topicsId: result, data };
      break;
      
    case 'score':
      result = database.saveScore({
        ...data,
        user_id: userId
      });
      payload = { type: 'score_updated', scoreId: result, data };
      break;
      
    default:
      return res.status(400).json({ success: false, error: 'Unknown type' });
  }
  
  // WebSocket 推送给该用户的所有连接
  broadcastToUser(userId, payload);

  void notifyFeishuIfConfigured(`IdeaShu 同步: ${type} · user=${userId}`);
  
  res.json({ 
    success: true, 
    id: result,
    message: `Synced ${type} to user ${userId}`
  });
});

// ===== WebSocket =====

wss.on('connection', (ws, req) => {
  console.log(`[WS] Raw connection from: ${req.socket.remoteAddress}, URL: ${req.url}`);
  
  const userId = new URL(req.url, 'http://localhost').searchParams.get('userId') || 'default';
  
  console.log(`[WS] Client connected: ${userId}`);
  
  // 存储连接
  if (!clients.has(userId)) {
    clients.set(userId, new Set());
  }
  clients.get(userId).add(ws);
  
  // 发送欢迎消息
  ws.send(JSON.stringify({
    type: 'connected',
    userId,
    timestamp: new Date().toISOString()
  }));
  
  // 心跳
  const pingInterval = setInterval(() => {
    if (ws.readyState === WebSocket.OPEN) {
      ws.ping();
    }
  }, 30000);
  
  ws.on('message', (message) => {
    try {
      const data = JSON.parse(message);
      console.log(`[WS] Message from ${userId}:`, data.type);
      
      // 处理客户端消息
      if (data.type === 'ping') {
        ws.send(JSON.stringify({ type: 'pong', timestamp: Date.now() }));
      }
    } catch (err) {
      console.error('[WS] Invalid message:', err.message);
    }
  });
  
  ws.on('close', () => {
    console.log(`[WS] Client disconnected: ${userId}`);
    clearInterval(pingInterval);
    const userClients = clients.get(userId);
    if (userClients) {
      userClients.delete(ws);
      if (userClients.size === 0) {
        clients.delete(userId);
      }
    }
  });
  
  ws.on('error', (err) => {
    console.error(`[WS] Error for ${userId}:`, err.message);
  });
});

// 广播给指定用户的所有连接
function broadcastToUser(userId, payload) {
  const userClients = clients.get(userId);
  if (!userClients) return;
  
  const message = JSON.stringify(payload);
  userClients.forEach(ws => {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(message);
    }
  });
  
  console.log(`[WS] Broadcast to ${userId}: ${payload.type} (${userClients.size} clients)`);
}

// 启动服务器（SYNC_PORT 优先，兼容 PORT）
const PORT = Number(process.env.SYNC_PORT || process.env.PORT || 3001);
server.listen(PORT, () => {
  console.log(`🚀 IdeaShu Sync Server running on http://localhost:${PORT}`);
  console.log(`📡 WebSocket endpoint: ws://localhost:${PORT}`);
  if (OPENCLAW_WORKSPACE) {
    console.log(`📁 OPENCLAW_WORKSPACE=${OPENCLAW_WORKSPACE}`);
  }
});

module.exports = { app, server, wss };
