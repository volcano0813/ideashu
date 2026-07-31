import { useMemo, useState } from 'react'

type ExportEntry = { key: string; raw: string; sha256: string }

async function sha256(value: string) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')
}

export default function MigrationPage() {
  const legacyKeys = useMemo(() => Object.keys(localStorage).filter((key) => key.startsWith('ideashu.') && key !== 'ideashu.lastViewedAccount.v3').sort(), [])
  const [message, setMessage] = useState('')
  const exportLegacy = async () => {
    const entries: ExportEntry[] = []
    for (const key of legacyKeys) {
      const raw = localStorage.getItem(key)
      if (raw != null) entries.push({ key, raw, sha256: await sha256(raw) })
    }
    const payload = { format: 'ideashu-browser-export-v1', exportedAt: new Date().toISOString(), source: location.origin, entries }
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' })
    const link = document.createElement('a')
    link.href = URL.createObjectURL(blob)
    link.download = `ideashu-browser-export-${new Date().toISOString().slice(0, 10)}.json`
    link.click()
    URL.revokeObjectURL(link.href)
    setMessage(`已导出 ${entries.length} 个 key。原数据没有被删除。`)
  }
  return <section><div className="page-heading"><div><span className="eyebrow">LEGACY SAFETY</span><h1>先导出、校验、映射，<em>再决定迁移。</em></h1><p>浏览器数据不会被后端自动读取，也不会因为字节相同就复制或删除。</p></div></div><div className="migration-card"><span>READ-ONLY EXPORT</span><h2>检测到 {legacyKeys.length} 个旧版 IdeaShu key</h2><p>导出包为每个原始值保存 SHA-256。下一步使用仓库迁移命令 dry-run，并明确指定旧账号到新账号的映射；有歧义时迁移会停止。</p><div className="legacy-keys">{legacyKeys.map((key) => <code key={key}>{key}</code>)}</div><button className="primary" onClick={() => void exportLegacy()} disabled={!legacyKeys.length}>下载只读备份</button><p className="inline-message">{message || '此操作绝不会清空 localStorage。'}</p></div></section>
}
