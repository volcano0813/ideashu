import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { spawnSync } from 'node:child_process'
import { ensureRuntime } from '../../src/config.js'
import { getLocalScope, openDatabase } from '../../src/db.js'
import { IdeaShuDomain } from '../../src/domain.js'

const repo = resolve(import.meta.dirname, '..', '..', '..')
const hash = (value) => createHash('sha256').update(value).digest('hex')

function run(runtimeDir, args) {
  return spawnSync(process.execPath, ['server/src/legacy.js', ...args], {
    cwd: repo, encoding: 'utf8', env: { ...process.env, IDEASHU_RUNTIME_DIR: runtimeDir },
  })
}

test('legacy browser import is dry-run safe, account-mapped, checksummed and idempotent', () => {
  const root = mkdtempSync(join(tmpdir(), 'ideashu-migrate-'))
  const runtimeDir = join(root, 'runtime')
  const source = join(root, 'browser.json')
  const mappingPath = join(root, 'mapping.json')
  const materialRaw = JSON.stringify([
    { type: 'text', content: 'independent text', topicTags: ['legacy'], createdAt: '2025-01-01T00:00:00.000Z' },
    { type: 'photo', content: 'pixel', topicTags: [], imageDataUrl: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=' },
  ])
  const exportPayload = { format: 'ideashu-browser-export-v1', exportedAt: new Date().toISOString(), entries: [{ key: 'ideashu.materials.legacy-a.v2', raw: materialRaw, sha256: hash(materialRaw) }] }
  writeFileSync(source, JSON.stringify(exportPayload), 'utf8')
  writeFileSync(mappingPath, JSON.stringify({ 'legacy-a': '00000000-0000-4000-a000-000000000001' }), 'utf8')

  const dry = run(runtimeDir, ['--source', source, '--mapping', mappingPath])
  assert.equal(dry.status, 0, dry.stderr)
  assert.equal(existsSync(join(runtimeDir, 'ideashu.sqlite')), false)
  assert.equal(JSON.parse(dry.stdout).plannedItems, 2)

  const previous = process.env.IDEASHU_RUNTIME_DIR
  process.env.IDEASHU_RUNTIME_DIR = runtimeDir
  const paths = ensureRuntime(repo)
  const db = openDatabase(paths.database)
  const scope = getLocalScope(db)
  const domain = new IdeaShuDomain(db, { ...scope, artifactsRoot: paths.artifacts, importRoot: paths.imports })
  const account = domain.createAccount({ name: 'Imported', idempotencyKey: 'migration-account' }, { kind: 'operator', id: scope.operatorId })
  db.close()
  if (previous === undefined) delete process.env.IDEASHU_RUNTIME_DIR
  else process.env.IDEASHU_RUNTIME_DIR = previous
  writeFileSync(mappingPath, JSON.stringify({ 'legacy-a': account.id }), 'utf8')

  const applied = run(runtimeDir, ['--source', source, '--mapping', mappingPath, '--apply'])
  assert.equal(applied.status, 0, applied.stderr)
  const repeated = run(runtimeDir, ['--source', source, '--mapping', mappingPath, '--apply'])
  assert.equal(repeated.status, 0, repeated.stderr)
  const verifyDb = openDatabase(paths.database)
  assert.equal(verifyDb.prepare('SELECT COUNT(*) AS count FROM materials WHERE account_id = ?').get(account.id).count, 2)
  assert.equal(verifyDb.prepare('SELECT COUNT(*) AS count FROM artifacts WHERE account_id = ?').get(account.id).count, 1)
  assert.equal(verifyDb.prepare('SELECT COUNT(*) AS count FROM idempotency_records WHERE operation = ?').get('legacy.imported').count, 1)
  verifyDb.close()
  assert.equal(readFileSync(source, 'utf8'), JSON.stringify(exportPayload))
})

test('ambiguous unscoped legacy data blocks apply', () => {
  const root = mkdtempSync(join(tmpdir(), 'ideashu-ambiguous-'))
  const raw = JSON.stringify([{ content: 'unknown owner' }])
  const source = join(root, 'browser.json')
  writeFileSync(source, JSON.stringify({ format: 'ideashu-browser-export-v1', entries: [{ key: 'ideashu.materials.v1', raw, sha256: hash(raw) }] }), 'utf8')
  const applied = run(join(root, 'runtime'), ['--source', source, '--apply'])
  assert.notEqual(applied.status, 0)
  assert.match(applied.stderr, /quarantined|ambiguous/i)
})
