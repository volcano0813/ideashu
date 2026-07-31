import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { spawn } from 'node:child_process'
import { createService } from '../../src/service.js'

const repo = resolve(import.meta.dirname, '..', '..', '..')

function rpcClient(child) {
  const frames = []
  const waiters = new Map()
  let buffer = ''
  child.stdout.setEncoding('utf8')
  child.stdout.on('data', (chunk) => {
    buffer += chunk
    const lines = buffer.split(/\r?\n/)
    buffer = lines.pop() || ''
    for (const line of lines.filter(Boolean)) {
      let frame
      try { frame = JSON.parse(line) }
      catch (error) {
        for (const waiter of waiters.values()) waiter.reject(new Error(`Non-JSON MCP stdout: ${line}`))
        waiters.clear()
        continue
      }
      frames.push(frame)
      if (frame.id != null && waiters.has(frame.id)) { waiters.get(frame.id).resolve(frame); waiters.delete(frame.id) }
    }
  })
  const send = (value) => child.stdin.write(`${JSON.stringify(value)}\n`)
  const request = (id, method, params = {}) => new Promise((resolvePromise, reject) => {
    const timer = setTimeout(() => { waiters.delete(id); reject(new Error(`MCP timeout: ${method}`)) }, 10_000)
    waiters.set(id, { resolve: (value) => { clearTimeout(timer); resolvePromise(value) }, reject })
    send({ jsonrpc: '2.0', id, method, params })
  })
  return { frames, send, request }
}

test('stdio MCP initializes from a foreign cwd, lists focused tools, calls API, and keeps stdout protocol-clean', async (t) => {
  const runtimeDir = mkdtempSync(join(tmpdir(), 'ideashu-mcp-runtime-'))
  const foreignCwd = mkdtempSync(join(tmpdir(), 'ideashu-mcp-cwd-'))
  const priorRuntime = process.env.IDEASHU_RUNTIME_DIR
  process.env.IDEASHU_RUNTIME_DIR = runtimeDir
  const service = createService({ root: repo })
  if (priorRuntime === undefined) delete process.env.IDEASHU_RUNTIME_DIR
  else process.env.IDEASHU_RUNTIME_DIR = priorRuntime
  service.domain.createAccount({ name: 'MCP visible', idempotencyKey: 'mcp-test-account' }, { kind: 'operator', id: service.scope.operatorId })
  const http = await new Promise((resolvePromise) => {
    const value = service.app.listen(0, '127.0.0.1', () => resolvePromise(value))
  })
  const port = http.address().port
  const child = spawn(process.execPath, [resolve(repo, 'server', 'src', 'mcp.js')], {
    cwd: foreignCwd,
    env: { ...process.env, IDEASHU_RUNTIME_DIR: runtimeDir, IDEASHU_PORT: String(port) },
    stdio: ['pipe', 'pipe', 'pipe'],
  })
  let stderr = ''
  child.stderr.setEncoding('utf8')
  child.stderr.on('data', (chunk) => { stderr += chunk })
  t.after(() => { child.kill(); http.close(); service.db.close() })
  const rpc = rpcClient(child)
  const initialized = await rpc.request(1, 'initialize', {
    protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'ideashu-test', version: '1.0.0' },
  })
  assert.equal(initialized.error, undefined)
  rpc.send({ jsonrpc: '2.0', method: 'notifications/initialized', params: {} })
  const listed = await rpc.request(2, 'tools/list')
  assert.equal(listed.error, undefined)
  const names = listed.result.tools.map((tool) => tool.name)
  assert.equal(names.length, 13)
  assert.equal(names.some((name) => /approve|publish|delete/.test(name)), false)
  const called = await rpc.request(3, 'tools/call', { name: 'ideashu_accounts_list', arguments: {} })
  assert.equal(called.error, undefined)
  assert.equal(called.result.structuredContent.result[0].name, 'MCP visible')
  const accountId = called.result.structuredContent.result[0].id
  const created = await rpc.request(4, 'tools/call', { name: 'ideashu_workflow_create', arguments: {
    accountId, agentRunId: 'mcp-integration-run', objective: 'Protocol workflow', idempotencyKey: 'mcp-workflow-create',
  } })
  assert.equal(created.error, undefined)
  const workflowId = created.result.structuredContent.result.id
  const snapshot = await rpc.request(5, 'tools/call', { name: 'ideashu_workflow_get', arguments: {
    accountId, workflowId, agentRunId: 'mcp-integration-run',
  } })
  assert.equal(snapshot.result.structuredContent.result.workflow.accountId, accountId)
  assert.ok(rpc.frames.every((frame) => frame.jsonrpc === '2.0'))
  assert.match(stderr, /ideashu-mcp/)
})
