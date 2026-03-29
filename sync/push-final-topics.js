const { syncTopics } = require('./sync-client.js');

// 简化抓取结果：小红书 + 百度热搜
const topics = {
  topics: [
    // 小红书热门笔记
    {
      id: 1,
      title: "陌生人化妆挑战：被化成辣妹是什么体验",
      source: "小红书",
      sourceUrl: "https://www.xiaohongshu.com/explore/64c8999200000000100309d8",
      angle: "素人改造/美妆反差/社恐挑战",
      hook: "圈定人群 + 反差",
      heatScore: 88,
      timing: "hot",
      timingDetail: "热门笔记，社恐+美妆话题",
      materialMatch: false,
      materialCount: 0
    },
    {
      id: 2,
      title: "小学生对成绩的执着有多真实",
      source: "小红书",
      sourceUrl: "https://www.xiaohongshu.com/explore/646c922c000000001301754b",
      angle: "童年回忆/教育观察/搞笑",
      hook: "怀旧 + 奇葩",
      heatScore: 82,
      timing: "hot",
      timingDetail: "情感共鸣话题，引发讨论",
      materialMatch: false,
      materialCount: 0
    },
    {
      id: 3,
      title: "菱形脸腮红画法：流畅显幼态秘诀",
      source: "小红书",
      sourceUrl: "https://www.xiaohongshu.com/explore/6436909800000000130322be",
      angle: "美妆教程/脸型修饰/技巧",
      hook: "直接提问 + 反常识",
      heatScore: 85,
      timing: "evergreen",
      timingDetail: "实用教程，长期有效",
      materialMatch: false,
      materialCount: 0
    },
    // 百度热搜（筛选与生活方式相关的）
    {
      id: 4,
      title: "游客因拍照设备太专业被景区驱赶",
      source: "百度热搜",
      sourceUrl: "https://top.baidu.com/board",
      angle: "旅游体验/摄影/消费者权益",
      hook: "场景代入 + 冲突",
      heatScore: 75,
      timing: "hot",
      timingDetail: "社会话题，引发讨论",
      materialMatch: false,
      materialCount: 0
    },
    {
      id: 5,
      title: "父亲背着千金拖着犬子过斑马线",
      source: "百度热搜",
      sourceUrl: "https://top.baidu.com/board",
      angle: "亲情/生活方式/温馨瞬间",
      hook: "情感共鸣",
      heatScore: 70,
      timing: "hot",
      timingDetail: "情感类热点",
      materialMatch: false,
      materialCount: 0
    }
  ]
};

syncTopics(topics, 'default')
  .then(r => console.log('✅ 推送成功:', JSON.stringify(r, null, 2)))
  .catch(e => console.error('❌ 推送失败:', e.message));
