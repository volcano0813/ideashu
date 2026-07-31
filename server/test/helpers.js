import { mkdtempSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { openDatabase, getLocalScope } from '../src/db.js'
import { IdeaShuDomain } from '../src/domain.js'

export function createTestDomain() {
  const root = mkdtempSync(join(tmpdir(), 'ideashu-test-'))
  const artifactsRoot = join(root, 'artifacts')
  const importRoot = join(root, 'imports')
  mkdirSync(artifactsRoot, { recursive: true })
  mkdirSync(importRoot, { recursive: true })
  const db = openDatabase(':memory:')
  const scope = getLocalScope(db)
  const events = []
  const domain = new IdeaShuDomain(db, {
    ...scope,
    artifactsRoot,
    importRoot,
    onEvent: (event) => events.push(event),
  })
  return { domain, db, scope, events, root, artifactsRoot, importRoot }
}

export const key = (label) => `${label}-00000000`
export const operator = (scope) => ({ kind: 'operator', id: scope.operatorId })
export const agent = (id = 'agent-run-0001') => ({ kind: 'agent', id })

export function createAccount(domain, scope, name, suffix) {
  return domain.createAccount({ name, idempotencyKey: key(`account-${suffix}`) }, operator(scope))
}
