import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { createService } from '../../src/service.js'

async function startService() {
  const root = mkdtempSync(join(tmpdir(), 'ideashu-http-'))
  const service = createService({ root })
  const server = await new Promise((resolve) => {
    const value = service.app.listen(0, '127.0.0.1', () => resolve(value))
  })
  const address = server.address()
  return { ...service, server, base: `http://127.0.0.1:${address.port}` }
}

test('HTTP authentication, origin checks, account isolation and SPA-independent health', async (t) => {
  const service = await startService()
  t.after(() => { service.server.close(); service.db.close() })
  const health = await fetch(`${service.base}/api/v1/health`)
  assert.equal(health.status, 200)
  assert.equal((await health.json()).storage, 'sqlite')

  const unauth = await fetch(`${service.base}/api/v1/accounts`)
  assert.equal(unauth.status, 401)
  const badOrigin = await fetch(`${service.base}/api/v1/accounts`, {
    headers: { Authorization: `Bearer ${service.runtime.tokens.operatorToken}`, Origin: 'https://evil.example' },
  })
  assert.equal(badOrigin.status, 403)

  const auth = { Authorization: `Bearer ${service.runtime.tokens.operatorToken}` }
  const create = async (name, idempotencyKey) => {
    const response = await fetch(`${service.base}/api/v1/accounts`, {
      method: 'POST', headers: { ...auth, 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, idempotencyKey }),
    })
    assert.equal(response.status, 200)
    return response.json()
  }
  const a = await create('A', 'http-account-a')
  const b = await create('B', 'http-account-b')
  const runResponse = await fetch(`${service.base}/api/v1/accounts/${a.id}/workflows`, {
    method: 'POST', headers: { ...auth, 'Content-Type': 'application/json' },
    body: JSON.stringify({ objective: 'A workflow', idempotencyKey: 'http-run-a' }),
  })
  const run = await runResponse.json()
  const crossed = await fetch(`${service.base}/api/v1/accounts/${b.id}/workflows/${run.id}`, { headers: auth })
  assert.equal(crossed.status, 404)
})

test('MCP bearer cannot call operator-only approval route', async (t) => {
  const service = await startService()
  t.after(() => { service.server.close(); service.db.close() })
  const response = await fetch(`${service.base}/api/v1/accounts/00000000-0000-0000-0000-000000000000/workflows/00000000-0000-0000-0000-000000000000/topic-approval`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${service.runtime.tokens.mcpToken}`, 'Content-Type': 'application/json', 'X-IdeaShu-Agent-Run': 'integration-agent' },
    body: JSON.stringify({ topicId: '00000000-0000-0000-0000-000000000000', expectedWorkflowVersion: 1, idempotencyKey: 'mcp-no-approval' }),
  })
  assert.equal(response.status, 403)
  const body = await response.json()
  assert.equal(body.error.code, 'OPERATOR_REQUIRED')
})

test('authenticated account-scoped artifact stream serves generated SVG bytes', async (t) => {
  const service = await startService()
  t.after(() => { service.server.close(); service.db.close() })
  const account = service.domain.createAccount({ name: 'Asset owner', idempotencyKey: 'http-asset-owner' }, { kind: 'operator', id: service.scope.operatorId })
  const artifactId = service.domain.storeGeneratedArtifact(account.id, 'cover_render', Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>'), 'svg', 'image/svg+xml')
  const response = await fetch(`${service.base}/api/v1/accounts/${account.id}/artifacts/${artifactId}`, {
    headers: { Authorization: `Bearer ${service.runtime.tokens.operatorToken}` },
  })
  assert.equal(response.status, 200)
  assert.match(await response.text(), /^<svg/)
})

test('MCP bearer is run-bound and cannot mutate account administration', async (t) => {
  const service = await startService()
  t.after(() => { service.server.close(); service.db.close() })
  const actor = { kind: 'operator', id: service.scope.operatorId }
  const a = service.domain.createAccount({ name: 'Bound A', idempotencyKey: 'http-bound-a' }, actor)
  const b = service.domain.createAccount({ name: 'Bound B', idempotencyKey: 'http-bound-b' }, actor)
  service.domain.createWorkflow(a.id, { objective: '', idempotencyKey: 'http-bound-run' }, { kind: 'agent', id: 'http-bound-agent' })
  const headers = { Authorization: `Bearer ${service.runtime.tokens.mcpToken}`, 'X-IdeaShu-Agent-Run': 'http-bound-agent' }
  const crossed = await fetch(`${service.base}/api/v1/accounts/${b.id}`, { headers })
  assert.equal(crossed.status, 404)
  const deleted = await fetch(`${service.base}/api/v1/accounts/${a.id}`, {
    method: 'DELETE', headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify({ expectedRevision: a.revision, idempotencyKey: 'http-agent-delete' }),
  })
  assert.equal(deleted.status, 403)
})

test('SSE resumes after Last-Event-ID and filters account events', async (t) => {
  const service = await startService()
  t.after(() => { service.server.close(); service.db.close() })
  const actor = { kind: 'operator', id: service.scope.operatorId }
  const a = service.domain.createAccount({ name: 'SSE A', idempotencyKey: 'sse-account-a' }, actor)
  const b = service.domain.createAccount({ name: 'SSE B', idempotencyKey: 'sse-account-b' }, actor)
  service.domain.createMaterial(a.id, { type: 'text', content: 'A first', tags: [], idempotencyKey: 'sse-a-first' }, actor)
  const firstSequence = service.domain.auditEvents({ accountId: a.id }).at(-1).sequence
  const hidden = service.domain.createMaterial(b.id, { type: 'text', content: 'B hidden', tags: [], idempotencyKey: 'sse-b-hidden' }, actor)
  const visible = service.domain.createMaterial(a.id, { type: 'text', content: 'A visible', tags: [], idempotencyKey: 'sse-a-visible' }, actor)
  const controller = new AbortController()
  const response = await fetch(`${service.base}/api/v1/events?accountId=${a.id}`, {
    headers: { Authorization: `Bearer ${service.runtime.tokens.operatorToken}`, 'Last-Event-ID': String(firstSequence) },
    signal: controller.signal,
  })
  assert.equal(response.status, 200)
  const chunk = new TextDecoder().decode((await response.body.getReader().read()).value)
  controller.abort()
  assert.match(chunk, new RegExp(visible.id))
  assert.equal(chunk.includes(hidden.id), false)
})
