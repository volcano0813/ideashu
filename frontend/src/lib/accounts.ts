/** 去掉账号名中的 `*`（常见于误存的 Markdown 加粗标记），所有展示与持久化均应经此处理 */
export function stripAccountNameAsterisks(name: string): string {
  return (name ?? '').replace(/\*/g, '').trim()
}

export type Account = {
  id: string
  name: string
  domain: string
  persona: string
  /** 口头禅/常用句（用于生成语气和收束风格） */
  catchPhrases?: string[]
  /** 调性描述（温暖但不油腻...这种人话风格） */
  tone?: string
  styleName: string
  learnedRules: number
  trendSources: number
  /** 跨会话累计编辑条数（风格学习） */
  cumulativeEditCount: number
  /** 是否已触发过风格分析 */
  hasAnalyzedStyle: boolean
  /** 已完成风格分析轮数 */
  styleAnalysisCount: number
}

export const MOCK_ACCOUNTS: Account[] = [
  {
    id: 'a1',
    name: '每日一杯',
    domain: '咖啡/探店',
    persona: '温柔细节控',
    styleName: '暖光叙事',
    learnedRules: 8,
    trendSources: 3,
    cumulativeEditCount: 0,
    hasAnalyzedStyle: false,
    styleAnalysisCount: 0,
  },
  {
    id: 'a4',
    name: 'Elia的AI实践',
    domain: 'AI/科技/产品',
    persona: '技术实践派——用产品经理视角拆解 AI 技术，强调真实体验和可落地的方法论',
    catchPhrases: ['亲测有效', '从 0 到 1 的真实记录', '这个 prompt 我调了三天'],
    tone: '专业但不高冷，有技术深度但说人话',
    styleName: '实践笔记',
    learnedRules: 0,
    trendSources: 0,
    cumulativeEditCount: 0,
    hasAnalyzedStyle: false,
    styleAnalysisCount: 0,
  },
]

function newAccountId() {
  const cryptoObj = (globalThis as unknown as { crypto?: { randomUUID?: () => string } }).crypto
  if (cryptoObj?.randomUUID) return `a_${cryptoObj.randomUUID()}`
  return `a_${Date.now()}_${Math.random().toString(16).slice(2)}`
}

/** 用户新建的账号占位字段，可在账号管理页继续编辑 */
export function createNewAccount(name: string): Account {
  const trimmed = stripAccountNameAsterisks(name) || '新账号'
  return {
    id: newAccountId(),
    name: trimmed,
    domain: '未设置',
    persona: '未设置',
    styleName: '默认',
    learnedRules: 0,
    trendSources: 0,
    cumulativeEditCount: 0,
    hasAnalyzedStyle: false,
    styleAnalysisCount: 0,
  }
}

export function normalizeAccountFields(a: Account): Account {
  return {
    ...a,
    name: stripAccountNameAsterisks(a.name ?? '') || '账号',
    cumulativeEditCount: a.cumulativeEditCount ?? 0,
    hasAnalyzedStyle: a.hasAnalyzedStyle ?? false,
    styleAnalysisCount: a.styleAnalysisCount ?? 0,
  }
}
