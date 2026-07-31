import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { api, idempotencyKey, mutation } from '../api/client'
import type { Material, Workflow } from '../api/contracts'
import { useActiveAccount } from '../contexts/ActiveAccountContext'

export default function MaterialsPage() {
  const { activeAccount } = useActiveAccount()
  const [materials, setMaterials] = useState<Material[]>([])
  const [type, setType] = useState<Material['type']>('text')
  const [content, setContent] = useState('')
  const [tags, setTags] = useState('')
  const [query, setQuery] = useState('')
  const [message, setMessage] = useState('')
  const load = async () => {
    if (!activeAccount) return
    try { setMaterials(await api<Material[]>(`/accounts/${activeAccount.id}/materials?q=${encodeURIComponent(query)}`)); setMessage('') }
    catch (error) { setMessage(error instanceof Error ? error.message : '加载失败') }
  }
  useEffect(() => {
    const accountId = activeAccount?.id
    if (!accountId) return
    let current = true
    api<Material[]>(`/accounts/${accountId}/materials?q=${encodeURIComponent(query)}`)
      .then((items) => { if (current) { setMaterials(items); setMessage('') } })
      .catch((error) => { if (current) setMessage(error instanceof Error ? error.message : '加载失败') })
    return () => { current = false }
  }, [activeAccount?.id, query])
  const save = async () => {
    if (!activeAccount || !content.trim()) return
    try {
      await mutation(`/accounts/${activeAccount.id}/materials`, 'POST', { type, content, tags: tags.split(/[,，]/).map((x) => x.trim()).filter(Boolean), idempotencyKey: idempotencyKey() })
      setContent(''); setTags(''); await load()
    } catch (error) { setMessage(error instanceof Error ? error.message : '保存失败') }
  }
  const start = async (material: Material) => {
    if (!activeAccount) return
    const run = await mutation<Workflow>(`/accounts/${activeAccount.id}/workflows`, 'POST', {
      objective: `基于素材：${material.content.slice(0, 100)}`,
      idempotencyKey: idempotencyKey(),
    })
    location.assign(`/create/${activeAccount.id}/${run.id}`)
  }
  return (
    <section>
      <div className="page-heading"><div><span className="eyebrow">SOURCE OF TRUTH</span><h1>先收集证据，<em>再开始表达。</em></h1><p>{activeAccount ? `当前范围：${activeAccount.name}` : '请先创建账号。'} 素材会被服务端固定在账号边界内。</p></div><div className="search"><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="搜索素材内容…" /></div></div>
      {!activeAccount ? <div className="empty-state"><h2>尚无账号</h2><Link className="primary link-button" to="/accounts">创建账号</Link></div> : <>
        <div className="material-composer">
          <div className="composer-type">{(['text', 'link', 'data', 'photo', 'voice'] as const).map((item) => <button className={type === item ? 'active' : ''} onClick={() => setType(item)} key={item}>{({ text: '文本', link: '链接', data: '数据', photo: '图片说明', voice: '口述' })[item]}</button>)}</div>
          <textarea value={content} onChange={(e) => setContent(e.target.value)} placeholder="粘贴原始信息、观察、链接或数据。保留来源，不要先写成结论。" />
          <div className="composer-footer"><input value={tags} onChange={(e) => setTags(e.target.value)} placeholder="标签，用逗号分隔" /><button className="primary" onClick={() => void save()}>存入素材库</button></div>
        </div>
        {message && <p className="inline-message">{message}</p>}
        <div className="material-list">
          {materials.map((material) => <article key={material.id} className="material-card"><div><span className="type-badge">{material.type}</span><time>{new Date(material.createdAt).toLocaleDateString('zh-CN')}</time></div><p>{material.content}</p><footer><div>{material.tags.map((tag) => <span key={tag}>#{tag}</span>)}</div><button onClick={() => void start(material)}>以此开始创作 →</button></footer></article>)}
          {!materials.length && <div className="empty-state"><span>02</span><h2>素材库还是空的</h2><p>先保存一条真实观察，胜过生成十条没有依据的观点。</p></div>}
        </div>
      </>}
    </section>
  )
}
