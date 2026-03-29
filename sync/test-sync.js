const { syncDraft } = require('./sync-client.js');

async function test() {
  try {
    const result = await syncDraft({
      title: '测试同步',
      body: '这是一条测试内容',
      tags: ['测试', '同步'],
      status: 'draft'
    }, 'default');
    
    console.log('Success:', result);
  } catch (err) {
    console.error('Error:', err.message);
  }
}

test();
