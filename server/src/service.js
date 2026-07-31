import { join } from 'node:path'
import { openDatabase, getLocalScope } from './db.js'
import { IdeaShuDomain } from './domain.js'
import { createApp } from './http.js'
import { loadRuntime, repoRoot } from './config.js'

export function createService({ root = repoRoot, database = null } = {}) {
  const runtime = loadRuntime(root)
  const db = openDatabase(database || runtime.paths.database)
  const scope = getLocalScope(db)
  const events = new Set()
  const domain = new IdeaShuDomain(db, {
    ...scope,
    artifactsRoot: runtime.paths.artifacts,
    importRoot: runtime.paths.imports,
    onEvent: (event) => {
      for (const listener of events) listener(event)
    },
  })
  domain.events = events
  const app = createApp({
    domain,
    tokens: runtime.tokens,
    operatorId: scope.operatorId,
    frontendDist: join(root, 'frontend', 'dist'),
    localOrigin: new URL(runtime.connection.baseUrl).origin,
  })
  return { app, db, domain, runtime, scope }
}
