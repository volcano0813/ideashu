import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { ensureRuntime, repoRoot } from './config.js'
import { getLocalScope, openDatabase } from './db.js'

const checks = []
const check = (name, ok, detail = '') => checks.push({ name, ok: Boolean(ok), detail })
const paths = ensureRuntime(repoRoot)
let db
try {
  db = openDatabase(paths.database)
  const scope = getLocalScope(db)
  check('SQLite opens with migrations', true)
  check('Foreign keys enabled', db.prepare('PRAGMA foreign_keys').get().foreign_keys === 1)
  check('Local workspace exists', Boolean(scope.workspaceId))
  const integrity = db.prepare('PRAGMA integrity_check').get().integrity_check
  check('SQLite integrity', integrity === 'ok', String(integrity))
} catch (error) {
  check('SQLite opens with migrations', false, error.message)
} finally {
  db?.close()
}
check('Token file exists', existsSync(paths.tokenFile))
if (existsSync(paths.tokenFile)) {
  const tokens = JSON.parse(readFileSync(paths.tokenFile, 'utf8'))
  check('Separate strong operator/MCP tokens', tokens.operatorToken?.length >= 40 && tokens.mcpToken?.length >= 40 && tokens.operatorToken !== tokens.mcpToken)
}
check('Artifact store exists', existsSync(paths.artifacts))
check('Frontend production build exists', existsSync(join(repoRoot, 'frontend', 'dist', 'index.html')), 'Run npm run build before production start')

for (const item of checks) console.log(`${item.ok ? 'PASS' : 'FAIL'}  ${item.name}${item.detail ? ` — ${item.detail}` : ''}`)
if (checks.some((item) => !item.ok)) process.exitCode = 1
