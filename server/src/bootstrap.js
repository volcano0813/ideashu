import { ensureRuntime, repoRoot } from './config.js'
import { openDatabase } from './db.js'

const [major, minor] = process.versions.node.split('.').map(Number)
if (major !== 22 || minor < 13) {
  console.error(`IdeaShu requires Node >=22.13 <23; current version is ${process.versions.node}`)
  process.exit(1)
}

const paths = ensureRuntime(repoRoot)
const db = openDatabase(paths.database)
db.close()
console.log('IdeaShu local runtime initialized.')
console.log('Start: npm start')
console.log('Codex/WorkBuddy MCP command: node ' + JSON.stringify(new URL('./mcp.js', import.meta.url).pathname.replace(/^\/(?:[A-Za-z]:)/, (value) => value.slice(1))))
