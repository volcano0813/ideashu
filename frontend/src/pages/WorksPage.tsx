import { useEffect, useState } from 'react'
import { api } from '../api/client'
import type { Work } from '../api/contracts'
import { useActiveAccount } from '../contexts/ActiveAccountContext'

export default function WorksPage() {
  const { activeAccount } = useActiveAccount()
  const [works, setWorks] = useState<Work[]>([])
  const [selected, setSelected] = useState<Work | null>(null)
  const [error, setError] = useState('')
  useEffect(() => {
    const accountId = activeAccount?.id
    if (!accountId) return
    let current = true
    api<Work[]>(`/accounts/${accountId}/works`)
      .then((items) => { if (current) { setWorks(items); setError('') } })
      .catch((reason) => { if (current) setError(reason instanceof Error ? reason.message : '加载失败') })
    return () => { current = false }
  }, [activeAccount?.id])
  return (
    <section>
      <div className="page-heading"><div><span className="eyebrow">IMMUTABLE OUTPUTS</span><h1>作品不是最后一版，<em>是被批准的快照。</em></h1><p>{activeAccount ? `${activeAccount.name} · ${works.length} 个发布包` : '请先创建账号。'}</p></div></div>
      {error && <div className="inline-message warning">{error}</div>}
      <div className="works-layout"><div className="works-grid">{works.map((work, index) => <button key={work.id} className="work-card" onClick={() => setSelected(work)}><img src={`/api/v1/accounts/${work.accountId}/artifacts/${work.renderedArtifactId}`} alt="" /><span>{String(index + 1).padStart(2, '0')}</span><small>R{work.draftRevision} · {new Date(work.createdAt).toLocaleDateString('zh-CN')}</small><h2>{work.title}</h2><p>{work.body.slice(0, 120)}{work.body.length > 120 ? '…' : ''}</p><footer>{work.tags.slice(0, 3).map((tag) => <i key={tag}>#{tag}</i>)}</footer></button>)}{activeAccount && !works.length && <div className="empty-state"><span>04</span><h2>还没有完成的作品</h2><p>只有经过选题、正文、封面三个人工确认点并打包的任务会出现在这里。</p></div>}</div>{selected && <aside className="work-detail"><button className="close" onClick={() => setSelected(null)}>×</button><img className="work-cover" src={`/api/v1/accounts/${selected.accountId}/artifacts/${selected.renderedArtifactId}`} alt={`${selected.title} 封面`} /><small>PUBLISH PACKAGE · R{selected.draftRevision}</small><h2>{selected.title}</h2><div className="work-body">{selected.body}</div><div className="tags">{selected.tags.map((tag) => <span key={tag}>#{tag}</span>)}</div><dl><div><dt>工作流</dt><dd>{selected.workflowId}</dd></div><div><dt>封面</dt><dd>{selected.coverId}</dd></div></dl><button onClick={() => void navigator.clipboard.writeText(`${selected.title}\n\n${selected.body}\n\n${selected.tags.map((tag) => `#${tag}`).join(' ')}`)}>复制发布文本</button></aside>}</div>
    </section>
  )
}
