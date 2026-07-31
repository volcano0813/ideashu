import { NavLink, Outlet } from 'react-router-dom'
import { useActiveAccount } from '../contexts/ActiveAccountContext'

const nav = [
  { to: '/accounts', label: '账号', index: '01' },
  { to: '/materials', label: '素材', index: '02' },
  { to: '/create', label: '创作', index: '03' },
  { to: '/works', label: '作品', index: '04' },
]

export default function Shell() {
  const { accounts, activeAccountId, setActiveAccountId, loading, error } = useActiveAccount()
  return (
    <div className="app-shell">
      <header className="topbar">
        <NavLink to="/create" className="brand" aria-label="IdeaShu 首页">
          <span className="brand-mark">意</span>
          <span><strong>IdeaShu</strong><small>LOCAL CONTENT STUDIO</small></span>
        </NavLink>
        <nav className="primary-nav" aria-label="一级导航">
          {nav.map((item) => (
            <NavLink key={item.to} to={item.to} className={({ isActive }) => isActive ? 'active' : ''}>
              <small>{item.index}</small>{item.label}
            </NavLink>
          ))}
        </nav>
        <div className="account-switcher">
          <span className={`status-dot ${error ? 'error' : ''}`} />
          <select value={activeAccountId} onChange={(event) => setActiveAccountId(event.target.value)} disabled={loading || !accounts.length} aria-label="当前账号">
            {!accounts.length && <option value="">{loading ? '正在连接…' : '尚无账号'}</option>}
            {accounts.map((account) => <option value={account.id} key={account.id}>{account.name}</option>)}
          </select>
        </div>
      </header>
      {error && <div className="service-banner"><strong>本地服务未连接</strong><span>{error}</span><code>npm start</code></div>}
      <main className="page-frame"><Outlet /></main>
      <footer className="footer"><span>Local-first · SQLite · MCP</span><NavLink to="/migration">旧数据导出</NavLink></footer>
    </div>
  )
}
