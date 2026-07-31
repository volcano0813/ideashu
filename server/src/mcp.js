import { createRequire } from 'node:module'
import { readFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import * as z from 'zod/v4'
import { loadRuntime } from './config.js'
import {
  coverCreateSchema, draftRevisionSchema, materialCreateSchema, reviewSchema,
  topicsSubmitSchema, workflowCreateSchema,
} from './schemas.js'

const require = createRequire(import.meta.url)
const { McpServer } = require('@modelcontextprotocol/server')
const { StdioServerTransport } = require('@modelcontextprotocol/server/stdio')

const runtime = loadRuntime()
const tokenData = JSON.parse(readFileSync(runtime.paths.tokenFile, 'utf8'))
const baseUrl = runtime.connection.baseUrl

async function api(path, { method = 'GET', body, agentRunId = 'mcp-local' } = {}) {
  let response
  try {
    response = await fetch(`${baseUrl}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${tokenData.mcpToken}`,
        'Content-Type': 'application/json',
        'X-IdeaShu-Agent-Run': agentRunId,
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(10_000),
    })
  } catch (error) {
    throw new Error(`IdeaShu local service is unavailable at ${baseUrl}. Start it with npm start. ${error.message}`)
  }
  const payload = await response.json().catch(() => ({}))
  if (!response.ok) {
    const detail = payload?.error
    throw new Error(`${detail?.code || `HTTP_${response.status}`}: ${detail?.message || response.statusText}`)
  }
  return payload
}

const outputSchema = z.object({ result: z.unknown() })
const result = (value) => ({
  content: [{ type: 'text', text: JSON.stringify(value, null, 2) }],
  structuredContent: { result: value },
})
const readAnnotations = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false }
const writeAnnotations = { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false }
const accountId = z.string().uuid().describe('Content account UUID. Never infer or substitute another account.')
const workflowId = z.string().uuid().describe('Workflow UUID already locked to the supplied content account.')
const agentRunId = z.string().min(8).max(200).describe('Stable host-agent run identifier used for audit and idempotency scope.')

const server = new McpServer({ name: 'ideashu', version: '1.0.0' })

server.registerTool('ideashu_accounts_list', {
  title: 'List IdeaShu accounts',
  description: 'List active content accounts available to the local operator. Choose an account explicitly before starting work.',
  inputSchema: z.object({}), outputSchema, annotations: readAnnotations,
}, async () => result(await api('/api/v1/accounts')))

server.registerTool('ideashu_account_get_context', {
  title: 'Get account context',
  description: 'Read one account profile and its current style context. Returns NOT_FOUND for deleted or foreign accounts.',
  inputSchema: z.object({ accountId, agentRunId }), outputSchema, annotations: readAnnotations,
}, async ({ accountId: id, agentRunId: run }) => result(await api(`/api/v1/accounts/${id}`, { agentRunId: run })))

server.registerTool('ideashu_materials_search', {
  title: 'Search account materials',
  description: 'Search materials inside exactly one content account. Results never include other accounts.',
  inputSchema: z.object({ accountId, agentRunId, query: z.string().max(500).default('') }), outputSchema, annotations: readAnnotations,
}, async ({ accountId: id, agentRunId: run, query }) => result(await api(`/api/v1/accounts/${id}/materials?q=${encodeURIComponent(query)}`, { agentRunId: run })))

server.registerTool('ideashu_material_create', {
  title: 'Create account material',
  description: 'Store structured source material in one account. Provide a stable idempotency key and agent run ID.',
  inputSchema: materialCreateSchema.extend({ accountId, agentRunId }), outputSchema, annotations: writeAnnotations,
}, async ({ accountId: id, agentRunId: run, ...body }) => result(await api(`/api/v1/accounts/${id}/materials`, { method: 'POST', body, agentRunId: run })))

server.registerTool('ideashu_workflow_create', {
  title: 'Create workflow',
  description: 'Create a workflow permanently locked to one content account. The workflow account cannot be changed later.',
  inputSchema: workflowCreateSchema.extend({ accountId, agentRunId }), outputSchema, annotations: writeAnnotations,
}, async ({ accountId: id, agentRunId: run, ...body }) => result(await api(`/api/v1/accounts/${id}/workflows`, { method: 'POST', body, agentRunId: run })))

server.registerTool('ideashu_workflow_get', {
  title: 'Get workflow snapshot',
  description: 'Read the authoritative workflow, candidates, immutable draft revisions, reviews, covers, and package.',
  inputSchema: z.object({ accountId, workflowId, agentRunId }), outputSchema, annotations: readAnnotations,
}, async ({ accountId: aid, workflowId: wid, agentRunId: run }) => result(await api(`/api/v1/accounts/${aid}/workflows/${wid}`, { agentRunId: run })))

server.registerTool('ideashu_topics_submit', {
  title: 'Submit topic candidates',
  description: 'Submit sourced topic candidates. This does not approve a topic; approval is available only in the operator web UI.',
  inputSchema: topicsSubmitSchema.extend({ accountId, workflowId, agentRunId }), outputSchema, annotations: writeAnnotations,
}, async ({ accountId: aid, workflowId: wid, agentRunId: run, ...body }) => result(await api(`/api/v1/accounts/${aid}/workflows/${wid}/topics`, { method: 'POST', body, agentRunId: run })))

server.registerTool('ideashu_topics_list', {
  title: 'List topic candidates',
  description: 'List current topic candidates and evidence for a workflow.',
  inputSchema: z.object({ accountId, workflowId, agentRunId }), outputSchema, annotations: readAnnotations,
}, async ({ accountId: aid, workflowId: wid, agentRunId: run }) => {
  const snapshot = await api(`/api/v1/accounts/${aid}/workflows/${wid}`, { agentRunId: run })
  return result({ workflow: snapshot.workflow, topics: snapshot.topics })
})

server.registerTool('ideashu_draft_get', {
  title: 'Get draft revisions',
  description: 'Read immutable draft revisions and the latest review state for a workflow.',
  inputSchema: z.object({ accountId, workflowId, agentRunId }), outputSchema, annotations: readAnnotations,
}, async ({ accountId: aid, workflowId: wid, agentRunId: run }) => {
  const snapshot = await api(`/api/v1/accounts/${aid}/workflows/${wid}`, { agentRunId: run })
  return result({ workflow: snapshot.workflow, draft: snapshot.draft, reviews: snapshot.reviews })
})

server.registerTool('ideashu_draft_revision_create', {
  title: 'Create draft revision',
  description: 'Append an immutable draft revision using optimistic concurrency. A new revision invalidates prior approvals and covers.',
  inputSchema: draftRevisionSchema.extend({ accountId, workflowId, agentRunId }), outputSchema, annotations: writeAnnotations,
}, async ({ accountId: aid, workflowId: wid, agentRunId: run, ...body }) => result(await api(`/api/v1/accounts/${aid}/workflows/${wid}/draft-revisions`, { method: 'POST', body, agentRunId: run })))

server.registerTool('ideashu_review_submit', {
  title: 'Submit draft review',
  description: 'Submit a structured review for the exact latest draft revision. A pass result is not operator approval.',
  inputSchema: reviewSchema.extend({ accountId, workflowId, agentRunId }), outputSchema, annotations: writeAnnotations,
}, async ({ accountId: aid, workflowId: wid, agentRunId: run, ...body }) => result(await api(`/api/v1/accounts/${aid}/workflows/${wid}/reviews`, { method: 'POST', body, agentRunId: run })))

server.registerTool('ideashu_artifact_import', {
  title: 'Import local image artifact',
  description: 'Import a validated image located under .ideashu/imports into one account-scoped content-addressed artifact store.',
  inputSchema: z.object({
    accountId, agentRunId,
    path: z.string().min(3).describe('Absolute path inside the configured .ideashu/imports directory.'),
    kind: z.enum(['material_image', 'cover_background', 'cover_render', 'attachment', 'export']),
    idempotencyKey: z.string().min(8).max(200),
  }), outputSchema, annotations: writeAnnotations,
}, async ({ accountId: aid, agentRunId: run, ...body }) => result(await api(`/api/v1/accounts/${aid}/artifacts/import`, { method: 'POST', body, agentRunId: run })))

server.registerTool('ideashu_cover_variant_create', {
  title: 'Create cover variant',
  description: 'Save a cover brief and editable deterministic Chinese text composition for the approved draft revision. This does not approve the cover.',
  inputSchema: coverCreateSchema.extend({ accountId, workflowId, agentRunId }), outputSchema, annotations: writeAnnotations,
}, async ({ accountId: aid, workflowId: wid, agentRunId: run, ...body }) => result(await api(`/api/v1/accounts/${aid}/workflows/${wid}/covers`, { method: 'POST', body, agentRunId: run })))

const transport = new StdioServerTransport()
await server.connect(transport)
process.stderr.write(`[ideashu-mcp] connected (${randomUUID().slice(0, 8)})\n`)
