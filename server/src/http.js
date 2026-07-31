import express from 'express'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { randomUUID, timingSafeEqual } from 'node:crypto'
import { DomainError } from './errors.js'
import {
  accountCreateSchema, accountUpdateSchema, coverApproveSchema, coverCreateSchema,
  draftApproveSchema, draftRevisionSchema, materialCreateSchema, packageSchema,
  parseInput, reviewSchema, topicApproveSchema, topicsSubmitSchema, workflowCreateSchema,
} from './schemas.js'

function safeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false
  const left = Buffer.from(a)
  const right = Buffer.from(b)
  return left.length === right.length && timingSafeEqual(left, right)
}

function readCookie(req, name) {
  const cookies = String(req.headers.cookie || '').split(';')
  for (const cookie of cookies) {
    const [key, ...rest] = cookie.trim().split('=')
    if (key === name) return decodeURIComponent(rest.join('='))
  }
  return null
}

function actorFromRequest(req, tokens, operatorId) {
  const bearer = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '')
  const cookie = readCookie(req, 'ideashu_session')
  const provided = bearer || cookie
  if (safeEqual(provided, tokens.operatorToken)) return { kind: 'operator', id: operatorId }
  if (safeEqual(provided, tokens.mcpToken)) {
    const runId = String(req.headers['x-ideashu-agent-run'] || 'mcp-local')
    return { kind: 'agent', id: runId }
  }
  return null
}

export function createApp({ domain, tokens, operatorId, frontendDist, localOrigin = 'http://127.0.0.1:3210', version = '1.0.0' }) {
  const app = express()
  const allowedOrigins = new Set([localOrigin, 'http://127.0.0.1:5173', 'http://127.0.0.1:4173'])
  app.disable('x-powered-by')
  app.use((req, res, next) => {
    const origin = req.headers.origin
    if (origin && !allowedOrigins.has(origin)) {
      return res.status(403).json({ error: { code: 'ORIGIN_REJECTED', message: 'Origin is not allowed', requestId: randomUUID() } })
    }
    if (origin) {
      res.setHeader('Access-Control-Allow-Origin', origin)
      res.setHeader('Access-Control-Allow-Credentials', 'true')
      res.setHeader('Vary', 'Origin')
    }
    res.setHeader('X-Content-Type-Options', 'nosniff')
    res.setHeader('Referrer-Policy', 'no-referrer')
    res.setHeader('Content-Security-Policy', "default-src 'self'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'")
    if (req.method === 'OPTIONS') {
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, Last-Event-ID, X-IdeaShu-Agent-Run')
      res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PATCH,DELETE,OPTIONS')
      return res.status(204).end()
    }
    next()
  })
  app.use(express.json({ limit: '1mb' }))

  app.get('/api/v1/health', (_req, res) => res.json({ status: 'ok', version, storage: 'sqlite' }))
  app.post('/api/v1/session', (req, res) => {
    const origin = req.headers.origin
    if (!origin || !allowedOrigins.has(origin)) {
      return res.status(403).json({ error: { code: 'ORIGIN_REJECTED', message: 'Session requires an allowed local origin' } })
    }
    res.setHeader('Set-Cookie', `ideashu_session=${encodeURIComponent(tokens.operatorToken)}; HttpOnly; SameSite=Strict; Path=/; Max-Age=86400`)
    res.status(204).end()
  })

  app.use('/api/v1', (req, res, next) => {
    const actor = actorFromRequest(req, tokens, operatorId)
    if (!actor) return res.status(401).json({ error: { code: 'UNAUTHORIZED', message: 'Local authentication is required', requestId: randomUUID() } })
    req.actor = actor
    next()
  })

  const wrap = (handler) => (req, res, next) => {
    try {
      const result = handler(req, res)
      if (result !== undefined && !res.headersSent) res.json(result)
    } catch (error) {
      next(error)
    }
  }

  app.get('/api/v1/accounts', wrap(() => domain.listAccounts()))
  app.post('/api/v1/accounts', wrap((req) => domain.createAccount(parseInput(accountCreateSchema, req.body), req.actor)))
  app.get('/api/v1/accounts/:accountId', wrap((req) => { domain.assertActorScope(req.actor, req.params.accountId); return domain.getAccount(req.params.accountId) }))
  app.patch('/api/v1/accounts/:accountId', wrap((req) => domain.updateAccount(req.params.accountId, parseInput(accountUpdateSchema, req.body), req.actor)))
  app.delete('/api/v1/accounts/:accountId', wrap((req) => domain.deleteAccount(req.params.accountId, parseInput(accountUpdateSchema.pick({ expectedRevision: true, idempotencyKey: true }), req.body), req.actor)))

  app.get('/api/v1/accounts/:accountId/materials', wrap((req) => { domain.assertActorScope(req.actor, req.params.accountId); return domain.listMaterials(req.params.accountId, String(req.query.q || '')) }))
  app.post('/api/v1/accounts/:accountId/materials', wrap((req) => domain.createMaterial(req.params.accountId, parseInput(materialCreateSchema, req.body), req.actor)))
  app.post('/api/v1/accounts/:accountId/artifacts/import', wrap((req) => {
    const body = req.body || {}
    if (!['material_image', 'cover_background', 'cover_render', 'attachment', 'export'].includes(body.kind)) {
      throw new DomainError('VALIDATION_ERROR', 'Unsupported artifact kind', 400)
    }
    if (typeof body.path !== 'string' || typeof body.idempotencyKey !== 'string') {
      throw new DomainError('VALIDATION_ERROR', 'path and idempotencyKey are required', 400)
    }
    return domain.importArtifact(req.params.accountId, body, req.actor)
  }))
  app.get('/api/v1/accounts/:accountId/artifacts/:artifactId', wrap((req, res) => {
    domain.assertActorScope(req.actor, req.params.accountId)
    const artifact = domain.getArtifact(req.params.accountId, req.params.artifactId)
    res.type(artifact.mimeType)
    res.setHeader('Cache-Control', 'private, max-age=31536000, immutable')
    res.sendFile(artifact.path, { dotfiles: 'allow' })
  }))
  app.get('/api/v1/accounts/:accountId/workflows', wrap((req) => { domain.assertActorScope(req.actor, req.params.accountId); return domain.listWorkflows(req.params.accountId) }))
  app.post('/api/v1/accounts/:accountId/workflows', wrap((req) => domain.createWorkflow(req.params.accountId, parseInput(workflowCreateSchema, req.body), req.actor)))
  app.get('/api/v1/accounts/:accountId/workflows/:workflowId', wrap((req) => { domain.assertActorScope(req.actor, req.params.accountId, req.params.workflowId, { requireWorkflow: true }); return domain.workflowSnapshot(req.params.accountId, req.params.workflowId) }))
  app.post('/api/v1/accounts/:accountId/workflows/:workflowId/topics', wrap((req) => domain.submitTopics(req.params.accountId, req.params.workflowId, parseInput(topicsSubmitSchema, req.body), req.actor)))
  app.post('/api/v1/accounts/:accountId/workflows/:workflowId/topic-approval', wrap((req) => domain.approveTopic(req.params.accountId, req.params.workflowId, parseInput(topicApproveSchema, req.body), req.actor)))
  app.post('/api/v1/accounts/:accountId/workflows/:workflowId/draft-revisions', wrap((req) => domain.createDraftRevision(req.params.accountId, req.params.workflowId, parseInput(draftRevisionSchema, req.body), req.actor)))
  app.post('/api/v1/accounts/:accountId/workflows/:workflowId/reviews', wrap((req) => domain.submitReview(req.params.accountId, req.params.workflowId, parseInput(reviewSchema, req.body), req.actor)))
  app.post('/api/v1/accounts/:accountId/workflows/:workflowId/draft-approval', wrap((req) => domain.approveDraft(req.params.accountId, req.params.workflowId, parseInput(draftApproveSchema, req.body), req.actor)))
  app.post('/api/v1/accounts/:accountId/workflows/:workflowId/covers', wrap((req) => domain.createCover(req.params.accountId, req.params.workflowId, parseInput(coverCreateSchema, req.body), req.actor)))
  app.post('/api/v1/accounts/:accountId/workflows/:workflowId/cover-approval', wrap((req) => domain.approveCover(req.params.accountId, req.params.workflowId, parseInput(coverApproveSchema, req.body), req.actor)))
  app.post('/api/v1/accounts/:accountId/workflows/:workflowId/package', wrap((req) => domain.buildPackage(req.params.accountId, req.params.workflowId, parseInput(packageSchema, req.body), req.actor)))
  app.get('/api/v1/accounts/:accountId/works', wrap((req) => { domain.assertActorScope(req.actor, req.params.accountId); return domain.listWorks(req.params.accountId) }))

  app.get('/api/v1/events', (req, res) => {
    const after = Number(req.headers['last-event-id'] || req.query.after || 0)
    const accountId = req.query.accountId ? String(req.query.accountId) : null
    if (accountId) domain.getAccount(accountId)
    res.setHeader('Content-Type', 'text/event-stream')
    res.setHeader('Cache-Control', 'no-cache, no-transform')
    res.setHeader('Connection', 'keep-alive')
    for (const event of domain.auditEvents({ accountId, after })) {
      res.write(`id: ${event.sequence}\nevent: invalidated\ndata: ${JSON.stringify(event)}\n\n`)
    }
    const heartbeat = setInterval(() => res.write(': heartbeat\n\n'), 15_000)
    const listener = (event) => {
      if (!accountId || event.accountId === accountId) {
        res.write(`id: ${event.sequence}\nevent: invalidated\ndata: ${JSON.stringify(event)}\n\n`)
      }
    }
    domain.events?.add(listener)
    req.on('close', () => {
      clearInterval(heartbeat)
      domain.events?.delete(listener)
    })
  })

  if (frontendDist && existsSync(join(frontendDist, 'index.html'))) {
    app.use(express.static(frontendDist, { index: false, maxAge: '1h' }))
    app.get('*splat', (_req, res) => res.sendFile(join(frontendDist, 'index.html')))
  }

  app.use((error, _req, res, _next) => {
    const status = Number(error.status || (error instanceof DomainError ? error.status : 500))
    const body = {
      error: {
        code: error.code || 'INTERNAL_ERROR',
        message: status >= 500 ? 'Unexpected local service error' : error.message,
        details: error.details,
        requestId: randomUUID(),
      },
    }
    if (status >= 500) console.error(`[ideashu] ${body.error.requestId}: ${error.stack || error}`)
    res.status(status).json(body)
  })
  return app
}
