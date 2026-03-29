/**
 * 内存数据库 + 可选 JSON 持久化
 * 简化版，无需编译原生模块
 */

const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

/** 可选：自定义持久化文件路径；默认 sync/data.json */
const DATA_FILE = process.env.IDEASHU_SYNC_DATA_FILE
  ? path.resolve(process.env.IDEASHU_SYNC_DATA_FILE)
  : path.join(__dirname, 'data.json');

// 内存数据存储
let data = {
  drafts: [],
  topics: [],
  scores: []
};

// 加载持久化数据
function loadData() {
  try {
    if (fs.existsSync(DATA_FILE)) {
      const raw = fs.readFileSync(DATA_FILE, 'utf8');
      data = JSON.parse(raw);
      console.log('[DB] Loaded', data.drafts.length, 'drafts from disk');
    }
  } catch (err) {
    console.error('[DB] Failed to load data:', err.message);
  }
}

// 保存到磁盘
function saveData() {
  try {
    fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
  } catch (err) {
    console.error('[DB] Failed to save data:', err.message);
  }
}

// 初始化
loadData();

// 每 30 秒自动保存
setInterval(saveData, 30000);

module.exports = {
  // 保存草稿
  saveDraft(draftData) {
    const id = draftData.id || uuidv4();
    const now = new Date().toISOString();
    
    const existingIndex = data.drafts.findIndex(d => d.id === id);
    const draft = {
      id,
      user_id: draftData.user_id || 'default',
      session_id: draftData.session_id || null,
      title: draftData.title || '',
      body: draftData.body || '',
      tags: JSON.stringify(draftData.tags || []),
      cover: draftData.cover ? JSON.stringify(draftData.cover) : null,
      status: draftData.status || 'draft',
      platform: draftData.platform || 'xiaohongshu',
      created_at: existingIndex >= 0 ? data.drafts[existingIndex].created_at : now,
      updated_at: now
    };
    
    if (existingIndex >= 0) {
      data.drafts[existingIndex] = draft;
    } else {
      data.drafts.unshift(draft);
    }
    
    // 限制草稿数量，保留最近 100 条
    if (data.drafts.length > 100) {
      data.drafts = data.drafts.slice(0, 100);
    }
    
    saveData();
    return id;
  },

  // 保存选题
  saveTopics(topicsData) {
    const id = topicsData.id || uuidv4();
    
    const topic = {
      id,
      user_id: topicsData.user_id || 'default',
      session_id: topicsData.session_id || null,
      topics: JSON.stringify(topicsData.topics || []),
      created_at: new Date().toISOString()
    };
    
    const existingIndex = data.topics.findIndex(t => t.id === id);
    if (existingIndex >= 0) {
      data.topics[existingIndex] = topic;
    } else {
      data.topics.unshift(topic);
    }
    
    saveData();
    return id;
  },

  // 保存评分
  saveScore(scoreData) {
    const id = uuidv4();
    
    const score = {
      id,
      user_id: scoreData.user_id || 'default',
      draft_id: scoreData.draft_id,
      score_data: JSON.stringify(scoreData.score_data || {}),
      originality: JSON.stringify(scoreData.originality || {}),
      created_at: new Date().toISOString()
    };
    
    data.scores.push(score);
    saveData();
    return id;
  },

  // 获取用户的草稿列表
  getUserDrafts(userId = 'default', limit = 50) {
    return data.drafts
      .filter(d => d.user_id === userId)
      .slice(0, limit)
      .map(row => ({
        ...row,
        tags: JSON.parse(row.tags || '[]'),
        cover: row.cover ? JSON.parse(row.cover) : null
      }));
  },

  // 获取单条草稿
  getDraft(id) {
    const row = data.drafts.find(d => d.id === id);
    if (!row) return null;
    return {
      ...row,
      tags: JSON.parse(row.tags || '[]'),
      cover: row.cover ? JSON.parse(row.cover) : null
    };
  },

  // 获取最新草稿
  getLatestDraft(userId = 'default') {
    const row = data.drafts.find(d => d.user_id === userId);
    if (!row) return null;
    return {
      ...row,
      tags: JSON.parse(row.tags || '[]'),
      cover: row.cover ? JSON.parse(row.cover) : null
    };
  },

  // 获取原始数据（用于调试）
  getRawData() {
    return data;
  }
};
