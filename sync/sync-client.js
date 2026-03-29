/**
 * IdeaShu Sync Client
 * 
 * 用于 ideashu-v5 skill 推送数据到同步服务器
 * 用法: node sync-client.js --type draft --data '{...}' --userId xxx
 */

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const http = require('http');

const port = process.env.SYNC_PORT || process.env.PORT || '3001';
const DEFAULT_SERVER =
  process.env.SYNC_SERVER_URL || `http://localhost:${port}`;

function postData(path, data) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, DEFAULT_SERVER);
    const postData = JSON.stringify(data);
    
    const options = {
      hostname: url.hostname,
      port: url.port,
      path: url.pathname,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(postData)
      }
    };
    
    const req = http.request(options, (res) => {
      let responseData = '';
      res.on('data', (chunk) => responseData += chunk);
      res.on('end', () => {
        try {
          const parsed = JSON.parse(responseData);
          resolve(parsed);
        } catch {
          resolve({ success: true, raw: responseData });
        }
      });
    });
    
    req.on('error', reject);
    req.write(postData);
    req.end();
  });
}

async function syncDraft(data, userId = 'default', sessionId = null) {
  return postData('/api/sync', {
    type: 'draft',
    userId,
    sessionId,
    data
  });
}

async function syncTopics(topics, userId = 'default', sessionId = null) {
  return postData('/api/sync', {
    type: 'topics',
    userId,
    sessionId,
    data: { topics }
  });
}

async function syncScore(scoreData, originality, draftId, userId = 'default') {
  return postData('/api/sync', {
    type: 'score',
    userId,
    data: {
      draft_id: draftId,
      score_data: scoreData,
      originality
    }
  });
}

// CLI 入口
async function main() {
  const args = process.argv.slice(2);
  const getArg = (flag) => {
    const index = args.indexOf(flag);
    return index > -1 ? args[index + 1] : null;
  };
  
  const type = getArg('--type');
  const dataStr = getArg('--data');
  const userId = getArg('--userId') || 'default';
  const sessionId = getArg('--sessionId');
  
  if (!type || !dataStr) {
    console.log(`
Usage: node sync-client.js --type <type> --data '<json>' [options]

Options:
  --type       draft | topics | score
  --data       JSON string of data to sync
  --userId     User ID (default: default)
  --sessionId  Session ID

Examples:
  node sync-client.js --type draft --data '{"title":"测试","body":"内容"}'
  node sync-client.js --type topics --data '{"topics":[]}' --userId user-123
    `);
    process.exit(1);
  }
  
  try {
    const data = JSON.parse(dataStr);
    let result;
    
    switch (type) {
      case 'draft':
        result = await syncDraft(data, userId, sessionId);
        break;
      case 'topics':
        result = await syncTopics(data.topics || data, userId, sessionId);
        break;
      case 'score':
        result = await syncScore(data.score, data.originality, data.draft_id, userId);
        break;
      default:
        console.error(`Unknown type: ${type}`);
        process.exit(1);
    }
    
    console.log(JSON.stringify(result, null, 2));
  } catch (err) {
    console.error('Error:', err.message);
    process.exit(1);
  }
}

// 导出 API 供其他脚本使用
module.exports = {
  syncDraft,
  syncTopics,
  syncScore,
  postData
};

// 如果是直接运行
if (require.main === module) {
  main();
}
