/* eslint-disable react-refresh/only-export-components */
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { api } from '../api/client'
import type { Account } from '../api/contracts'

const VIEWED_ACCOUNT_KEY = 'ideashu.lastViewedAccount.v3'

type AccountContextValue = {
  accounts: Account[]
  activeAccount: Account | null
  activeAccountId: string
  loading: boolean
  error: string
  setActiveAccountId: (id: string) => void
  refresh: () => Promise<void>
}

const AccountContext = createContext<AccountContextValue | null>(null)

export function ActiveAccountProvider({ children }: { children: ReactNode }) {
  const [accounts, setAccounts] = useState<Account[]>([])
  const [activeAccountId, setActiveAccountIdState] = useState(() => localStorage.getItem(VIEWED_ACCOUNT_KEY) || '')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const refresh = useCallback(async () => {
    setLoading(true)
    try {
      const list = await api<Account[]>('/accounts')
      setAccounts(list)
      setError('')
      setActiveAccountIdState((current) => list.some((item) => item.id === current) ? current : (list[0]?.id || ''))
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '本地服务不可用')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void refresh() }, [refresh])

  const setActiveAccountId = useCallback((id: string) => {
    if (!accounts.some((item) => item.id === id)) return
    localStorage.setItem(VIEWED_ACCOUNT_KEY, id)
    setActiveAccountIdState(id)
  }, [accounts])

  const activeAccount = accounts.find((item) => item.id === activeAccountId) || null
  const value = useMemo(() => ({ accounts, activeAccount, activeAccountId, loading, error, setActiveAccountId, refresh }),
    [accounts, activeAccount, activeAccountId, loading, error, setActiveAccountId, refresh])
  return <AccountContext.Provider value={value}>{children}</AccountContext.Provider>
}

export function useActiveAccount() {
  const value = useContext(AccountContext)
  if (!value) throw new Error('useActiveAccount must be used inside ActiveAccountProvider')
  return value
}
