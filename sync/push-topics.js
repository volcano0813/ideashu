const { syncTopics } = require('./sync-client.js');
const fs = require('fs');

const data = JSON.parse(fs.readFileSync('test-topics.json', 'utf8'));

syncTopics(data, 'default')
  .then(r => console.log('Success:', JSON.stringify(r, null, 2)))
  .catch(e => console.error('Error:', e.message));
