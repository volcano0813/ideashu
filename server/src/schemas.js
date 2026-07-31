import * as z from 'zod/v4'

export const idempotencyKey = z.string().min(8).max(200)
export const expectedWorkflowVersion = z.number().int().positive()

export const accountCreateSchema = z.object({
  name: z.string().trim().min(1).max(120),
  domain: z.string().max(500).optional(),
  persona: z.string().max(4000).optional(),
  tone: z.string().max(2000).optional(),
  styleName: z.string().max(200).optional(),
  profile: z.record(z.string(), z.unknown()).optional(),
  idempotencyKey,
})

export const accountUpdateSchema = accountCreateSchema.partial().extend({
  expectedRevision: z.number().int().positive(),
  idempotencyKey,
})

export const materialCreateSchema = z.object({
  type: z.enum(['text', 'photo', 'voice', 'data', 'link']),
  content: z.string().max(200_000).default(''),
  tags: z.array(z.string().max(100)).max(100).default([]),
  artifactId: z.string().uuid().optional(),
  idempotencyKey,
})

export const workflowCreateSchema = z.object({
  objective: z.string().max(4000).default(''),
  idempotencyKey,
})

export const topicSchema = z.object({
  title: z.string().min(1).max(300),
  angle: z.string().max(2000).default(''),
  rationale: z.string().max(4000).default(''),
  evidence: z.array(z.object({
    title: z.string().max(500).optional(),
    url: z.string().url().optional(),
    excerpt: z.string().max(2000).optional(),
    capturedAt: z.string().optional(),
  })).max(50).default([]),
  score: z.record(z.string(), z.number()).default({}),
})

export const topicsSubmitSchema = z.object({
  topics: z.array(topicSchema).min(1).max(20),
  expectedWorkflowVersion,
  idempotencyKey,
})

export const topicApproveSchema = z.object({
  topicId: z.string().uuid(),
  expectedWorkflowVersion,
  idempotencyKey,
})

export const draftRevisionSchema = z.object({
  title: z.string().min(1).max(300),
  body: z.string().min(1).max(200_000),
  tags: z.array(z.string().max(100)).max(100).default([]),
  materialAnchors: z.array(z.string().uuid()).max(100).default([]),
  changeSummary: z.string().max(2000).default(''),
  expectedWorkflowVersion,
  expectedDraftRevision: z.number().int().nonnegative(),
  idempotencyKey,
})

export const reviewSchema = z.object({
  draftRevision: z.number().int().positive(),
  decision: z.enum(['pass', 'revise', 'blocked']),
  scores: z.record(z.string(), z.number()).default({}),
  requiredChanges: z.array(z.string().max(2000)).max(100).default([]),
  optionalSuggestions: z.array(z.string().max(2000)).max(100).default([]),
  evidenceGaps: z.array(z.string().max(2000)).max(100).default([]),
  expectedWorkflowVersion,
  idempotencyKey,
})

export const draftApproveSchema = z.object({
  draftRevision: z.number().int().positive(),
  expectedWorkflowVersion,
  idempotencyKey,
})

export const compositionSchema = z.object({
  title: z.string().min(1).max(80),
  subtitle: z.string().max(120).default(''),
  width: z.number().int().min(300).max(2400).default(1080),
  height: z.number().int().min(400).max(3200).default(1440),
  titleColor: z.string().max(40).default('#ffffff'),
  accentColor: z.string().max(40).default('#f97316'),
  align: z.enum(['left', 'center']).default('left'),
  safeMargin: z.number().int().min(20).max(300).default(96),
})

export const coverCreateSchema = z.object({
  draftRevision: z.number().int().positive(),
  brief: z.record(z.string(), z.unknown()).default({}),
  composition: compositionSchema,
  backgroundArtifactId: z.string().uuid().optional(),
  renderedArtifactId: z.string().uuid().optional(),
  qa: z.object({
    passed: z.boolean(),
    checks: z.array(z.string().max(500)).max(50).default([]),
    note: z.string().max(2000).default(''),
  }).optional(),
  expectedWorkflowVersion,
  idempotencyKey,
})

export const coverApproveSchema = z.object({
  coverId: z.string().uuid(),
  expectedWorkflowVersion,
  idempotencyKey,
})

export const packageSchema = z.object({
  expectedWorkflowVersion,
  idempotencyKey,
})

export function parseInput(schema, value) {
  const result = schema.safeParse(value)
  if (!result.success) {
    const error = new Error('Request validation failed')
    error.code = 'VALIDATION_ERROR'
    error.status = 400
    error.details = z.treeifyError(result.error)
    throw error
  }
  return result.data
}
