// 2026-10-23：本次修改原因：为多页面内容工作台集中定义选项、样本、策略和生成任务接口。
export type OptionKind = 'category' | 'audience' | 'format' | 'platform'

export interface ContentOption {
  id: string
  kind: OptionKind
  label: string
  active: boolean
  position: number
}

export interface ContentSample {
  id: string
  title: string
  body_text: string
  platform_id: string
  category_id: string
  format_id: string | null
  source_url: string | null
  quality_score: number
  rights_confirmed: boolean
  created_at: string
}

export type SampleInput = Omit<ContentSample, 'id' | 'created_at'>

export interface StrategyGuide {
  title_rule: string
  keyword_rule: string
  language_rule: string
  structure_rule: string
  avoid_rule: string
}

export interface ContentStrategy {
  id: string
  title: string
  platform_id: string
  category_id: string | null
  format_id: string | null
  guide: StrategyGuide
  status: 'draft' | 'published' | 'archived'
  version: number
  sample_ids: string[]
  created_at: string
  // 2026-10-23：本次修改原因：显示自动提炼策略所依据的文章来源。
  references: { title: string; source_url: string; provider: string }[]
  // 2026-10-23：本次修改原因：内容策略可显示来自哪一版文章风格画像。
  profile_id: string | null
  profile_audience_id: string | null
}

// 2026-10-23：本次修改原因：品牌库可维护介绍与带出处的关键事实。
export interface BrandFact { label: string; value: string; source: string }
export interface BrandInput { name: string; description: string; facts: BrandFact[] }
export interface Brand extends BrandInput {
  id: string
  active: boolean
  version: number
  created_at: string
}

export interface StrategyInput {
  title: string
  platform_id: string
  category_id: string | null
  format_id: string | null
  guide: StrategyGuide
}

export interface WorkspaceTask {
  task_id: string
  status: 'pending' | 'running' | 'completed' | 'failed'
  created_at: string
  request: {
    topic: string
    category_id: string | null
    category_label: string | null
    audience: string
    content_type: string
    channel: string
    extra_prompt: string | null
    strategy_id: string | null
    strategy_version: number | null
    // 2026-10-23：本次修改原因：在任务详情中展示提交时冻结的品牌资料。
    brand_snapshot: { name: string; version: number; description: string; facts: BrandFact[] } | null
  }
}

export interface WorkspaceResult {
  task_id: string
  status: string
  provider: string
  model: string
  title: string | null
  summary: string | null
  body_markdown: string | null
  error: string | null
  input_tokens: number
  output_tokens: number
  review_required: boolean
  completed_at: string
  // 2026-10-23：本次修改原因：前端区分 AI 原稿和已保存的人工修订稿。
  edited_title: string | null
  edited_summary: string | null
  edited_body_markdown: string | null
  edited_at: string | null
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch('/api/v1' + path, init)
  if (!response.ok) {
    const body = await response.json().catch(() => null) as { detail?: string } | null
    throw new Error(body?.detail ?? `请求失败（HTTP ${response.status}）`)
  }
  return await response.json() as T
}

function json(method: string, body: unknown): RequestInit {
  return { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }
}

export const getOptions = (all = false) =>
  request<ContentOption[]>(`/options?include_inactive=${all}`)
export const addOption = (kind: OptionKind, label: string) =>
  request<ContentOption>('/options', json('POST', { kind, label }))
export const renameOption = (id: string, label: string) =>
  request<ContentOption>(`/options/${encodeURIComponent(id)}`, json('PATCH', { label }))
export const setOptionActive = (id: string, active: boolean) =>
  request<ContentOption>(`/options/${encodeURIComponent(id)}`, json('PATCH', { active }))

export const getSamples = () => request<ContentSample[]>('/samples')
export const addSample = (sample: SampleInput) =>
  request<ContentSample>('/samples', json('POST', sample))

// 2026-10-23：本次修改原因：让样本库按需搜索公众号候选并预览正文，密钥仅由后端读取。
export interface RedFoxCandidate {
  id: string
  title: string
  summary: string
  author: string
  url: string
  published_at: string
  read_count: number | string | null
  // 2026-10-23：本次修改原因：榜单指标和正文可用性按接口原值展示，缺失值不补 0。
  like_count?: number | string | null
  watch_count?: number | string | null
  share_count?: number | string | null
  comment_count?: number | string | null
  // 2026-10-24：本次修改原因：公众号关键词的收藏/打赏和榜单互动量进入统一候选映射。
  save_count?: number | string | null
  reward_count?: number | string | null
  interactive_count?: number | string | null
  // 2026-10-24：本次修改原因：候选账号规模可用于预填样本元数据。
  account_followers?: number | string | null
  category?: string
  growth_rate?: number | string | null
  rank_position?: number | string | null
  work_role?: string
  body_text?: string
  // 2026-10-24：本次修改原因：保留三种公众号接口的请求参数及原始非正文返回字段。
  source_data?: { provider: string; method: string; request: Record<string, unknown>;
    response: Record<string, unknown> }
  // 2026-10-23：本次修改原因：增长榜正文超出样本字段上限时向编辑显示截断状态。
  body_truncated?: boolean
  body_status?: 'rank_content_unverified' | 'detail_required'
  // 2026-10-23：本次修改原因：跨平台候选标明来源与文章/话题类型，避免把热点直接入库。
  platform?: string
  kind?: 'article' | 'topic'
  collected?: boolean
}

export interface RedFoxSearchResult {
  keyword: string
  // start_date: string // 2026-10-23：原热门库必有日期的定义暂留供对照。
  // end_date: string // 2026-10-23：原热门库必有日期的定义暂留供对照。
  // 2026-10-23：本次修改原因：优质库候选不以七日窗口搜索。
  start_date: string | null
  end_date: string | null
  // source: 'quality' | 'hot' // 2026-10-23：原仅支持关键词来源的类型保留供对照。
  // 2026-10-23：本次修改原因：候选结果也可来自三种公众号榜单。
  // source: 'quality' | 'hot' | 'ten_w' | 'original' | 'growth' // 2026-10-23：原公众号来源类型暂留供对照。
  // 2026-10-23：本次修改原因：发现结果增加跨平台采集方式。
  source: 'quality' | 'hot' | 'ten_w' | 'original' | 'growth' | 'keyword' | 'dark_horse' | 'daily' | 'weekly' | 'top10' | 'hotspot'
  platform?: string
  category?: string | null
  rank_date?: string | null
  // total_count?: number // 2026-10-23：原假定所有接口都知道总数的类型暂留供对照。
  total_count?: number | null
  // 2026-10-23：本次修改原因：候选列表按提供商实际数据翻页，未知总数时使用下一页标记。
  page?: number
  page_size?: number
  has_more?: boolean
  // 2026-10-23：本次修改原因：展示 RedFox 已返回但条目不完整的情况。
  warnings?: string[]
  items: RedFoxCandidate[]
}

export interface RedFoxArticle {
  // 2026-10-23：本次修改原因：样本表单说明正文来自 DeepSeek Fetch 还是公开原文页。
  // origin: "deepseek_fetch" | "public_page" // 2026-10-23：原来源类型保留供对照。
  // 2026-10-23：本次修改原因：正文来源增加 Playwright 浏览器。
  origin: "playwright_browser" | "public_page"
  source_url: string
  title: string
  body_text: string
  body_available: boolean
  truncated: boolean
}

export const getRedFoxStatus = () => request<{ configured: boolean }>('/redfox/status')
// export const searchRedFoxWechat = (keyword: string) => request<RedFoxSearchResult>(`/redfox/wechat/search?keyword=${encodeURIComponent(keyword)}`) // 2026-10-23：原固定搜索源暂留供对照。
// 2026-10-23：本次修改原因：前端可选择优质库搜索或热门文章发现。
export const searchRedFoxWechat = (keyword: string, source: 'quality' | 'hot' = 'quality') =>
  request<RedFoxSearchResult>(`/redfox/wechat/search?keyword=${encodeURIComponent(keyword)}&source=${source}`)
// 2026-10-23：本次修改原因：按榜单类型传入各自需要的日期和类目，不把阅读增长误当作文章分类榜。
export const getRedFoxWechatRank = (input: {
  source: 'ten_w' | 'original' | 'growth'
  category?: string
  start_date?: string
  end_date?: string
  rank_date?: string
}) => request<RedFoxSearchResult>(`/redfox/wechat/rank?${new URLSearchParams(
  Object.entries(input).filter(([, value]) => Boolean(value)) as [string, string][]
).toString()}`)
// 2026-10-23：本次修改原因：平台、采集方式与条件联动后通过统一发现接口查询。
export const discoverRedFoxCandidates = (input: {
  platform: string; method: string; keyword?: string; category?: string
  start_date?: string; end_date?: string; rank_date?: string; hotspot_platform?: string; page?: string
}) => request<RedFoxSearchResult>(`/redfox/discover?${new URLSearchParams(
  Object.entries(input).filter(([, value]) => Boolean(value)) as [string, string][]
).toString()}`)
// 2026-10-23：本次修改原因：用户点“收录”时才按需读取非公众号作品详情。
export const getRedFoxCandidateDetail = (input: { platform: string; work_id: string; url?: string }) =>
  request<{ title: string; body_text: string; body_truncated: boolean; source_url: string }>(
    '/redfox/discover/detail', json('POST', input))
export const getRedFoxWechatArticle = (url: string) =>
  request<RedFoxArticle>('/redfox/wechat/article', json('POST', { url }))
// 2026-10-23：本次修改原因：从候选文章一键生成待审核的写作策略。
// export const analyzeRedFoxWechatArticle = (payload: { url: string; title: string; category_id: string; format_id: string | null }) => request<ContentStrategy>('/redfox/wechat/analyze', json('POST', payload)) // 2026-10-23：原分析入口暂留供对照。
// 2026-10-23：本次修改原因：由策略页统一提交候选全文分析，样本库只传递候选元数据。
export interface StrategyCandidateInput {
  url: string
  title: string
  category_id: string
  format_id: string | null
}
export const analyzeStrategyCandidate = (payload: StrategyCandidateInput) =>
  request<ContentStrategy>('/strategies/analyze-candidate', json('POST', payload))

// 2026-10-23：本次修改原因：前端管理品牌草稿和已启用版本。
export const getBrands = (all = true) => request<Brand[]>(`/brands?include_inactive=${all}`)
export const createBrand = (payload: BrandInput) => request<Brand>('/brands', json('POST', payload))
export const updateBrand = (id: string, payload: BrandInput) =>
  request<Brand>(`/brands/${encodeURIComponent(id)}`, json('PUT', payload))
export const activateBrand = (id: string) =>
  request<Brand>(`/brands/${encodeURIComponent(id)}/activate`, { method: 'POST' })
export const archiveBrand = (id: string) =>
  request<Brand>(`/brands/${encodeURIComponent(id)}/archive`, { method: 'POST' })

export const getStrategies = () => request<ContentStrategy[]>('/strategies')
export const createStrategy = (strategy: StrategyInput) =>
  request<ContentStrategy>('/strategies', json('POST', strategy))
export const extractStrategy = (filters: {
  platform_id: string
  category_id: string | null
  format_id: string | null
  // 2026-10-23：本次修改原因：将用户明确勾选的样本传给后端。
  sample_ids: string[]
}) => request<ContentStrategy>('/strategies/extract', json('POST', filters))
export const updateStrategy = (id: string, title: string, guide: StrategyGuide) =>
  request<ContentStrategy>(`/strategies/${encodeURIComponent(id)}`, json('PATCH', { title, guide }))
export const publishStrategy = (id: string) =>
  request<ContentStrategy>(`/strategies/${encodeURIComponent(id)}/publish`, { method: 'POST' })
export const archiveStrategy = (id: string) =>
  request<ContentStrategy>(`/strategies/${encodeURIComponent(id)}/archive`, { method: 'POST' })
// 2026-10-23：本次修改原因：草稿可用新的样本选择覆盖并重新提炼；删除版本从列表移除。
export const regenerateStrategy = (id: string, sampleIds: string[]) =>
  request<ContentStrategy>(`/strategies/${encodeURIComponent(id)}/regenerate`, json('POST', { sample_ids: sampleIds }))
export const deleteStrategy = async (id: string): Promise<void> => {
  const response = await fetch(`/api/v1/strategies/${encodeURIComponent(id)}`, { method: 'DELETE' })
  if (!response.ok) {
    const body = await response.json().catch(() => null) as { detail?: string } | null
    throw new Error(body?.detail ?? `删除失败（HTTP ${response.status}）`)
  }
}
// export const getMatchingStrategy = (platformId: string, categoryId: string, formatId: string) => // 2026-10-23：原调用签名保留供对照。
// 2026-10-23：本次修改原因：生成页预览策略时同时传送目标受众，与后端任务校验一致。
export const getMatchingStrategy = (platformId: string, categoryId: string, formatId: string, audienceId: string) =>
  request<ContentStrategy | null>(
    // `/strategies/match?platform_id=${encodeURIComponent(platformId)}&category_id=${encodeURIComponent(categoryId)}&format_id=${encodeURIComponent(formatId)}`, // 2026-10-23：原查询保留供对照。
    `/strategies/match?platform_id=${encodeURIComponent(platformId)}&category_id=${encodeURIComponent(categoryId)}&format_id=${encodeURIComponent(formatId)}&audience_id=${encodeURIComponent(audienceId)}`,
  )

export const createWorkspaceTask = (payload: unknown) =>
  request<WorkspaceTask>('/tasks', json('POST', payload))
export const getWorkspaceTask = (id: string) =>
  request<WorkspaceTask>(`/tasks/${encodeURIComponent(id)}`)
export const getWorkspaceResult = (id: string) =>
  request<WorkspaceResult>(`/tasks/${encodeURIComponent(id)}/result`)
// 2026-10-23：本次修改原因：将编辑后的内容持久化为独立人工修订稿。
export const saveWorkspaceDraft = (id: string, draft: { title: string; summary: string; body_markdown: string }) =>
  request<WorkspaceResult>(`/tasks/${encodeURIComponent(id)}/draft`, json("PUT", draft))
