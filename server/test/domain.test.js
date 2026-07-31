import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { createTestDomain, createAccount, key, operator, agent } from './helpers.js'

test('new database has workspace but no fabricated content account', () => {
  const { domain, db } = createTestDomain()
  assert.deepEqual(domain.listAccounts(), [])
  db.close()
})

test('account-scoped queries cannot read a workflow from another account', () => {
  const { domain, db, scope } = createTestDomain()
  const a = createAccount(domain, scope, 'Account A', 'a')
  const b = createAccount(domain, scope, 'Account B', 'b')
  const run = domain.createWorkflow(a.id, { objective: 'A only', idempotencyKey: key('run-a') }, agent())
  assert.throws(() => domain.workflowSnapshot(b.id, run.id), (error) => error.code === 'NOT_FOUND')
  assert.equal(domain.listWorkflows(b.id).length, 0)
  db.close()
})

test('idempotency returns the same result and rejects payload reuse', () => {
  const { domain, db, scope } = createTestDomain()
  const input = { name: 'Stable', idempotencyKey: key('stable') }
  const first = domain.createAccount(input, operator(scope))
  const second = domain.createAccount(input, operator(scope))
  assert.equal(first.id, second.id)
  assert.equal(domain.listAccounts().length, 1)
  assert.throws(
    () => domain.createAccount({ ...input, name: 'Different' }, operator(scope)),
    (error) => error.code === 'IDEMPOTENCY_KEY_REUSED',
  )
  db.close()
})

test('workflow state machine requires operator approvals and exact revisions', () => {
  const { domain, db, scope } = createTestDomain()
  const account = createAccount(domain, scope, 'Creator', 'creator')
  const run = domain.createWorkflow(account.id, { objective: 'Ship a post', idempotencyKey: key('workflow') }, agent())

  const topicsResult = domain.submitTopics(account.id, run.id, {
    expectedWorkflowVersion: 1,
    idempotencyKey: key('topics'),
    topics: [{ title: 'A sourced topic', evidence: [{ title: 'Source', url: 'https://example.com' }] }],
  }, agent())
  const topic = domain.workflowSnapshot(account.id, run.id).topics[0]
  assert.equal(topicsResult.state, 'topic_ready')
  assert.throws(
    () => domain.approveTopic(account.id, run.id, { topicId: topic.id, expectedWorkflowVersion: 2, idempotencyKey: key('bad-approve') }, agent()),
    (error) => error.code === 'OPERATOR_REQUIRED',
  )

  const approvedTopic = domain.approveTopic(account.id, run.id, {
    topicId: topic.id, expectedWorkflowVersion: 2, idempotencyKey: key('topic-approve'),
  }, operator(scope))
  assert.equal(approvedTopic.state, 'topic_approved')

  const draft = domain.createDraftRevision(account.id, run.id, {
    title: 'Title', body: 'Body', tags: ['tag'], materialAnchors: [], changeSummary: 'initial',
    expectedWorkflowVersion: 3, expectedDraftRevision: 0, idempotencyKey: key('draft-1'),
  }, agent())
  assert.equal(draft.revision, 1)
  assert.throws(
    () => domain.createDraftRevision(account.id, run.id, {
      title: 'Conflict', body: 'Body', tags: [], materialAnchors: [], changeSummary: '',
      expectedWorkflowVersion: 4, expectedDraftRevision: 0, idempotencyKey: key('draft-conflict'),
    }, agent()),
    (error) => error.code === 'REVISION_CONFLICT',
  )

  const review = domain.submitReview(account.id, run.id, {
    draftRevision: 1, decision: 'pass', scores: { quality: 90 }, requiredChanges: [], optionalSuggestions: [], evidenceGaps: [],
    expectedWorkflowVersion: 4, idempotencyKey: key('review'),
  }, agent())
  assert.equal(review.workflow.state, 'draft_review')
  const approvedDraft = domain.approveDraft(account.id, run.id, {
    draftRevision: 1, expectedWorkflowVersion: 5, idempotencyKey: key('draft-approve'),
  }, operator(scope))
  assert.equal(approvedDraft.state, 'draft_approved')

  const cover = domain.createCover(account.id, run.id, {
    draftRevision: 1,
    brief: { scene: 'clean desk', backgroundText: false },
    composition: { title: '中文标题', subtitle: '可编辑', width: 1080, height: 1440, titleColor: '#fff', accentColor: '#f97316', align: 'left', safeMargin: 96 },
    qa: { passed: true, checks: ['3:4', 'safe margin'], note: '' },
    expectedWorkflowVersion: 6,
    idempotencyKey: key('cover'),
  }, agent())
  assert.equal(cover.status, 'qa_passed')
  const renderedCover = domain.workflowSnapshot(account.id, run.id).covers[0]
  const artifact = domain.getArtifact(account.id, renderedCover.renderedArtifactId)
  assert.match(readFileSync(artifact.path, 'utf8'), /^<svg/)
  assert.throws(
    () => domain.approveCover(account.id, run.id, { coverId: cover.id, expectedWorkflowVersion: 7, idempotencyKey: key('cover-agent-approve') }, agent()),
    (error) => error.code === 'OPERATOR_REQUIRED',
  )
  const coverApproved = domain.approveCover(account.id, run.id, {
    coverId: cover.id, expectedWorkflowVersion: 7, idempotencyKey: key('cover-approve'),
  }, operator(scope))
  assert.equal(coverApproved.state, 'cover_approved')
  const packaged = domain.buildPackage(account.id, run.id, {
    expectedWorkflowVersion: 8, idempotencyKey: key('package'),
  }, operator(scope))
  assert.equal(packaged.workflow.state, 'packaged')
  assert.equal(domain.listWorks(account.id).length, 1)
  db.close()
})

test('a new revision invalidates an approved draft and prevents stale cover reuse', () => {
  const { domain, db, scope } = createTestDomain()
  const account = createAccount(domain, scope, 'Versioned', 'versioned')
  const run = domain.createWorkflow(account.id, { objective: '', idempotencyKey: key('v-run') }, agent())
  domain.submitTopics(account.id, run.id, { expectedWorkflowVersion: 1, idempotencyKey: key('v-topics'), topics: [{ title: 'T' }] }, agent())
  const topicId = domain.workflowSnapshot(account.id, run.id).topics[0].id
  domain.approveTopic(account.id, run.id, { topicId, expectedWorkflowVersion: 2, idempotencyKey: key('v-topic-ok') }, operator(scope))
  domain.createDraftRevision(account.id, run.id, { title: 'V1', body: 'one', tags: [], materialAnchors: [], changeSummary: '', expectedWorkflowVersion: 3, expectedDraftRevision: 0, idempotencyKey: key('v-draft-1') }, agent())
  domain.submitReview(account.id, run.id, { draftRevision: 1, decision: 'pass', scores: {}, requiredChanges: [], optionalSuggestions: [], evidenceGaps: [], expectedWorkflowVersion: 4, idempotencyKey: key('v-review') }, agent())
  domain.approveDraft(account.id, run.id, { draftRevision: 1, expectedWorkflowVersion: 5, idempotencyKey: key('v-approve') }, operator(scope))
  domain.createDraftRevision(account.id, run.id, { title: 'V2', body: 'two', tags: [], materialAnchors: [], changeSummary: 'changed', expectedWorkflowVersion: 6, expectedDraftRevision: 1, idempotencyKey: key('v-draft-2') }, agent())
  const snapshot = domain.workflowSnapshot(account.id, run.id)
  assert.equal(snapshot.workflow.state, 'draft_review')
  assert.equal(snapshot.workflow.approvedDraftRevision, null)
  assert.equal(snapshot.draft.revisions[0].body, 'one')
  assert.equal(snapshot.draft.revisions[1].body, 'two')
  db.close()
})

test('database triggers enforce immutable revisions and cross-account draft scope', () => {
  const { domain, db, scope } = createTestDomain()
  const a = createAccount(domain, scope, 'A', 'trigger-a')
  const b = createAccount(domain, scope, 'B', 'trigger-b')
  const agentA = agent('trigger-agent-a')
  const runA = domain.createWorkflow(a.id, { objective: '', idempotencyKey: key('trigger-run-a') }, agentA)
  domain.submitTopics(a.id, runA.id, { expectedWorkflowVersion: 1, idempotencyKey: key('trigger-topic-a'), topics: [{ title: 'A' }] }, agentA)
  const topicId = domain.workflowSnapshot(a.id, runA.id).topics[0].id
  domain.approveTopic(a.id, runA.id, { topicId, expectedWorkflowVersion: 2, idempotencyKey: key('trigger-topic-ok') }, operator(scope))
  domain.createDraftRevision(a.id, runA.id, { title: 'A', body: 'A body', tags: [], materialAnchors: [], changeSummary: '', expectedWorkflowVersion: 3, expectedDraftRevision: 0, idempotencyKey: key('trigger-draft') }, agentA)
  const draftA = domain.workflowSnapshot(a.id, runA.id).draft
  assert.throws(() => db.prepare('UPDATE draft_revisions SET body = ? WHERE draft_id = ? AND revision = 1').run('tampered', draftA.id), /immutable/)

  const runB = domain.createWorkflow(b.id, { objective: '', idempotencyKey: key('trigger-run-b') }, agent('trigger-agent-b'))
  assert.throws(() => db.prepare(`INSERT INTO cover_variants(id, workspace_id, account_id, workflow_id,
    draft_id, draft_revision, brief_json, composition_json, qa_json, status, created_by, created_at)
    VALUES (?, ?, ?, ?, ?, 1, '{}', '{}', '{}', 'planned', ?, ?)`)
    .run('cross-cover', scope.workspaceId, b.id, runB.id, draftA.id, scope.operatorId, new Date().toISOString()), /scope mismatch/)
  db.close()
})

test('artifact import rejects traversal and disguised images', () => {
  const { domain, db, scope, root, importRoot } = createTestDomain()
  const account = createAccount(domain, scope, 'Assets', 'assets')
  const outside = join(root, 'outside.png')
  writeFileSync(outside, Buffer.from('not a png'))
  assert.throws(() => domain.importArtifact(account.id, { path: outside, kind: 'cover_background', idempotencyKey: key('outside') }, agent()), (error) => error.code === 'IMPORT_PATH_REJECTED')
  const fake = join(importRoot, 'fake.png')
  writeFileSync(fake, Buffer.from('not a png'))
  assert.throws(() => domain.importArtifact(account.id, { path: fake, kind: 'cover_background', idempotencyKey: key('fake') }, agent()), (error) => error.code === 'ARTIFACT_TYPE_REJECTED')
  db.close()
})

test('legacy batch failure rolls back all business rows and audit events', () => {
  const { domain, db, scope } = createTestDomain()
  const account = createAccount(domain, scope, 'Rollback', 'rollback')
  const beforeAudit = db.prepare('SELECT COUNT(*) AS count FROM audit_events').get().count
  assert.throws(() => domain.importLegacyBatch({
    sourceSha256: 'a'.repeat(64),
    items: [
      { accountId: account.id, type: 'text', content: 'valid first row', tags: [] },
      { accountId: account.id, type: 'invalid-type', content: 'must fail', tags: [] },
    ],
  }, operator(scope)))
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM materials WHERE account_id = ?').get(account.id).count, 0)
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM audit_events').get().count, beforeAudit)
  db.close()
})

test('one agent run cannot write a second account or workflow after binding', () => {
  const { domain, db, scope } = createTestDomain()
  const a = createAccount(domain, scope, 'Bound A', 'bound-a')
  const b = createAccount(domain, scope, 'Bound B', 'bound-b')
  const actor = agent('bound-agent-run')
  const run = domain.createWorkflow(a.id, { objective: 'A', idempotencyKey: key('bound-run-a') }, actor)
  assert.equal(db.prepare('SELECT account_id, workflow_id FROM agent_runs WHERE id = ?').get(actor.id).workflow_id, run.id)
  assert.throws(() => domain.createMaterial(b.id, { type: 'text', content: 'crossed', tags: [], idempotencyKey: key('bound-material-b') }, actor), (error) => error.code === 'NOT_FOUND')
  assert.throws(() => domain.createWorkflow(b.id, { objective: 'B', idempotencyKey: key('bound-run-b') }, actor), (error) => error.code === 'NOT_FOUND')
  assert.equal(domain.listMaterials(b.id).length, 0)
  assert.equal(domain.listWorkflows(b.id).length, 0)
  db.close()
})
