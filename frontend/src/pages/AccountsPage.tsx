import { useState } from 'react'
import { idempotencyKey, mutation } from '../api/client'
import type { Account } from '../api/contracts'
import { useActiveAccount } from '../contexts/ActiveAccountContext'

type FormState = { name: string; domain: string; persona: string; tone: string; styleName: string }
const empty: FormState = { name: '', domain: '', persona: '', tone: '', styleName: '' }

export default function AccountsPage() {
  const { accounts, activeAccount, setActiveAccountId, refresh } = useActiveAccount()
  const [form, setForm] = useState<FormState>(empty)
  const [editing, setEditing] = useState<Account | null>(null)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')

  const openEdit = (account: Account) => {
    setEditing(account)
    setForm({ name: account.name, domain: account.domain, persona: account.persona, tone: account.tone, styleName: account.styleName })
  }
  const reset = () => { setEditing(null); setForm(empty) }
  const save = async () => {
    if (!form.name.trim()) return
    setBusy(true)
    try {
      if (editing) {
        await mutation(`/accounts/${editing.id}`, 'PATCH', { ...form, expectedRevision: editing.revision, idempotencyKey: idempotencyKey() })
        setMessage('账号画像已保存，新任务会使用更新后的上下文。')
      } else {
        const created = await mutation<Account>('/accounts', 'POST', { ...form, idempotencyKey: idempotencyKey() })
        setActiveAccountId(created.id)
        setMessage('账号已创建。')
      }
      reset()
      await refresh()
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '保存失败')
    } finally { setBusy(false) }
  }
  const remove = async (account: Account) => {
    if (!confirm(`软删除账号“${account.name}”？历史数据仍保留在本地数据库中。`)) return
    setBusy(true)
    try {
      await mutation(`/accounts/${account.id}`, 'DELETE', { expectedRevision: account.revision, idempotencyKey: idempotencyKey() })
      await refresh()
    } catch (error) { setMessage(error instanceof Error ? error.message : '删除失败') }
    finally { setBusy(false) }
  }

  return (
    <section>
      <div className="page-heading">
        <div><span className="eyebrow">IDENTITY BOUNDARY</span><h1>账号不是标签，<em>是数据边界。</em></h1><p>每个创作任务会永久锁定一个账号，素材、草稿、封面和作品不会跨号混用。</p></div>
        <button className="primary" onClick={() => { reset(); setMessage('') }}>＋ 新建账号</button>
      </div>

      <div className="account-grid">
        {accounts.map((account) => (
          <article className={`account-card ${activeAccount?.id === account.id ? 'selected' : ''}`} key={account.id}>
            <div className="account-monogram">{account.name.slice(0, 1)}</div>
            <div className="card-head"><div><small>{account.domain || '尚未设置领域'}</small><h2>{account.name}</h2></div><span className="revision">R{account.revision}</span></div>
            <p>{account.persona || '补充账号人设，智能体才知道以谁的视角表达。'}</p>
            <dl><div><dt>语气</dt><dd>{account.tone || '未设置'}</dd></div><div><dt>风格</dt><dd>{account.styleName || '未设置'}</dd></div></dl>
            <div className="card-actions"><button onClick={() => setActiveAccountId(account.id)}>设为当前</button><button onClick={() => openEdit(account)}>编辑画像</button><button className="danger" onClick={() => void remove(account)} disabled={busy}>删除</button></div>
          </article>
        ))}
        {!accounts.length && <div className="empty-state"><span>01</span><h2>先建立第一个内容账号</h2><p>系统不会自动注入演示账号，避免真实任务误用虚假人设。</p></div>}
      </div>

      <div className="editor-panel">
        <div className="panel-title"><span>{editing ? 'EDIT PROFILE' : 'NEW PROFILE'}</span><h2>{editing ? `编辑 ${editing.name}` : '建立账号上下文'}</h2></div>
        <div className="form-grid">
          <label>账号名称<input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="例如：Elia 的 AI 实践" /></label>
          <label>内容领域<input value={form.domain} onChange={(e) => setForm({ ...form, domain: e.target.value })} placeholder="AI / 产品 / 创业" /></label>
          <label>视觉或写作风格<input value={form.styleName} onChange={(e) => setForm({ ...form, styleName: e.target.value })} placeholder="实践笔记、克制留白" /></label>
          <label>表达语气<input value={form.tone} onChange={(e) => setForm({ ...form, tone: e.target.value })} placeholder="专业但不高冷" /></label>
          <label className="wide">账号人设<textarea value={form.persona} onChange={(e) => setForm({ ...form, persona: e.target.value })} placeholder="经历、立场、目标读者、不能说的话…" /></label>
        </div>
        <div className="panel-footer"><span>{message}</span><div><button onClick={reset}>清空</button><button className="primary" onClick={() => void save()} disabled={busy || !form.name.trim()}>{busy ? '保存中…' : '保存账号'}</button></div></div>
      </div>
    </section>
  )
}
