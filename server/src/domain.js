import { createHash, randomUUID } from 'node:crypto'
import { copyFileSync, existsSync, mkdirSync, readFileSync, realpathSync, statSync, writeFileSync } from 'node:fs'
import { basename, extname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { conflict, DomainError, invalidState, notFound } from './errors.js'

const json = (value) => JSON.stringify(value ?? null)
const parse = (value, fallback = null) => {
  if (value == null) return fallback
  try {
    return JSON.parse(value)
  } catch {
    return fallback
  }
}
const now = () => new Date().toISOString()

function canonicalize(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(',')}]`
  if (value && typeof value === 'object') {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalize(value[key])}`)
      .join(',')}}`
  }
  return JSON.stringify(value)
}

const requestHash = (value) => createHash('sha256').update(canonicalize(value)).digest('hex')

function rowAccount(row) {
  return {
    id: row.id,
    name: row.name,
    domain: row.domain,
    persona: row.persona,
    tone: row.tone,
    styleName: row.style_name,
    profile: parse(row.profile_json, {}),
    revision: row.revision,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

function rowMaterial(row) {
  return {
    id: row.id,
    accountId: row.account_id,
    type: row.type,
    content: row.content,
    tags: parse(row.tags_json, []),
    artifactId: row.artifact_id,
    revision: row.revision,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

function rowWorkflow(row) {
  return {
    id: row.id,
    accountId: row.account_id,
    state: row.state,
    objective: row.objective,
    selectedTopicId: row.selected_topic_id,
    approvedDraftRevision: row.approved_draft_revision,
    approvedCoverId: row.approved_cover_id,
    version: row.version,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

export class IdeaShuDomain {
  constructor(db, { workspaceId, operatorId, artifactsRoot = null, importRoot = null, onEvent = () => {} }) {
    this.db = db
    this.workspaceId = workspaceId
    this.operatorId = operatorId
    this.artifactsRoot = artifactsRoot
    this.importRoot = importRoot
    this.onEvent = onEvent
  }

  transaction(fn) {
    this.db.exec('BEGIN IMMEDIATE')
    try {
      const result = fn()
      this.db.exec('COMMIT')
      return result
    } catch (error) {
      this.db.exec('ROLLBACK')
      throw error
    }
  }

  assertActorScope(actor, accountId, workflowId = null, { bind = false, requireWorkflow = false } = {}) {
    if (actor?.kind !== 'agent') return
    const row = this.db.prepare('SELECT * FROM agent_runs WHERE workspace_id = ? AND id = ?')
      .get(this.workspaceId, actor.id)
    if (!row) {
      if (!bind) {
        if (requireWorkflow) throw notFound('Agent run')
        return
      }
      this.db.prepare(`INSERT INTO agent_runs(id, workspace_id, account_id, workflow_id, host,
        skill, status, started_at) VALUES (?, ?, ?, ?, 'unknown', NULL, 'running', ?)`)
        .run(actor.id, this.workspaceId, accountId, workflowId, now())
      return
    }
    if (row.account_id !== accountId) throw notFound('Agent-scoped resource')
    if (workflowId) {
      if (row.workflow_id && row.workflow_id !== workflowId) throw notFound('Agent-scoped workflow')
      if (!row.workflow_id && bind) {
        this.db.prepare('UPDATE agent_runs SET workflow_id = ? WHERE workspace_id = ? AND id = ?')
          .run(workflowId, this.workspaceId, actor.id)
      } else if (!row.workflow_id && requireWorkflow) throw notFound('Agent-scoped workflow')
    }
  }

  command({ operation, idempotencyKey, request, actor, accountId = null, workflowId = null }, execute) {
    if (!idempotencyKey || typeof idempotencyKey !== 'string') {
      throw new DomainError('IDEMPOTENCY_KEY_REQUIRED', 'A non-empty idempotencyKey is required', 400)
    }
    const actorKind = actor?.kind || 'operator'
    const actorId = actor?.id || this.operatorId
    const hash = requestHash(request)
    let emitted = null
    const result = this.transaction(() => {
      const prior = this.db
        .prepare(`SELECT request_sha256, response_json FROM idempotency_records
          WHERE workspace_id = ? AND actor_kind = ? AND actor_id = ? AND operation = ? AND idempotency_key = ?`)
        .get(this.workspaceId, actorKind, actorId, operation, idempotencyKey)
      if (prior) {
        if (prior.request_sha256 !== hash) {
          throw conflict('IDEMPOTENCY_KEY_REUSED', 'The idempotency key was already used for a different request')
        }
        return parse(prior.response_json)
      }

      const response = execute()
      const timestamp = now()
      const event = {
        eventId: randomUUID(),
        workspaceId: this.workspaceId,
        accountId,
        workflowId,
        actorKind,
        actorId,
        eventType: operation,
        entityType: response?.entityType || operation,
        entityId: response?.id || workflowId || accountId || this.workspaceId,
        entityRevision: response?.version || response?.revision || null,
        payload: response?.audit || {},
        createdAt: timestamp,
      }
      const auditResult = this.db.prepare(`INSERT INTO audit_events(
        event_id, workspace_id, account_id, workflow_id, actor_kind, actor_id,
        event_type, entity_type, entity_id, entity_revision, payload_json, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(event.eventId, event.workspaceId, event.accountId, event.workflowId, event.actorKind,
          event.actorId, event.eventType, event.entityType, event.entityId,
          event.entityRevision, json(event.payload), event.createdAt)
      emitted = { ...event, sequence: Number(auditResult.lastInsertRowid) }
      const cleanResponse = { ...response }
      delete cleanResponse.entityType
      delete cleanResponse.audit
      this.db.prepare(`INSERT INTO idempotency_records(
        workspace_id, actor_kind, actor_id, operation, idempotency_key,
        request_sha256, response_status, response_json, created_at, expires_at
      ) VALUES (?, ?, ?, ?, ?, ?, 200, ?, ?, ?)`)
        .run(this.workspaceId, actorKind, actorId, operation, idempotencyKey,
          hash, json(cleanResponse), timestamp, '9999-12-31T23:59:59.999Z')
      return cleanResponse
    })
    if (emitted) this.onEvent(emitted)
    return result
  }

  listAccounts() {
    return this.db
      .prepare('SELECT * FROM content_accounts WHERE workspace_id = ? AND deleted_at IS NULL ORDER BY updated_at DESC')
      .all(this.workspaceId)
      .map(rowAccount)
  }

  getAccount(accountId) {
    const row = this.db
      .prepare('SELECT * FROM content_accounts WHERE workspace_id = ? AND id = ? AND deleted_at IS NULL')
      .get(this.workspaceId, accountId)
    if (!row) throw notFound('Account')
    return rowAccount(row)
  }

  createAccount(input, actor) {
    if (actor?.kind !== 'operator') throw new DomainError('OPERATOR_REQUIRED', 'Only the local operator can create an account', 403)
    return this.command({ operation: 'account.created', idempotencyKey: input.idempotencyKey, request: input, actor }, () => {
      const id = randomUUID()
      const timestamp = now()
      this.db.prepare(`INSERT INTO content_accounts(
        id, workspace_id, name, domain, persona, tone, style_name, profile_json,
        revision, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`)
        .run(id, this.workspaceId, input.name.trim(), input.domain || '', input.persona || '',
          input.tone || '', input.styleName || '', json(input.profile || {}), timestamp, timestamp)
      return { ...this.getAccount(id), entityType: 'account', audit: { name: input.name.trim() } }
    })
  }

  updateAccount(accountId, input, actor) {
    if (actor?.kind !== 'operator') throw new DomainError('OPERATOR_REQUIRED', 'Only the local operator can update an account', 403)
    this.getAccount(accountId)
    return this.command({ operation: 'account.updated', idempotencyKey: input.idempotencyKey, request: input, actor, accountId }, () => {
      const current = this.getAccount(accountId)
      if (input.expectedRevision !== current.revision) {
        throw conflict('REVISION_CONFLICT', 'Account changed since it was loaded', { expected: input.expectedRevision, actual: current.revision })
      }
      const next = {
        name: input.name ?? current.name,
        domain: input.domain ?? current.domain,
        persona: input.persona ?? current.persona,
        tone: input.tone ?? current.tone,
        styleName: input.styleName ?? current.styleName,
        profile: input.profile ?? current.profile,
      }
      this.db.prepare(`UPDATE content_accounts SET name = ?, domain = ?, persona = ?, tone = ?,
        style_name = ?, profile_json = ?, revision = revision + 1, updated_at = ?
        WHERE workspace_id = ? AND id = ? AND revision = ? AND deleted_at IS NULL`)
        .run(next.name, next.domain, next.persona, next.tone, next.styleName, json(next.profile),
          now(), this.workspaceId, accountId, current.revision)
      return { ...this.getAccount(accountId), entityType: 'account', audit: { fields: Object.keys(input).filter((k) => !['idempotencyKey', 'expectedRevision'].includes(k)) } }
    })
  }

  deleteAccount(accountId, input, actor) {
    if (actor?.kind !== 'operator') throw new DomainError('OPERATOR_REQUIRED', 'Only the local operator can delete an account', 403)
    this.getAccount(accountId)
    return this.command({ operation: 'account.deleted', idempotencyKey: input.idempotencyKey, request: input, actor, accountId }, () => {
      const current = this.getAccount(accountId)
      if (input.expectedRevision !== current.revision) throw conflict('REVISION_CONFLICT', 'Account changed since it was loaded')
      this.db.prepare('UPDATE content_accounts SET deleted_at = ?, updated_at = ?, revision = revision + 1 WHERE workspace_id = ? AND id = ?')
        .run(now(), now(), this.workspaceId, accountId)
      return { id: accountId, deleted: true, entityType: 'account' }
    })
  }

  listMaterials(accountId, query = '') {
    this.getAccount(accountId)
    const wildcard = `%${query}%`
    return this.db.prepare(`SELECT * FROM materials WHERE workspace_id = ? AND account_id = ?
      AND deleted_at IS NULL AND (? = '' OR content LIKE ?) ORDER BY updated_at DESC`)
      .all(this.workspaceId, accountId, query, wildcard)
      .map(rowMaterial)
  }

  createMaterial(accountId, input, actor) {
    this.getAccount(accountId)
    return this.command({ operation: 'material.created', idempotencyKey: input.idempotencyKey, request: input, actor, accountId }, () => {
      this.assertActorScope(actor, accountId, null, { bind: true })
      const id = randomUUID()
      const timestamp = now()
      this.db.prepare(`INSERT INTO materials(id, workspace_id, account_id, type, content,
        tags_json, artifact_id, revision, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`)
        .run(id, this.workspaceId, accountId, input.type, input.content || '', json(input.tags || []), input.artifactId || null, timestamp, timestamp)
      const row = this.db.prepare('SELECT * FROM materials WHERE workspace_id = ? AND account_id = ? AND id = ?').get(this.workspaceId, accountId, id)
      return { ...rowMaterial(row), entityType: 'material', audit: { type: input.type } }
    })
  }

  importLegacyBatch(input, actor) {
    const accounts = [...new Set(input.items.map((item) => item.accountId))]
    for (const accountId of accounts) this.getAccount(accountId)
    return this.command({
      operation: 'legacy.imported',
      idempotencyKey: `legacy-${input.sourceSha256}`,
      request: input,
      actor,
    }, () => {
      let imported = 0
      let deduplicated = 0
      const byAccount = {}
      for (const item of input.items) {
        let artifactId = null
        let imageSha = null
        if (item.image) {
          const bytes = Buffer.from(item.image.base64, 'base64')
          imageSha = createHash('sha256').update(bytes).digest('hex')
          artifactId = this.storeGeneratedArtifact(item.accountId, 'material_image', bytes, item.image.extension, item.image.mimeType, { source: 'legacy-import' })
        }
        const fingerprint = createHash('sha256').update(canonicalize({ accountId: item.accountId, type: item.type, content: item.content, tags: item.tags, imageSha })).digest('hex')
        const hex = fingerprint.slice(0, 32)
        const id = `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`
        const timestamp = item.createdAt || now()
        const existing = this.db.prepare('SELECT id FROM materials WHERE workspace_id = ? AND account_id = ? AND id = ?')
          .get(this.workspaceId, item.accountId, id)
        if (existing) deduplicated += 1
        else {
          this.db.prepare(`INSERT INTO materials(id, workspace_id, account_id, type,
            content, tags_json, artifact_id, revision, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`)
            .run(id, this.workspaceId, item.accountId, item.type, item.content || '', json(item.tags || []), artifactId, timestamp, timestamp)
          imported += 1
        }
        byAccount[item.accountId] = (byAccount[item.accountId] || 0) + 1
      }
      return { id: input.sourceSha256, imported, deduplicated, byAccount, entityType: 'legacy_import', audit: { imported, deduplicated, byAccount } }
    })
  }

  importArtifact(accountId, input, actor) {
    this.getAccount(accountId)
    if (!this.importRoot || !this.artifactsRoot) throw new DomainError('ARTIFACT_STORE_UNAVAILABLE', 'Artifact store is not configured', 503)
    if (!isAbsolute(input.path)) throw new DomainError('INVALID_IMPORT_PATH', 'Import path must be absolute', 400)
    const importBase = realpathSync(this.importRoot)
    const source = realpathSync(input.path)
    const rel = relative(importBase, source)
    if (!rel || rel.startsWith(`..${sep}`) || rel === '..' || isAbsolute(rel)) {
      throw new DomainError('IMPORT_PATH_REJECTED', 'File must be inside the configured .ideashu/imports directory', 400)
    }
    const stats = statSync(source)
    if (!stats.isFile() || stats.size > 20 * 1024 * 1024) throw new DomainError('ARTIFACT_SIZE_REJECTED', 'Artifact must be a file no larger than 20 MB', 400)
    const bytes = readFileSync(source)
    const extension = extname(source).toLowerCase()
    const signatures = {
      '.png': bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])),
      '.jpg': bytes[0] === 0xff && bytes[1] === 0xd8,
      '.jpeg': bytes[0] === 0xff && bytes[1] === 0xd8,
      '.webp': bytes.subarray(0, 4).toString() === 'RIFF' && bytes.subarray(8, 12).toString() === 'WEBP',
      '.svg': bytes.subarray(0, 4096).toString('utf8').includes('<svg'),
    }
    if (!signatures[extension]) throw new DomainError('ARTIFACT_TYPE_REJECTED', 'Only valid PNG, JPEG, WebP, and SVG files are accepted', 400)
    const mime = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.svg': 'image/svg+xml' }[extension]
    const sha256 = createHash('sha256').update(bytes).digest('hex')
    const targetRelative = join(accountId, sha256.slice(0, 2), `${sha256}${extension === '.jpeg' ? '.jpg' : extension}`)
    const target = resolve(this.artifactsRoot, targetRelative)
    const targetRelCheck = relative(resolve(this.artifactsRoot), target)
    if (targetRelCheck.startsWith('..') || isAbsolute(targetRelCheck)) throw new DomainError('ARTIFACT_PATH_REJECTED', 'Artifact target escaped the store', 400)
    mkdirSync(resolve(target, '..'), { recursive: true })
    let copied = false
    try {
      if (!existsSync(target)) {
        copyFileSync(source, target)
        copied = true
      }
      return this.command({ operation: 'artifact.imported', idempotencyKey: input.idempotencyKey, request: { ...input, path: basename(source), sha256 }, actor, accountId }, () => {
        this.assertActorScope(actor, accountId, null, { bind: true })
        const existing = this.db.prepare('SELECT * FROM artifacts WHERE workspace_id = ? AND account_id = ? AND sha256 = ?')
          .get(this.workspaceId, accountId, sha256)
        if (existing) return { id: existing.id, accountId, kind: existing.kind, mimeType: existing.mime_type, byteSize: existing.byte_size, sha256, entityType: 'artifact' }
        const id = randomUUID()
        this.db.prepare(`INSERT INTO artifacts(id, workspace_id, account_id, kind, mime_type,
          byte_size, sha256, relative_path, metadata_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
          .run(id, this.workspaceId, accountId, input.kind, mime, stats.size, sha256, targetRelative, json({ originalName: basename(source) }), now())
        return { id, accountId, kind: input.kind, mimeType: mime, byteSize: stats.size, sha256, entityType: 'artifact', audit: { kind: input.kind, byteSize: stats.size, sha256 } }
      })
    } catch (error) {
      if (copied) {
        // A content-addressed orphan is harmless and doctor can report it; preserve it if cleanup is unavailable.
      }
      throw error
    }
  }

  getArtifact(accountId, artifactId) {
    this.getAccount(accountId)
    const row = this.db.prepare('SELECT * FROM artifacts WHERE workspace_id = ? AND account_id = ? AND id = ?')
      .get(this.workspaceId, accountId, artifactId)
    if (!row) throw notFound('Artifact')
    const path = resolve(this.artifactsRoot, row.relative_path)
    const rel = relative(resolve(this.artifactsRoot), path)
    if (rel.startsWith('..') || isAbsolute(rel) || !existsSync(path)) throw notFound('Artifact file')
    return { id: row.id, path, mimeType: row.mime_type, byteSize: row.byte_size, sha256: row.sha256 }
  }

  storeGeneratedArtifact(accountId, kind, bytes, extension, mimeType, metadata = {}) {
    const sha256 = createHash('sha256').update(bytes).digest('hex')
    const existing = this.db.prepare('SELECT id FROM artifacts WHERE workspace_id = ? AND account_id = ? AND sha256 = ?')
      .get(this.workspaceId, accountId, sha256)
    if (existing) return existing.id
    const targetRelative = join(accountId, sha256.slice(0, 2), `${sha256}.${extension}`)
    const target = resolve(this.artifactsRoot, targetRelative)
    mkdirSync(resolve(target, '..'), { recursive: true })
    writeFileSync(target, bytes)
    const id = randomUUID()
    this.db.prepare(`INSERT INTO artifacts(id, workspace_id, account_id, kind, mime_type,
      byte_size, sha256, relative_path, metadata_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(id, this.workspaceId, accountId, kind, mimeType, bytes.length, sha256, targetRelative, json(metadata), now())
    return id
  }

  renderCoverSvg(accountId, composition, backgroundArtifactId = null) {
    const escapeXml = (value) => String(value || '').replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[character])
    const width = composition.width || 1080
    const height = composition.height || 1440
    const margin = composition.safeMargin || 96
    const align = composition.align === 'center' ? 'middle' : 'start'
    const x = composition.align === 'center' ? width / 2 : margin
    const title = String(composition.title || '')
    const chars = Array.from(title)
    const lines = []
    for (let index = 0; index < chars.length; index += 10) lines.push(chars.slice(index, index + 10).join(''))
    let background = `<defs><linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#162d37"/><stop offset="0.58" stop-color="#315f52"/><stop offset="1" stop-color="#d5b98c"/></linearGradient></defs><rect width="100%" height="100%" fill="url(#bg)"/>`
    if (backgroundArtifactId) {
      const artifact = this.getArtifact(accountId, backgroundArtifactId)
      const data = readFileSync(artifact.path).toString('base64')
      background = `<image width="100%" height="100%" preserveAspectRatio="xMidYMid slice" href="data:${artifact.mimeType};base64,${data}"/><rect width="100%" height="100%" fill="#09151b" opacity="0.32"/>`
    }
    const startY = Math.round(height * 0.43)
    const titleSize = Math.max(44, Math.round(width * 0.075))
    const subtitleY = startY + Math.max(1, lines.length) * Math.round(titleSize * 1.22) + 38
    const titleLines = lines.map((line, index) => `<tspan x="${x}" dy="${index === 0 ? 0 : Math.round(titleSize * 1.22)}">${escapeXml(line)}</tspan>`).join('')
    return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">${background}<rect x="${margin}" y="${margin}" width="${width - margin * 2}" height="${height - margin * 2}" fill="none" stroke="#ffffff" opacity="0.18"/><text x="${x}" y="${startY}" text-anchor="${align}" fill="${escapeXml(composition.titleColor || '#fffaf0')}" font-family="Noto Sans CJK SC,Microsoft YaHei,sans-serif" font-size="${titleSize}" font-weight="800">${titleLines}</text><text x="${x}" y="${subtitleY}" text-anchor="${align}" fill="#ffffff" opacity="0.82" font-family="Noto Sans CJK SC,Microsoft YaHei,sans-serif" font-size="${Math.round(titleSize * 0.34)}">${escapeXml(composition.subtitle || '')}</text><rect x="${composition.align === 'center' ? x - 58 : margin}" y="${subtitleY + 42}" width="116" height="10" fill="${escapeXml(composition.accentColor || '#ff6b35')}"/><text x="${margin}" y="${height - margin}" fill="#ffffff" opacity="0.7" font-family="Arial,sans-serif" font-size="18" letter-spacing="5">IDEASHU · LOCAL COMPOSITION</text></svg>`, 'utf8')
  }

  listWorkflows(accountId) {
    this.getAccount(accountId)
    return this.db.prepare('SELECT * FROM workflow_runs WHERE workspace_id = ? AND account_id = ? ORDER BY updated_at DESC')
      .all(this.workspaceId, accountId).map(rowWorkflow)
  }

  requireWorkflow(accountId, workflowId) {
    const row = this.db.prepare('SELECT * FROM workflow_runs WHERE workspace_id = ? AND account_id = ? AND id = ?')
      .get(this.workspaceId, accountId, workflowId)
    if (!row) throw notFound('Workflow')
    return row
  }

  createWorkflow(accountId, input, actor) {
    this.getAccount(accountId)
    return this.command({ operation: 'workflow.created', idempotencyKey: input.idempotencyKey, request: input, actor, accountId }, () => {
      const id = randomUUID()
      const timestamp = now()
      this.db.prepare(`INSERT INTO workflow_runs(id, workspace_id, account_id, state, objective,
        version, created_by, created_at, updated_at) VALUES (?, ?, ?, 'collecting', ?, 1, ?, ?, ?)`)
        .run(id, this.workspaceId, accountId, input.objective || '', actor?.id || this.operatorId, timestamp, timestamp)
      this.assertActorScope(actor, accountId, id, { bind: true })
      return { ...rowWorkflow(this.requireWorkflow(accountId, id)), entityType: 'workflow', audit: { objective: input.objective || '' } }
    })
  }

  workflowSnapshot(accountId, workflowId) {
    const workflow = rowWorkflow(this.requireWorkflow(accountId, workflowId))
    const topics = this.db.prepare('SELECT * FROM topic_candidates WHERE workspace_id = ? AND account_id = ? AND workflow_id = ? ORDER BY created_at')
      .all(this.workspaceId, accountId, workflowId).map((row) => ({
        id: row.id, title: row.title, angle: row.angle, rationale: row.rationale,
        evidence: parse(row.evidence_json, []), score: parse(row.score_json, {}), createdAt: row.created_at,
      }))
    const draftRow = this.db.prepare('SELECT * FROM drafts WHERE workspace_id = ? AND account_id = ? AND workflow_id = ?')
      .get(this.workspaceId, accountId, workflowId)
    let draft = null
    let reviews = []
    if (draftRow) {
      const revisions = this.db.prepare('SELECT * FROM draft_revisions WHERE workspace_id = ? AND account_id = ? AND draft_id = ? ORDER BY revision')
        .all(this.workspaceId, accountId, draftRow.id).map((row) => ({
          draftId: row.draft_id, revision: row.revision, title: row.title, body: row.body,
          tags: parse(row.tags_json, []), materialAnchors: parse(row.material_anchors_json, []),
          changeSummary: row.change_summary, createdBy: row.created_by, createdAt: row.created_at,
        }))
      draft = { id: draftRow.id, currentRevision: draftRow.current_revision, revisions }
      reviews = this.db.prepare('SELECT * FROM review_reports WHERE workspace_id = ? AND account_id = ? AND workflow_id = ? ORDER BY created_at')
        .all(this.workspaceId, accountId, workflowId).map((row) => ({
          id: row.id, draftId: row.draft_id, draftRevision: row.draft_revision, decision: row.decision,
          scores: parse(row.scores_json, {}), requiredChanges: parse(row.required_changes_json, []),
          optionalSuggestions: parse(row.optional_suggestions_json, []), evidenceGaps: parse(row.evidence_gaps_json, []), createdAt: row.created_at,
        }))
    }
    const covers = this.db.prepare('SELECT * FROM cover_variants WHERE workspace_id = ? AND account_id = ? AND workflow_id = ? ORDER BY created_at')
      .all(this.workspaceId, accountId, workflowId).map((row) => ({
        id: row.id, draftId: row.draft_id, draftRevision: row.draft_revision,
        brief: parse(row.brief_json, {}), composition: parse(row.composition_json, {}),
        backgroundArtifactId: row.background_artifact_id, renderedArtifactId: row.rendered_artifact_id,
        qa: parse(row.qa_json, {}), status: row.status, createdAt: row.created_at,
      }))
    const packageRow = this.db.prepare('SELECT * FROM publish_packages WHERE workspace_id = ? AND account_id = ? AND workflow_id = ?')
      .get(this.workspaceId, accountId, workflowId)
    const publishPackage = packageRow ? {
      id: packageRow.id, draftId: packageRow.draft_id, draftRevision: packageRow.draft_revision,
      coverId: packageRow.cover_id, manifest: parse(packageRow.manifest_json, {}), createdAt: packageRow.created_at,
    } : null
    return { workflow, topics, draft, reviews, covers, publishPackage }
  }

  assertVersion(row, expected) {
    if (row.version !== expected) throw conflict('REVISION_CONFLICT', 'Workflow changed since it was loaded', { expected, actual: row.version })
  }

  submitTopics(accountId, workflowId, input, actor) {
    const run = this.requireWorkflow(accountId, workflowId)
    return this.command({ operation: 'topics.submitted', idempotencyKey: input.idempotencyKey, request: input, actor, accountId, workflowId }, () => {
      this.assertActorScope(actor, accountId, workflowId, { bind: true })
      const current = this.requireWorkflow(accountId, workflowId)
      this.assertVersion(current, input.expectedWorkflowVersion)
      if (!['collecting', 'topic_ready'].includes(current.state)) throw invalidState(current.state, ['collecting', 'topic_ready'])
      if (!Array.isArray(input.topics) || input.topics.length === 0) throw new DomainError('VALIDATION_ERROR', 'At least one topic is required')
      for (const topic of input.topics) {
        this.db.prepare(`INSERT INTO topic_candidates(id, workspace_id, account_id, workflow_id,
          title, angle, rationale, evidence_json, score_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
          .run(randomUUID(), this.workspaceId, accountId, workflowId, topic.title, topic.angle || '',
            topic.rationale || '', json(topic.evidence || []), json(topic.score || {}), now())
      }
      this.db.prepare("UPDATE workflow_runs SET state = 'topic_ready', version = version + 1, updated_at = ? WHERE workspace_id = ? AND account_id = ? AND id = ?")
        .run(now(), this.workspaceId, accountId, workflowId)
      const response = rowWorkflow(this.requireWorkflow(accountId, workflowId))
      return { ...response, entityType: 'workflow', audit: { topicCount: input.topics.length } }
    })
  }

  approveTopic(accountId, workflowId, input, actor) {
    if (actor?.kind !== 'operator') throw new DomainError('OPERATOR_REQUIRED', 'Only the local operator can approve a topic', 403)
    return this.command({ operation: 'topic.approved', idempotencyKey: input.idempotencyKey, request: input, actor, accountId, workflowId }, () => {
      const run = this.requireWorkflow(accountId, workflowId)
      this.assertVersion(run, input.expectedWorkflowVersion)
      if (run.state !== 'topic_ready') throw invalidState(run.state, ['topic_ready'])
      const topic = this.db.prepare('SELECT id FROM topic_candidates WHERE workspace_id = ? AND account_id = ? AND workflow_id = ? AND id = ?')
        .get(this.workspaceId, accountId, workflowId, input.topicId)
      if (!topic) throw notFound('Topic')
      this.db.prepare("UPDATE workflow_runs SET state = 'topic_approved', selected_topic_id = ?, version = version + 1, updated_at = ? WHERE workspace_id = ? AND account_id = ? AND id = ?")
        .run(input.topicId, now(), this.workspaceId, accountId, workflowId)
      return { ...rowWorkflow(this.requireWorkflow(accountId, workflowId)), entityType: 'workflow', audit: { topicId: input.topicId } }
    })
  }

  createDraftRevision(accountId, workflowId, input, actor) {
    return this.command({ operation: 'draft.revision_created', idempotencyKey: input.idempotencyKey, request: input, actor, accountId, workflowId }, () => {
      this.assertActorScope(actor, accountId, workflowId, { bind: true })
      const run = this.requireWorkflow(accountId, workflowId)
      this.assertVersion(run, input.expectedWorkflowVersion)
      if (!['topic_approved', 'drafting', 'draft_review', 'draft_approved', 'covering'].includes(run.state)) {
        throw invalidState(run.state, ['topic_approved', 'draft_review'])
      }
      let draft = this.db.prepare('SELECT * FROM drafts WHERE workspace_id = ? AND account_id = ? AND workflow_id = ?')
        .get(this.workspaceId, accountId, workflowId)
      if (!draft) {
        const draftId = randomUUID()
        this.db.prepare(`INSERT INTO drafts(id, workspace_id, account_id, workflow_id, current_revision, created_at, updated_at)
          VALUES (?, ?, ?, ?, 0, ?, ?)`)
          .run(draftId, this.workspaceId, accountId, workflowId, now(), now())
        draft = this.db.prepare('SELECT * FROM drafts WHERE workspace_id = ? AND account_id = ? AND id = ?').get(this.workspaceId, accountId, draftId)
      }
      const expectedDraft = input.expectedDraftRevision ?? 0
      if (draft.current_revision !== expectedDraft) {
        throw conflict('REVISION_CONFLICT', 'Draft changed since it was loaded', { expected: expectedDraft, actual: draft.current_revision })
      }
      const revision = draft.current_revision + 1
      this.db.prepare(`INSERT INTO draft_revisions(draft_id, workspace_id, account_id, revision, title,
        body, tags_json, material_anchors_json, change_summary, created_by, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(draft.id, this.workspaceId, accountId, revision, input.title, input.body,
          json(input.tags || []), json(input.materialAnchors || []), input.changeSummary || '', actor?.id || this.operatorId, now())
      this.db.prepare('UPDATE drafts SET current_revision = ?, updated_at = ? WHERE workspace_id = ? AND account_id = ? AND id = ?')
        .run(revision, now(), this.workspaceId, accountId, draft.id)
      this.db.prepare(`UPDATE workflow_runs SET state = 'draft_review', approved_draft_revision = NULL,
        approved_cover_id = NULL, version = version + 1, updated_at = ? WHERE workspace_id = ? AND account_id = ? AND id = ?`)
        .run(now(), this.workspaceId, accountId, workflowId)
      return { id: draft.id, revision, workflow: rowWorkflow(this.requireWorkflow(accountId, workflowId)), entityType: 'draft', audit: { revision } }
    })
  }

  submitReview(accountId, workflowId, input, actor) {
    return this.command({ operation: 'review.submitted', idempotencyKey: input.idempotencyKey, request: input, actor, accountId, workflowId }, () => {
      this.assertActorScope(actor, accountId, workflowId, { bind: true })
      const run = this.requireWorkflow(accountId, workflowId)
      this.assertVersion(run, input.expectedWorkflowVersion)
      if (run.state !== 'draft_review') throw invalidState(run.state, ['draft_review'])
      const draft = this.db.prepare('SELECT * FROM drafts WHERE workspace_id = ? AND account_id = ? AND workflow_id = ?').get(this.workspaceId, accountId, workflowId)
      if (!draft || draft.current_revision !== input.draftRevision) throw conflict('REVISION_CONFLICT', 'Review must target the latest draft revision')
      const id = randomUUID()
      this.db.prepare(`INSERT INTO review_reports(id, workspace_id, account_id, workflow_id, draft_id,
        draft_revision, decision, scores_json, required_changes_json, optional_suggestions_json,
        evidence_gaps_json, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(id, this.workspaceId, accountId, workflowId, draft.id, input.draftRevision, input.decision,
          json(input.scores || {}), json(input.requiredChanges || []), json(input.optionalSuggestions || []),
          json(input.evidenceGaps || []), actor?.id || this.operatorId, now())
      this.db.prepare('UPDATE workflow_runs SET version = version + 1, updated_at = ? WHERE workspace_id = ? AND account_id = ? AND id = ?')
        .run(now(), this.workspaceId, accountId, workflowId)
      return { id, decision: input.decision, draftRevision: input.draftRevision,
        workflow: rowWorkflow(this.requireWorkflow(accountId, workflowId)), entityType: 'review', audit: { decision: input.decision, draftRevision: input.draftRevision } }
    })
  }

  approveDraft(accountId, workflowId, input, actor) {
    if (actor?.kind !== 'operator') throw new DomainError('OPERATOR_REQUIRED', 'Only the local operator can approve a draft', 403)
    return this.command({ operation: 'draft.approved', idempotencyKey: input.idempotencyKey, request: input, actor, accountId, workflowId }, () => {
      const run = this.requireWorkflow(accountId, workflowId)
      this.assertVersion(run, input.expectedWorkflowVersion)
      if (run.state !== 'draft_review') throw invalidState(run.state, ['draft_review'])
      const draft = this.db.prepare('SELECT * FROM drafts WHERE workspace_id = ? AND account_id = ? AND workflow_id = ?').get(this.workspaceId, accountId, workflowId)
      if (!draft || draft.current_revision !== input.draftRevision) throw conflict('REVISION_CONFLICT', 'Approval must target the latest draft revision')
      const passed = this.db.prepare(`SELECT id FROM review_reports WHERE workspace_id = ? AND account_id = ?
        AND workflow_id = ? AND draft_id = ? AND draft_revision = ? AND decision = 'pass' ORDER BY created_at DESC LIMIT 1`)
        .get(this.workspaceId, accountId, workflowId, draft.id, input.draftRevision)
      if (!passed) throw conflict('REVIEW_REQUIRED', 'A passing review for this exact revision is required')
      this.db.prepare("UPDATE workflow_runs SET state = 'draft_approved', approved_draft_revision = ?, version = version + 1, updated_at = ? WHERE workspace_id = ? AND account_id = ? AND id = ?")
        .run(input.draftRevision, now(), this.workspaceId, accountId, workflowId)
      return { ...rowWorkflow(this.requireWorkflow(accountId, workflowId)), entityType: 'workflow', audit: { draftRevision: input.draftRevision } }
    })
  }

  createCover(accountId, workflowId, input, actor) {
    return this.command({ operation: 'cover.created', idempotencyKey: input.idempotencyKey, request: input, actor, accountId, workflowId }, () => {
      this.assertActorScope(actor, accountId, workflowId, { bind: true })
      const run = this.requireWorkflow(accountId, workflowId)
      this.assertVersion(run, input.expectedWorkflowVersion)
      if (!['draft_approved', 'covering'].includes(run.state)) throw invalidState(run.state, ['draft_approved', 'covering'])
      if (run.approved_draft_revision !== input.draftRevision) throw conflict('REVISION_CONFLICT', 'Cover must target the approved draft revision')
      const draft = this.db.prepare('SELECT * FROM drafts WHERE workspace_id = ? AND account_id = ? AND workflow_id = ?').get(this.workspaceId, accountId, workflowId)
      if (!draft) throw notFound('Draft')
      const qa = input.qa || { passed: false, checks: [], note: '等待视觉 QA' }
      const generatedSvg = input.renderedArtifactId ? null : this.renderCoverSvg(accountId, input.composition, input.backgroundArtifactId || null)
      const renderedArtifactId = input.renderedArtifactId || this.storeGeneratedArtifact(accountId, 'cover_render', generatedSvg, 'svg', 'image/svg+xml', { renderer: 'ideashu-svg-v1', composition: input.composition })
      const status = qa.passed ? 'qa_passed' : 'qa_failed'
      const id = randomUUID()
      this.db.prepare(`INSERT INTO cover_variants(id, workspace_id, account_id, workflow_id, draft_id,
        draft_revision, brief_json, composition_json, background_artifact_id, rendered_artifact_id,
        qa_json, status, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(id, this.workspaceId, accountId, workflowId, draft.id, input.draftRevision,
          json(input.brief || {}), json(input.composition || {}), input.backgroundArtifactId || null,
          renderedArtifactId, json(qa), status, actor?.id || this.operatorId, now())
      this.db.prepare("UPDATE workflow_runs SET state = 'covering', version = version + 1, updated_at = ? WHERE workspace_id = ? AND account_id = ? AND id = ?")
        .run(now(), this.workspaceId, accountId, workflowId)
      return { id, status, workflow: rowWorkflow(this.requireWorkflow(accountId, workflowId)), entityType: 'cover', audit: { draftRevision: input.draftRevision, status } }
    })
  }

  approveCover(accountId, workflowId, input, actor) {
    if (actor?.kind !== 'operator') throw new DomainError('OPERATOR_REQUIRED', 'Only the local operator can approve a cover', 403)
    return this.command({ operation: 'cover.approved', idempotencyKey: input.idempotencyKey, request: input, actor, accountId, workflowId }, () => {
      const run = this.requireWorkflow(accountId, workflowId)
      this.assertVersion(run, input.expectedWorkflowVersion)
      if (run.state !== 'covering') throw invalidState(run.state, ['covering'])
      const cover = this.db.prepare(`SELECT * FROM cover_variants WHERE workspace_id = ? AND account_id = ?
        AND workflow_id = ? AND id = ? AND status = 'qa_passed'`).get(this.workspaceId, accountId, workflowId, input.coverId)
      if (!cover) throw conflict('COVER_QA_REQUIRED', 'A QA-passed cover is required')
      if (cover.draft_revision !== run.approved_draft_revision) throw conflict('REVISION_CONFLICT', 'Cover no longer matches the approved draft')
      this.db.prepare("UPDATE workflow_runs SET state = 'cover_approved', approved_cover_id = ?, version = version + 1, updated_at = ? WHERE workspace_id = ? AND account_id = ? AND id = ?")
        .run(input.coverId, now(), this.workspaceId, accountId, workflowId)
      return { ...rowWorkflow(this.requireWorkflow(accountId, workflowId)), entityType: 'workflow', audit: { coverId: input.coverId } }
    })
  }

  buildPackage(accountId, workflowId, input, actor) {
    if (actor?.kind !== 'operator') throw new DomainError('OPERATOR_REQUIRED', 'Only the local operator can build a publish package', 403)
    return this.command({ operation: 'package.created', idempotencyKey: input.idempotencyKey, request: input, actor, accountId, workflowId }, () => {
      const run = this.requireWorkflow(accountId, workflowId)
      this.assertVersion(run, input.expectedWorkflowVersion)
      if (run.state !== 'cover_approved') throw invalidState(run.state, ['cover_approved'])
      const draft = this.db.prepare('SELECT * FROM drafts WHERE workspace_id = ? AND account_id = ? AND workflow_id = ?').get(this.workspaceId, accountId, workflowId)
      const cover = this.db.prepare('SELECT * FROM cover_variants WHERE workspace_id = ? AND account_id = ? AND workflow_id = ? AND id = ?')
        .get(this.workspaceId, accountId, workflowId, run.approved_cover_id)
      if (!draft || !cover || cover.draft_revision !== run.approved_draft_revision) throw conflict('REVISION_CONFLICT', 'Package inputs are inconsistent')
      const id = randomUUID()
      const manifest = { workflowId, accountId, draftId: draft.id, draftRevision: run.approved_draft_revision, coverId: cover.id }
      this.db.prepare(`INSERT INTO publish_packages(id, workspace_id, account_id, workflow_id,
        draft_id, draft_revision, cover_id, manifest_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(id, this.workspaceId, accountId, workflowId, draft.id, run.approved_draft_revision, cover.id, json(manifest), now())
      this.db.prepare("UPDATE workflow_runs SET state = 'packaged', version = version + 1, updated_at = ? WHERE workspace_id = ? AND account_id = ? AND id = ?")
        .run(now(), this.workspaceId, accountId, workflowId)
      return { id, manifest, workflow: rowWorkflow(this.requireWorkflow(accountId, workflowId)), entityType: 'package', audit: manifest }
    })
  }

  listWorks(accountId) {
    this.getAccount(accountId)
    return this.db.prepare(`SELECT p.*, dr.title, dr.body, dr.tags_json, c.rendered_artifact_id FROM publish_packages p
      JOIN draft_revisions dr ON dr.draft_id = p.draft_id AND dr.revision = p.draft_revision
      JOIN cover_variants c ON c.workspace_id = p.workspace_id AND c.account_id = p.account_id AND c.id = p.cover_id
      WHERE p.workspace_id = ? AND p.account_id = ? ORDER BY p.created_at DESC`)
      .all(this.workspaceId, accountId).map((row) => ({
        id: row.id, accountId: row.account_id, workflowId: row.workflow_id, title: row.title, body: row.body,
        tags: parse(row.tags_json, []), draftRevision: row.draft_revision,
        coverId: row.cover_id, renderedArtifactId: row.rendered_artifact_id, manifest: parse(row.manifest_json, {}), createdAt: row.created_at,
      }))
  }

  auditEvents({ accountId = null, after = 0, limit = 200 } = {}) {
    const rows = accountId
      ? this.db.prepare(`SELECT * FROM audit_events WHERE workspace_id = ? AND account_id = ? AND sequence > ? ORDER BY sequence LIMIT ?`)
        .all(this.workspaceId, accountId, Number(after), Number(limit))
      : this.db.prepare(`SELECT * FROM audit_events WHERE workspace_id = ? AND sequence > ? ORDER BY sequence LIMIT ?`)
        .all(this.workspaceId, Number(after), Number(limit))
    return rows.map((row) => ({
      sequence: row.sequence, eventId: row.event_id, accountId: row.account_id,
      workflowId: row.workflow_id, eventType: row.event_type, entityType: row.entity_type,
      entityId: row.entity_id, entityRevision: row.entity_revision, createdAt: row.created_at,
    }))
  }
}
