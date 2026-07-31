export type Account = {
  id: string
  name: string
  domain: string
  persona: string
  tone: string
  styleName: string
  profile: Record<string, unknown>
  revision: number
  createdAt: string
  updatedAt: string
}

export type Material = {
  id: string
  accountId: string
  type: 'text' | 'photo' | 'voice' | 'data' | 'link'
  content: string
  tags: string[]
  artifactId?: string | null
  revision: number
  createdAt: string
  updatedAt: string
}

export type Workflow = {
  id: string
  accountId: string
  state: WorkflowState
  objective: string
  selectedTopicId: string | null
  approvedDraftRevision: number | null
  approvedCoverId: string | null
  version: number
  createdAt: string
  updatedAt: string
}

export type WorkflowState =
  | 'collecting' | 'topic_ready' | 'topic_approved' | 'drafting'
  | 'draft_review' | 'draft_approved' | 'covering' | 'cover_approved'
  | 'packaged' | 'cancelled'

export type Topic = {
  id: string
  title: string
  angle: string
  rationale: string
  evidence: Array<{ title?: string; url?: string; excerpt?: string; capturedAt?: string }>
  score: Record<string, number>
  createdAt: string
}

export type DraftRevision = {
  draftId: string
  revision: number
  title: string
  body: string
  tags: string[]
  materialAnchors: string[]
  changeSummary: string
  createdAt: string
}

export type Review = {
  id: string
  draftRevision: number
  decision: 'pass' | 'revise' | 'blocked'
  scores: Record<string, number>
  requiredChanges: string[]
  optionalSuggestions: string[]
  evidenceGaps: string[]
  createdAt: string
}

export type CoverComposition = {
  title: string
  subtitle: string
  width: number
  height: number
  titleColor: string
  accentColor: string
  align: 'left' | 'center'
  safeMargin: number
}

export type Cover = {
  id: string
  draftRevision: number
  brief: Record<string, unknown>
  composition: CoverComposition
  qa: { passed?: boolean; checks?: string[]; note?: string }
  status: 'planned' | 'rendered' | 'qa_passed' | 'qa_failed'
  createdAt: string
}

export type WorkflowSnapshot = {
  workflow: Workflow
  topics: Topic[]
  draft: null | { id: string; currentRevision: number; revisions: DraftRevision[] }
  reviews: Review[]
  covers: Cover[]
  publishPackage: null | { id: string; draftRevision: number; coverId: string; manifest: Record<string, unknown>; createdAt: string }
}

export type Work = {
  id: string
  accountId: string
  workflowId: string
  title: string
  body: string
  tags: string[]
  draftRevision: number
  coverId: string
  renderedArtifactId: string
  createdAt: string
}

export type ApiErrorShape = { error?: { code?: string; message?: string; details?: unknown; requestId?: string } }
