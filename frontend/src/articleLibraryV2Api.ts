// 2026-10-24：本次修改原因：Stage 2C 前端与目标文章库 v2 契约通信，避免读取旧版文章模型。
export interface V2RightsScope {
  store: boolean | null
  local_clean: boolean | null
  third_party_llm: boolean | null
  generation_reference: boolean | null
}

export interface V2ArticleEditable {
  platform_id: string
  category_id: string | null
  content_format_id?: string | null
  genre_id?: string | null
  audience_id?: string | null
  topic?: string | null
  tags?: string[]
  title: string
  summary?: string | null
  body_text?: string | null
  author_name?: string | null
  published_at?: string | null
  article_url?: string | null
  review_status?: string
  content_status?: 'complete' | 'partial' | 'missing' | 'unknown'
  quality_score?: number | null
}

export interface V2Metric {
  id: string
  source_id: string | null
  source_label: string
  observed_at: string
  read_raw: string | null
  read_exact: number | null
  read_lower_bound: number | null
  likes: number | null
  watch_count: number | null
  comments: number | null
  shares: number | null
  saves: number | null
  rewards: number | null
  fans_count: number | null
  interactive_count: number | null
  extra_metrics: Record<string, unknown>
  field_provenance: Record<string, unknown>
}

export interface V2Source {
  id: string
  provider: string
  endpoint: string | null
  external_id: string | null
  acquisition_method: string
  source_url: string | null
  source_category: string | null
  request_params: Record<string, unknown>
  field_provenance: Record<string, unknown>
  raw_item: Record<string, unknown> | null
  raw_content: string | null
  fetched_at: string
}

export interface V2Article extends V2ArticleEditable {
  id: string
  tags: string[]
  rights_status: string
  rights_scope: V2RightsScope
  rights_evidence: string | null
  current_revision_id: string
  current_revision_no: number
  field_provenance: Record<string, unknown>
  row_version: number
  created_at: string
  updated_at: string
  sources?: V2Source[]
  metrics?: V2Metric[]
}

export interface V2Candidate {
  id: string
  raw_item?: Record<string, unknown>
  endpoint?: string
  provider?: string
  normalized: Omit<Partial<V2ArticleEditable>, 'title' | 'published_at'> & {
    title?: string | null
    published_at?: string | null
    published_at_raw?: string | null
    requested_source_category?: string | null
    source_category?: string | null
    metrics?: Record<string, number | string | null>
    raw_content_format?: string
  }
  field_provenance: Record<string, unknown>
  edit_draft?: Partial<V2ArticleEditable> | null
  warnings: string[]
  content_status: string
  collected_article_id: string | null
  row_version: number
}

export interface V2DiscoverySession {
  id: string
  endpoint: string
  request_params: Record<string, unknown>
  result_count: number
  candidate_total: number
  candidates: V2Candidate[]
}

async function requestV2<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`/api/v2/article-library${path}`, init)
  const body = await response.json().catch(() => null) as (T & { detail?: unknown }) | null
  if (!response.ok) {
    const detail = body?.detail
    const message = typeof detail === 'string' ? detail : Array.isArray(detail)
      ? detail.map((item) => typeof item?.msg === 'string' ? item.msg : '字段格式无效').join('；')
      : `请求失败（HTTP ${response.status}）`
    throw new Error(message)
  }
  return body as T
}

function json(method: string, body: unknown): RequestInit {
  return { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }
}

export const getV2WechatCategories = () => requestV2<{ items: string[] }>('/discover/wechat/categories')

export const discoverV2Wechat = (body: {
  method: 'keyword_search' | 'ten_w_rank' | 'original_rank'
  keyword?: string
  category?: string
  start_date?: string
  end_date?: string
  offset?: number
  sort_type?: '_0' | '_2' | '_4'
  exact_match?: boolean
}) => requestV2<{ session_id: string; count: number; has_more: boolean | null; candidates: V2Candidate[] }>(
  '/discover/wechat', json('POST', body))

export const getV2DiscoverySession = (id: string, offset = 0, limit = 50) =>
  requestV2<V2DiscoverySession>(`/discovery-sessions/${encodeURIComponent(id)}?offset=${offset}&limit=${limit}`)

export const getV2Candidate = (id: string) => requestV2<V2Candidate & {
  raw_item: Record<string, unknown>; provider: string; endpoint: string
}>(`/discovery-candidates/${encodeURIComponent(id)}`)

export const patchV2Candidate = (id: string, rowVersion: number, patch: Partial<V2ArticleEditable>) =>
  requestV2<{ id: string; edit_draft: Partial<V2ArticleEditable>; row_version: number }>(
    `/discovery-candidates/${encodeURIComponent(id)}`, json('PATCH', { expected_row_version: rowVersion, patch }))

export const collectV2Candidate = (id: string, rowVersion: number, scope: V2RightsScope, evidence?: string,
                                   overrides?: Partial<V2ArticleEditable>) =>
  requestV2<V2Article>(`/discovery-candidates/collect`, json('POST', {
    candidate_id: id, expected_row_version: rowVersion, scope, evidence, overrides,
  }))

export const collectV2Candidates = (candidates: [string, number][], scope: V2RightsScope, evidence?: string,
                                   overridesByCandidate?: Record<string, Partial<V2ArticleEditable>>) =>
  requestV2<{ count: number; articles: V2Article[] }>(`/discovery-candidates/collect-batch`, json('POST', {
    candidates, scope, evidence, overrides_by_candidate: overridesByCandidate,
  }))

export const createV2Article = (article: V2ArticleEditable, scope: V2RightsScope, evidence?: string) =>
  requestV2<V2Article>('/articles', json('POST', { article, scope, evidence }))

export const getV2Articles = (offset = 0, limit = 20, filters: {
  platform_id?: string; category_id?: string; content_format_id?: string
} = {}) => {
  const query = new URLSearchParams({ offset: String(offset), limit: String(limit) })
  Object.entries(filters).forEach(([key, value]) => { if (value) query.set(key, value) })
  return requestV2<{ items: V2Article[]; offset: number; limit: number; total: number }>(`/articles?${query}`)
}

export const getV2Article = (id: string) => requestV2<V2Article>(`/articles/${encodeURIComponent(id)}`)

export const updateV2Article = (id: string, rowVersion: number, patch: Partial<V2ArticleEditable>) =>
  requestV2<V2Article>(`/articles/${encodeURIComponent(id)}`, json('PATCH', {
    expected_row_version: rowVersion, patch,
  }))
