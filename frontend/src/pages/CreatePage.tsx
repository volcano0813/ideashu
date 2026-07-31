import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { api, idempotencyKey, mutation } from '../api/client'
import type { CoverComposition, Workflow, WorkflowSnapshot } from '../api/contracts'
import { useActiveAccount } from '../contexts/ActiveAccountContext'
import { CoverPreview } from '../components/CoverPreview'

const stages = [
  ['collecting', '素材范围'], ['topic_ready', '选题确认'], ['topic_approved', '正文起草'],
  ['draft_review', '正文审查'], ['draft_approved', '封面制作'], ['covering', '封面确认'],
  ['cover_approved', '发布打包'], ['packaged', '已完成'],
] as const

const defaultComposition: CoverComposition = {
  title: '', subtitle: '', width: 1080, height: 1440, titleColor: '#fffaf0',
  accentColor: '#ff6b35', align: 'left', safeMargin: 96,
}

function WorkflowStepper({ state }: { state: Workflow['state'] }) {
  const current = stages.findIndex(([key]) => key === state)
  return <div className="workflow-stepper">{stages.map(([key, label], index) => <div className={index < current ? 'done' : index === current ? 'current' : ''} key={key}><span>{String(index + 1).padStart(2, '0')}</span><b>{label}</b></div>)}</div>
}

export default function CreatePage() {
  const { accountId: lockedAccountId, workflowId } = useParams()
  const { activeAccount, accounts } = useActiveAccount()
  const navigate = useNavigate()
  const [workflows, setWorkflows] = useState<Workflow[]>([])
  const [snapshot, setSnapshot] = useState<WorkflowSnapshot | null>(null)
  const [objective, setObjective] = useState('')
  const [topic, setTopic] = useState({ title: '', angle: '', rationale: '', sourceUrl: '' })
  const [draft, setDraft] = useState({ title: '', body: '', tags: '' })
  const [reviewNote, setReviewNote] = useState('事实与表达检查通过，允许进入人工定稿。')
  const [composition, setComposition] = useState<CoverComposition>(defaultComposition)
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  const lockedAccount = accounts.find((item) => item.id === lockedAccountId) || null

  const loadIndex = useCallback(async () => {
    if (!activeAccount) return setWorkflows([])
    setWorkflows(await api<Workflow[]>(`/accounts/${activeAccount.id}/workflows`))
  }, [activeAccount])
  const loadSnapshot = useCallback(async () => {
    if (!lockedAccountId || !workflowId) return
    const value = await api<WorkflowSnapshot>(`/accounts/${lockedAccountId}/workflows/${workflowId}`)
    setSnapshot(value)
    const latest = value.draft?.revisions.at(-1)
    if (latest) setDraft({ title: latest.title, body: latest.body, tags: latest.tags.join(', ') })
    if (latest?.title) setComposition((current) => current.title ? current : ({ ...current, title: latest.title.slice(0, 24) }))
  }, [lockedAccountId, workflowId])
  useEffect(() => { if (workflowId) void loadSnapshot(); else void loadIndex() }, [workflowId, loadIndex, loadSnapshot])

  const act = async (action: () => Promise<unknown>) => {
    setBusy(true); setMessage('')
    try { await action(); await loadSnapshot() }
    catch (error) { setMessage(error instanceof Error ? error.message : '操作失败') }
    finally { setBusy(false) }
  }
  const createRun = async () => {
    if (!activeAccount) return
    const run = await mutation<Workflow>(`/accounts/${activeAccount.id}/workflows`, 'POST', { objective, idempotencyKey: idempotencyKey() })
    navigate(`/create/${activeAccount.id}/${run.id}`)
  }
  const latestRevision = snapshot?.draft?.currentRevision || 0
  const latestReview = snapshot?.reviews.filter((item) => item.draftRevision === latestRevision).at(-1)
  const qaChecks = useMemo(() => {
    const checks = [
      { ok: composition.width * 4 === composition.height * 3, label: '画布比例为 3:4' },
      { ok: composition.title.trim().length > 0 && composition.title.length <= 40, label: '中文标题长度适合排版' },
      { ok: composition.safeMargin >= 64, label: '安全边距不小于 64px' },
    ]
    return checks
  }, [composition])

  if (!workflowId) return (
    <section>
      <div className="page-heading"><div><span className="eyebrow">DETERMINISTIC WORKFLOW</span><h1>智能体负责思考，<em>工作流负责不出错。</em></h1><p>{activeAccount ? `新任务将锁定到：${activeAccount.name}` : '创建账号后才能开始任务。'}</p></div></div>
      <div className="create-launcher"><span>NEW RUN</span><h2>这次想解决什么内容问题？</h2><textarea value={objective} onChange={(e) => setObjective(e.target.value)} placeholder="例如：基于近期真实实践，写一篇关于 AI 工作流的经验笔记。" /><button className="primary" onClick={() => void createRun()} disabled={!activeAccount || !objective.trim()}>创建账号锁定任务 →</button></div>
      <div className="run-list"><div className="section-label"><span>RECENT RUNS</span><b>{workflows.length}</b></div>{workflows.map((run) => <Link to={`/create/${run.accountId}/${run.id}`} key={run.id} className="run-row"><div><small>{run.state}</small><strong>{run.objective || '未命名创作任务'}</strong></div><time>{new Date(run.updatedAt).toLocaleString('zh-CN')}</time><span>R{run.version} →</span></Link>)}{activeAccount && !workflows.length && <div className="empty-state"><span>03</span><h2>还没有创作任务</h2><p>建立任务后，智能体、网页和版本历史会围绕同一个账号边界协作。</p></div>}</div>
    </section>
  )

  if (!snapshot) return <div className="empty-state"><h2>正在加载权威快照…</h2></div>
  const { workflow } = snapshot
  return (
    <section>
      <div className="run-header"><div><Link to="/create">← 所有任务</Link><span className="eyebrow">LOCKED WORKFLOW</span><h1>{workflow.objective || '未命名创作任务'}</h1></div><div className="locked-account"><small>任务锁定账号</small><strong>{lockedAccount?.name || workflow.accountId}</strong><span>切换顶部账号不会改变归属</span></div></div>
      <WorkflowStepper state={workflow.state} />
      {message && <div className="inline-message warning">{message}</div>}

      <div className="workflow-workbench">
        <div className="workbench-main">
          {workflow.state === 'collecting' && <div className="stage-panel"><span className="stage-number">01 / RESEARCH</span><h2>提交带来源的选题候选</h2><p>桌面智能体可以通过 <code>ideashu_topics_submit</code> 提交；这里也提供结构化手动入口。</p><label>选题标题<input value={topic.title} onChange={(e) => setTopic({ ...topic, title: e.target.value })} /></label><label>切入角度<textarea value={topic.angle} onChange={(e) => setTopic({ ...topic, angle: e.target.value })} /></label><label>为什么适合这个账号<textarea value={topic.rationale} onChange={(e) => setTopic({ ...topic, rationale: e.target.value })} /></label><label>证据链接<input value={topic.sourceUrl} onChange={(e) => setTopic({ ...topic, sourceUrl: e.target.value })} placeholder="https://…（可选）" /></label><button className="primary" disabled={busy || !topic.title.trim()} onClick={() => void act(() => mutation(`/accounts/${workflow.accountId}/workflows/${workflow.id}/topics`, 'POST', { expectedWorkflowVersion: workflow.version, idempotencyKey: idempotencyKey(), topics: [{ title: topic.title, angle: topic.angle, rationale: topic.rationale, evidence: topic.sourceUrl ? [{ title: '人工提供来源', url: topic.sourceUrl }] : [] }] }))}>提交候选</button></div>}

          {workflow.state === 'topic_ready' && <div className="stage-panel"><span className="stage-number">02 / HUMAN GATE</span><h2>选择一个方向</h2><p>智能体只能提出候选，不能替你批准。</p><div className="topic-list">{snapshot.topics.map((item) => <article key={item.id}><h3>{item.title}</h3><p>{item.angle || item.rationale || '暂无补充说明'}</p><div>{item.evidence.map((source, index) => source.url ? <a key={index} href={source.url} target="_blank" rel="noreferrer">来源 {index + 1} ↗</a> : null)}</div><button className="primary" onClick={() => void act(() => mutation(`/accounts/${workflow.accountId}/workflows/${workflow.id}/topic-approval`, 'POST', { topicId: item.id, expectedWorkflowVersion: workflow.version, idempotencyKey: idempotencyKey() }))}>批准这个选题</button></article>)}</div></div>}

          {['topic_approved', 'draft_review'].includes(workflow.state) && <div className="stage-panel"><span className="stage-number">03 / DRAFT</span><h2>{latestRevision ? `编辑正文 R${latestRevision + 1}` : '创建第一版正文'}</h2><p>每次保存都追加不可变版本；多标签页冲突会返回 409，不会静默覆盖。</p><label>标题<input value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} /></label><label>正文<textarea className="body-editor" value={draft.body} onChange={(e) => setDraft({ ...draft, body: e.target.value })} /></label><label>标签<input value={draft.tags} onChange={(e) => setDraft({ ...draft, tags: e.target.value })} /></label><button className="primary" disabled={busy || !draft.title.trim() || !draft.body.trim()} onClick={() => void act(() => mutation(`/accounts/${workflow.accountId}/workflows/${workflow.id}/draft-revisions`, 'POST', { title: draft.title, body: draft.body, tags: draft.tags.split(/[,，]/).map((x) => x.trim()).filter(Boolean), materialAnchors: [], changeSummary: latestRevision ? '网页人工修改' : '初稿', expectedWorkflowVersion: workflow.version, expectedDraftRevision: latestRevision, idempotencyKey: idempotencyKey() }))}>保存新版本</button>{workflow.state === 'draft_review' && latestRevision > 0 && <div className="review-box"><h3>结构化审查</h3><textarea value={reviewNote} onChange={(e) => setReviewNote(e.target.value)} /><button disabled={busy} onClick={() => void act(() => mutation(`/accounts/${workflow.accountId}/workflows/${workflow.id}/reviews`, 'POST', { draftRevision: latestRevision, decision: 'pass', scores: { clarity: 90, evidence: 85, accountFit: 90 }, requiredChanges: [], optionalSuggestions: [reviewNote], evidenceGaps: [], expectedWorkflowVersion: workflow.version, idempotencyKey: idempotencyKey() }))}>提交通过审查</button>{latestReview?.decision === 'pass' && <button className="primary" onClick={() => void act(() => mutation(`/accounts/${workflow.accountId}/workflows/${workflow.id}/draft-approval`, 'POST', { draftRevision: latestRevision, expectedWorkflowVersion: workflow.version, idempotencyKey: idempotencyKey() }))}>人工确认正文 R{latestRevision}</button>}</div>}</div>}

          {['draft_approved', 'covering'].includes(workflow.state) && <div className="stage-panel cover-stage"><div><span className="stage-number">04 / COVER</span><h2>背景与中文排版分离</h2><p>没有图片服务密钥时使用本地渐变背景；宿主 Skill 可导入真实无字背景。中文标题始终由可编辑 composition 渲染。</p><label>封面标题<input value={composition.title} onChange={(e) => setComposition({ ...composition, title: e.target.value })} /></label><label>副标题<input value={composition.subtitle} onChange={(e) => setComposition({ ...composition, subtitle: e.target.value })} /></label><div className="color-row"><label>强调色<input type="color" value={composition.accentColor} onChange={(e) => setComposition({ ...composition, accentColor: e.target.value })} /></label><label>对齐<select value={composition.align} onChange={(e) => setComposition({ ...composition, align: e.target.value as 'left' | 'center' })}><option value="left">左对齐</option><option value="center">居中</option></select></label></div><div className="qa-list">{qaChecks.map((check) => <div className={check.ok ? 'pass' : 'fail'} key={check.label}>{check.ok ? '✓' : '×'} {check.label}</div>)}</div><button className="primary" disabled={busy || qaChecks.some((item) => !item.ok)} onClick={() => void act(() => mutation(`/accounts/${workflow.accountId}/workflows/${workflow.id}/covers`, 'POST', { draftRevision: workflow.approvedDraftRevision, brief: { textInBackground: false, provider: 'local-gradient-or-host-agent', prompt: 'Generate a clean text-free editorial background' }, composition, qa: { passed: qaChecks.every((item) => item.ok), checks: qaChecks.map((item) => item.label), note: '确定性尺寸、文字长度与安全区检查' }, expectedWorkflowVersion: workflow.version, idempotencyKey: idempotencyKey() }))}>保存封面候选</button>{workflow.state === 'covering' && snapshot.covers.filter((cover) => cover.status === 'qa_passed').map((cover) => <button key={cover.id} onClick={() => void act(() => mutation(`/accounts/${workflow.accountId}/workflows/${workflow.id}/cover-approval`, 'POST', { coverId: cover.id, expectedWorkflowVersion: workflow.version, idempotencyKey: idempotencyKey() }))}>人工批准候选 {cover.id.slice(0, 6)}</button>)}</div><CoverPreview composition={composition} /></div>}

          {workflow.state === 'cover_approved' && <div className="stage-panel"><span className="stage-number">05 / PACKAGE</span><h2>生成不可变发布快照</h2><p>发布包会固定正文 R{workflow.approvedDraftRevision} 和已批准封面，之后不允许原地修改。</p><button className="primary" onClick={() => void act(() => mutation(`/accounts/${workflow.accountId}/workflows/${workflow.id}/package`, 'POST', { expectedWorkflowVersion: workflow.version, idempotencyKey: idempotencyKey() }))}>构建发布包</button></div>}
          {workflow.state === 'packaged' && <div className="stage-panel success-panel"><span>✓</span><h2>发布包已经封存</h2><p>正文、封面与账号范围已经成为不可变快照。</p><Link className="primary link-button" to="/works">在作品库查看 →</Link></div>}
        </div>
        <aside className="run-inspector"><div><small>WORKFLOW</small><code>{workflow.id}</code></div><div><small>ACCOUNT</small><code>{workflow.accountId}</code></div><div><small>VERSION</small><strong>R{workflow.version}</strong></div><div><small>DRAFT</small><strong>{latestRevision ? `R${latestRevision}` : '—'}</strong></div><div><small>STATE</small><strong>{workflow.state}</strong></div><p>页面展示来自 REST 权威快照；SSE 只负责提示刷新，不承担持久化。</p></aside>
      </div>
    </section>
  )
}
