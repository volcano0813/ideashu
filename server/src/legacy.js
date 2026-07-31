import { createHash } from 'node:crypto'
import { copyFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs'
import { basename, join, resolve } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { loadRuntime } from './config.js'
import { getLocalScope, openDatabase } from './db.js'
import { IdeaShuDomain } from './domain.js'

function sha256(value) { return createHash('sha256').update(value).digest('hex') }
function parseArgs(argv) {
  const args = { apply: false, source: '', mapping: '' }
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === '--apply') args.apply = true
    else if (argv[index] === '--source') args.source = argv[++index] || ''
    else if (argv[index] === '--mapping') args.mapping = argv[++index] || ''
  }
  if (!args.source) throw new Error('Usage: npm run migrate:legacy -- --source <export.json> --mapping <mapping.json> [--apply]')
  return args
}

function parseJson(raw, label) {
  try { return JSON.parse(raw) }
  catch (error) { throw new Error(`${label} is not valid JSON: ${error.message}`) }
}

function tags(value) {
  if (Array.isArray(value)) return value.map(String)
  if (typeof value === 'string') {
    try { const parsed = JSON.parse(value); return Array.isArray(parsed) ? parsed.map(String) : [] } catch { return [] }
  }
  return []
}

function dataUrlImage(value) {
  if (typeof value !== 'string') return null
  const match = value.match(/^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/=]+)$/)
  if (!match) return null
  return { mimeType: match[1], extension: match[1] === 'image/jpeg' ? 'jpg' : match[1].split('/')[1], base64: match[2] }
}

function addBrowserItems(payload, mapping, report) {
  if (!Array.isArray(payload.entries)) throw new Error('Browser export entries must be an array')
  for (const entry of payload.entries) {
    if (sha256(entry.raw) !== entry.sha256) throw new Error(`Checksum mismatch for ${entry.key}`)
    const scoped = entry.key.match(/^ideashu\.(materials|posts|styleSamples)\.([^.]+)\.v2$/)
    if (!scoped) {
      if (/^ideashu\.(materials|posts|draftSession|pendingDraft|styleSamples|pendingPublish)\.v1$/.test(entry.key)) {
        report.quarantine.push({ key: entry.key, reason: 'unscoped_legacy_data_requires_manual_account_mapping' })
      }
      continue
    }
    const [, kind, legacyAccountId] = scoped
    const accountId = mapping[legacyAccountId]
    if (!accountId) { report.quarantine.push({ key: entry.key, reason: 'missing_account_mapping', legacyAccountId }); continue }
    const values = parseJson(entry.raw, entry.key)
    if (!Array.isArray(values)) { report.quarantine.push({ key: entry.key, reason: 'expected_array' }); continue }
    values.forEach((value, index) => {
      if (kind === 'materials') report.items.push({ accountId, type: value.type === 'photo' ? 'photo' : (['text', 'voice', 'data', 'link'].includes(value.type) ? value.type : 'text'), content: String(value.content || ''), tags: tags(value.topicTags), image: dataUrlImage(value.imageDataUrl), createdAt: value.createdAt, sourceKey: entry.key, sourceIndex: index })
      else report.items.push({ accountId, type: 'text', content: `${value.title || ''}\n\n${value.body || ''}`.trim(), tags: [...new Set([...tags(value.tags), kind === 'posts' ? 'legacy-post' : 'legacy-style-sample'])], createdAt: value.createdAt, sourceKey: entry.key, sourceIndex: index })
    })
  }
}

function addSyncItems(payload, mapping, report) {
  for (const [index, draft] of (payload.drafts || []).entries()) {
    const legacyAccountId = String(draft.user_id || '')
    const accountId = mapping[legacyAccountId]
    if (!accountId) { report.quarantine.push({ key: `drafts[${index}]`, reason: 'missing_account_mapping', legacyAccountId }); continue }
    report.items.push({ accountId, type: 'text', content: `${draft.title || ''}\n\n${draft.body || ''}`.trim(), tags: [...new Set([...tags(draft.tags), 'legacy-draft'])], createdAt: draft.created_at, sourceKey: `drafts[${index}]`, sourceIndex: index })
  }
  for (const [index, topicRow] of (payload.topics || []).entries()) {
    const legacyAccountId = String(topicRow.user_id || '')
    const accountId = mapping[legacyAccountId]
    if (!accountId) { report.quarantine.push({ key: `topics[${index}]`, reason: 'missing_account_mapping', legacyAccountId }); continue }
    report.items.push({ accountId, type: 'data', content: typeof topicRow.topics === 'string' ? topicRow.topics : JSON.stringify(topicRow.topics), tags: ['legacy-topics'], createdAt: topicRow.created_at, sourceKey: `topics[${index}]`, sourceIndex: index })
  }
}

const args = parseArgs(process.argv.slice(2))
const sourcePath = resolve(args.source)
const sourceRaw = readFileSync(sourcePath)
const sourceSha256 = sha256(sourceRaw)
const payload = parseJson(sourceRaw.toString('utf8'), basename(sourcePath))
const mapping = args.mapping ? parseJson(readFileSync(resolve(args.mapping), 'utf8'), 'mapping') : {}
const report = { mode: args.apply ? 'apply' : 'dry-run', source: sourcePath, sourceSha256, mapping, items: [], quarantine: [] }

if (payload.format === 'ideashu-browser-export-v1') addBrowserItems(payload, mapping, report)
else if (Array.isArray(payload.drafts) || Array.isArray(payload.topics)) addSyncItems(payload, mapping, report)
else throw new Error('Unsupported legacy export format')

const runtime = loadRuntime()
if (existsSync(runtime.paths.database)) {
  const readOnly = new DatabaseSync(runtime.paths.database, { readOnly: true })
  const scope = getLocalScope(readOnly)
  const targetIds = new Set(readOnly.prepare('SELECT id FROM content_accounts WHERE workspace_id = ? AND deleted_at IS NULL').all(scope.workspaceId).map((row) => row.id))
  readOnly.close()
  for (const target of new Set(Object.values(mapping))) if (!targetIds.has(target)) report.quarantine.push({ key: 'mapping', reason: 'target_account_not_found', accountId: target })
}

const summary = { mode: report.mode, sourceSha256, plannedItems: report.items.length, quarantine: report.quarantine, byAccount: Object.groupBy(report.items, (item) => item.accountId) }
summary.byAccount = Object.fromEntries(Object.entries(summary.byAccount).map(([accountId, items]) => [accountId, items.length]))
console.log(JSON.stringify(summary, null, 2))

if (!args.apply) process.exit(0)
if (report.quarantine.length) throw new Error('Import stopped because quarantined or ambiguous records require manual resolution')
const backupDir = join(runtime.paths.root, 'migration-backups')
mkdirSync(backupDir, { recursive: true })
copyFileSync(sourcePath, join(backupDir, `${sourceSha256}.json`))
const db = openDatabase(runtime.paths.database)
try {
  const scope = getLocalScope(db)
  const domain = new IdeaShuDomain(db, { ...scope, artifactsRoot: runtime.paths.artifacts, importRoot: runtime.paths.imports })
  const result = domain.importLegacyBatch({ sourceSha256, items: report.items }, { kind: 'operator', id: scope.operatorId })
  console.log(JSON.stringify({ applied: true, backup: `${sourceSha256}.json`, ...result }, null, 2))
} finally { db.close() }
