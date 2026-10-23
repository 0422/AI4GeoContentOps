// 2026-10-23：本次修改原因：为文章库的分页、复核、指标和画像提供独立类型与请求入口。
export interface LibraryArticle {
  id: string
  title: string
  platform_id: string
  category_id: string
  format_id: string | null
  source_url: string | null
  quality_score: number
  rights_confirmed: boolean
  created_at: string
  author_id: string | null
  account_followers: number | null
  // 2026-10-24：本次修改原因：样本详情回显采集接口已保存的原始来源信息。
  // source_data: { provider?: string; method?: string; request?: Record<string, unknown>;
  //   response?: Record<string, unknown> }  // 2026-10-24：原列表也包含整份来源字段的类型留作对照。
  published_at: string | null
  audience_id: string | null
  topic: string | null
  tags: string[]
  usage_rights_note: string | null
  review_status: 'pending' | 'ready' | 'excluded'
  collected_at: string
  analysis_status: 'pending' | 'current' | 'stale'
  body_excerpt: string
}

export interface ArticleMetric {
  id: string
  captured_at: string
  source: string
  impressions: number | null
  clicks: number | null
  reads: number | null
  likes: number | null
  // 2026-10-24：本次修改原因：公众号在看与近似原始读数在样本详情可复核。
  watch_count: number | null
  saves: number | null
  reward_count: number | null
  interactive_count: number | null
  comments: number | null
  shares: number | null
  raw_counts: Record<string, string>
  ctr: number | null
  save_rate: number | null
  comment_rate: number | null
}

export interface LibraryArticleDetail extends LibraryArticle {
  body_text: string
  // 2026-10-24：本次修改原因：仅详细读取时传回已保存的 RedFox 请求与响应字段。
  source_data: { provider?: string; method?: string; request?: Record<string, unknown>;
    response?: Record<string, unknown> }
  features: Record<string, unknown> | null
  feature_version: string | null
  metrics: ArticleMetric[]
  profile_ids: string[]
  strategy_ids: string[]
  performance: { band: string | null; reason: string; metric: string | null;
    value?: number; percentile: number | null; peer_count: number }
}

export interface StyleProfile {
  id: string
  platform_id: string
  category_id: string
  format_id: string | null
  audience_id: string | null
  version: number
  sample_count: number
  profile: {
    statistics: Record<string, { mean: number; std: number; min: number; max: number;
      p10: number; p50: number; p90: number }>
    semantic: Record<string, string>
    representative_ids: string[]
    confidence_note: string
  }
  method: string
  model_name: string | null
  created_at: string
  sample_ids?: string[]
  strategy_ids?: string[]
  stale_sample_count?: number
}

export interface ArticleSummary {
  total: number
  pending: number
  ready: number
  excluded: number
  analyzed: number
  profiles: number
}

export interface ArticlePage {
  items: LibraryArticle[]
  total: number
  page: number
  page_size: number
}

// 2026-10-23：本次修改原因：画像运行记录把范围、方法和失败原因展示给审核者。
export interface AnalysisRun {
  id: string
  scope: { platform_id: string; category_id: string; format_id: string | null;
    audience_id: string | null; include_ai: boolean }
  status: 'running' | 'completed' | 'failed'
  method: string
  error: string | null
  created_at: string
  completed_at: string | null
}

// 2026-10-23：本次修改原因：请求失败时保留后端校验信息，避免把查重或权限错误显示为通用失败。
async function requestLibrary<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`/api/v1/library${path}`, init)
  const body = await response.json().catch(() => null) as (T & { detail?: unknown }) | null
  if (!response.ok) {
    // 2026-10-23：本次修改原因：表单字段校验错误按可读文字展示，而不是输出对象字符串。
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

// 2026-10-23：本次修改原因：列表条件交给服务器执行，计数与翻页均以完整数据库为准。
export function getArticleSummary(platformId = ''): Promise<ArticleSummary> {
  return requestLibrary(`/summary${platformId ? `?platform_id=${encodeURIComponent(platformId)}` : ''}`)
}

export function getLibraryArticles(filters: Record<string, string | number>): Promise<ArticlePage> {
  const search = new URLSearchParams()
  Object.entries(filters).forEach(([key, value]) => { if (String(value)) search.set(key, String(value)) })
  return requestLibrary(`/articles?${search.toString()}`)
}

export const getLibraryArticle = (id: string) => requestLibrary<LibraryArticleDetail>(`/articles/${encodeURIComponent(id)}`)
// 2026-10-23：本次修改原因：新录入表单一次写入文章及可追溯元数据。
export const createLibraryArticle = (article: Record<string, unknown>) =>
  requestLibrary<LibraryArticleDetail>('/articles', json('POST', article))
// 2026-10-24：本次修改原因：人工补齐候选后可暂存草稿，批量收录成功再清理草稿。
// export const getCandidateDrafts = () => requestLibrary<Record<string, Record<string, unknown>>>('/candidate-drafts') // 2026-10-24：原宽泛草稿类型留作对照。
// 2026-10-24：本次修改原因：调用方以文章编辑字段类型读取草稿，不丢失类型约束。
export const getCandidateDrafts = <T,>() => requestLibrary<Record<string, T>>('/candidate-drafts')
export const saveCandidateDraft = (candidateKey: string, value: unknown) =>
  requestLibrary<{ candidate_key: string }>('/candidate-drafts', json('POST', { candidate_key: candidateKey, value }))
export const deleteCandidateDraft = (candidateKey: string) =>
  requestLibrary<{ candidate_key: string }>(`/candidate-drafts?candidate_key=${encodeURIComponent(candidateKey)}`, { method: 'DELETE' })
export const updateLibraryArticle = (id: string, changes: Record<string, unknown>) =>
  requestLibrary<LibraryArticleDetail>(`/articles/${encodeURIComponent(id)}`, json('PATCH', changes))
// 2026-10-24：本次修改原因：样本管理的确认删除操作调用文章库接口，并保留后端引用冲突提示。
// export const deleteLibraryArticle = (id: string) => requestLibrary<null>(`/articles/${encodeURIComponent(id)}`, { method: 'DELETE' })  // 2026-10-24：原直接透传 405 的处理留作对照。
// 2026-10-24：本次修改原因：运行中的旧后端未注册 DELETE 时给出明确的重启提示。
export async function deleteLibraryArticle(id: string): Promise<void> {
  try { await requestLibrary<null>(`/articles/${encodeURIComponent(id)}`, { method: 'DELETE' }) }
  catch (reason) {
    if (reason instanceof Error && reason.message === 'Method Not Allowed') {
      throw new Error('当前后端尚未加载删除接口，请重启 API 服务后重试')
    }
    throw reason
  }
}
export const addArticleMetric = (id: string, metric: Record<string, unknown>) =>
  requestLibrary<ArticleMetric>(`/articles/${encodeURIComponent(id)}/metrics`, json('POST', metric))

// 2026-10-23：本次修改原因：画像分析与策略草稿分两步，用户可先检查画像及其代表文章。
export const getStyleProfiles = (platformId = '') =>
  requestLibrary<StyleProfile[]>(`/profiles${platformId ? `?platform_id=${encodeURIComponent(platformId)}` : ''}`)
export const getAnalysisRuns = () => requestLibrary<AnalysisRun[]>('/analysis-runs?limit=10')
export const getStyleProfile = (id: string) => requestLibrary<StyleProfile>(`/profiles/${encodeURIComponent(id)}`)
export const analyzeStyleProfile = (scope: {
  platform_id: string; category_id: string; format_id: string | null;
  audience_id: string | null; include_ai: boolean
}) => requestLibrary<StyleProfile>('/profiles/analyze', json('POST', scope))
export const createProfileStrategy = (id: string) =>
  requestLibrary<{ strategy_id: string; profile_id: string; version: number }>(
    `/profiles/${encodeURIComponent(id)}/strategy-draft`, { method: 'POST' })
