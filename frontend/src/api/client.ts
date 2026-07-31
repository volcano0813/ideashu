import type { ApiErrorShape } from './contracts'

export class ApiError extends Error {
  code: string
  status: number
  details?: unknown

  constructor(status: number, payload: ApiErrorShape) {
    super(payload.error?.message || `Request failed (${status})`)
    this.name = 'ApiError'
    this.status = status
    this.code = payload.error?.code || `HTTP_${status}`
    this.details = payload.error?.details
  }
}

let sessionPromise: Promise<void> | null = null

async function ensureSession() {
  if (!sessionPromise) {
    sessionPromise = fetch('/api/v1/session', { method: 'POST', credentials: 'include' }).then((response) => {
      if (!response.ok) throw new ApiError(response.status, { error: { message: '无法建立本地会话，请通过 IdeaShu 服务地址打开页面。' } })
    }).catch((error) => {
      sessionPromise = null
      throw error
    })
  }
  return sessionPromise
}

export async function api<T>(path: string, options: RequestInit = {}): Promise<T> {
  await ensureSession()
  const response = await fetch(`/api/v1${path}`, {
    ...options,
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', ...options.headers },
  })
  if (!response.ok) {
    const payload = await response.json().catch(() => ({})) as ApiErrorShape
    throw new ApiError(response.status, payload)
  }
  if (response.status === 204) return undefined as T
  return response.json() as Promise<T>
}

export const mutation = <T>(path: string, method: 'POST' | 'PATCH' | 'DELETE', body: unknown) =>
  api<T>(path, { method, body: JSON.stringify(body) })

export const idempotencyKey = () => crypto.randomUUID()
