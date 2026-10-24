// 2026-10-24：本次修改原因：Stage 2C 使用 v2 文章领域契约构建样本管理、发现收录和清洗准备入口。
import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react'
import DateRangePicker from '../components/DateRangePicker'
import V2ArticleEditorDialog from '../components/V2ArticleEditorDialog'
import type { ContentOption } from '../workspaceApi'
import {
  collectV2Candidate, collectV2Candidates, createV2Article, discoverV2Wechat,
  getV2Article, getV2Articles, getV2Candidate, getV2DiscoverySession, getV2WechatCategories,
  patchV2Candidate, updateV2Article,
  type V2Article, type V2ArticleEditable, type V2Candidate, type V2RightsScope,
} from '../articleLibraryV2Api'
import './article-library-v2.css'

type Props = { options: ContentOption[] }
type Tab = 'articles' | 'discovery' | 'preparation'
type QueryMethod = 'keyword_search' | 'ten_w_rank' | 'original_rank'
type EditState = { mode: 'candidate' | 'manual' | 'edit'; candidate?: V2Candidate; article?: V2Article }

const SESSION_KEY = 'ai4geo.articleLibraryV2.discoverySession'
const PAGE_SIZE = 20
const CANDIDATE_PAGE_SIZE = 10

function dayOffset(days: number) {
  const value = new Date()
  value.setDate(value.getDate() + days)
  return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`
}

function emptyScope(): V2RightsScope {
  // 2026-10-24：本次修改原因：收录动作只授权样本库保存，其他用途范围保持未知。
  return { store: true, local_clean: null, third_party_llm: null, generation_reference: null }
}

// 2026-10-24：本次修改原因：旧候选标准时间为空时，从来源原文提取可确认的日历日期。
function providerPublishDate(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const match = value.trim().match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/)
  if (!match) return null
  const date = `${match[1]}-${match[2].padStart(2, '0')}-${match[3].padStart(2, '0')}`
  const parsed = new Date(`${date}T00:00:00Z`)
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === date ? date : null
}

// 2026-10-24：本次修改原因：榜单请求类目与内部类目名称一致时预填，保留用户核对和修改入口。
function candidateValue(candidate: V2Candidate, options: ContentOption[]): V2ArticleEditable {
  const merged = { ...candidate.normalized, ...(candidate.edit_draft || {}) }
  const rawPublished = candidate.normalized.published_at_raw ?? candidate.raw_item?.publishTime ?? candidate.raw_item?.publicTime
  const publishedAt = merged.published_at || providerPublishDate(rawPublished)
  const category = options.find((item) => item.kind === 'category' &&
    (item.id === merged.category_id || item.label === merged.category_id))?.id ||
    options.find((item) => item.kind === 'category' && item.label === merged.requested_source_category)?.id ||
    merged.category_id || null
  return { platform_id: merged.platform_id || 'platform_01', category_id: category,
    title: merged.title || '', summary: merged.summary || '', body_text: merged.body_text || '',
    author_name: merged.author_name || '', published_at: publishedAt,
    article_url: merged.article_url || null, tags: merged.tags || [],
    content_format_id: merged.content_format_id || null, genre_id: merged.genre_id || null,
    audience_id: merged.audience_id || null, topic: merged.topic || null,
    review_status: merged.review_status || 'pending', content_status: merged.content_status || 'unknown',
    quality_score: merged.quality_score ?? null }
}

function articleValue(article: V2Article): V2ArticleEditable {
  return { platform_id: article.platform_id, category_id: article.category_id,
    content_format_id: article.content_format_id || null, genre_id: article.genre_id || null,
    audience_id: article.audience_id || null, topic: article.topic || null, tags: article.tags || [],
    title: article.title, summary: article.summary || '', body_text: article.body_text || '',
    author_name: article.author_name || '', published_at: article.published_at || null,
    article_url: article.article_url || null, review_status: article.review_status,
    content_status: article.content_status, quality_score: article.quality_score }
}

function patchable(value: V2ArticleEditable): Partial<V2ArticleEditable> {
  const patch: Partial<V2ArticleEditable> = { ...value }
  delete patch.platform_id
  return patch
}

function changedPatch(before: V2ArticleEditable, after: V2ArticleEditable): Partial<V2ArticleEditable> {
  const left = patchable(before)
  const right = patchable(after)
  const changes: Partial<V2ArticleEditable> = {}
  ;(Object.keys(right) as (keyof typeof right)[]).forEach((key) => {
    if (JSON.stringify(left[key]) !== JSON.stringify(right[key])) {
      Object.assign(changes, { [key]: right[key] })
    }
  })
  return changes
}

function missingCandidate(value: V2ArticleEditable) {
  return [!value.title.trim() && '标题', !value.category_id && '内容类目',
    (value.body_text || '').trim().length < 50 && '正文不足 50 字'].filter(Boolean) as string[]
}

function countText(value: number | null | undefined, raw?: string | null) {
  if (value != null) return value.toLocaleString('zh-CN')
  return raw || '未提供'
}

function optionLabel(options: ContentOption[], id: string | null | undefined) {
  if (!id) return '未填写'
  return options.find((item) => item.id === id)?.label || id
}

export default function ArticleLibraryV2Page({ options }: Props) {
  const [tab, setTab] = useState<Tab>('articles')
  const [articles, setArticles] = useState<V2Article[]>([])
  const [total, setTotal] = useState(0)
  const [articlePage, setArticlePage] = useState(1)
  const [selectedArticleId, setSelectedArticleId] = useState('')
  const [article, setArticle] = useState<V2Article | null>(null)
  const [articleLoading, setArticleLoading] = useState(false)
  // 2026-10-24：本次修改原因：已入库文章改为在右侧详情直接编辑，避免重复打开字段相同的弹窗。
  const [detailDraft, setDetailDraft] = useState<V2ArticleEditable | null>(null)
  const [detailSaving, setDetailSaving] = useState(false)
  const [categoryFilter, setCategoryFilter] = useState('')
  const [formatFilter, setFormatFilter] = useState('')
  const [platformFilter, setPlatformFilter] = useState('')
  const [queryMethod, setQueryMethod] = useState<QueryMethod>('ten_w_rank')
  const [keyword, setKeyword] = useState('')
  const [categories, setCategories] = useState<string[]>([])
  const [rankCategory, setRankCategory] = useState('')
  const [startDate, setStartDate] = useState(() => dayOffset(-7))
  const [endDate, setEndDate] = useState(() => dayOffset(-1))
  const [sortType, setSortType] = useState<'_0' | '_2' | '_4'>('_4')
  const [exactMatch, setExactMatch] = useState(false)
  const [discoverySessionId, setDiscoverySessionId] = useState('')
  const [candidates, setCandidates] = useState<V2Candidate[]>([])
  const [candidatePage, setCandidatePage] = useState(1)
  const [candidateFilter, setCandidateFilter] = useState<'all' | 'uncollected' | 'collected'>('all')
  const [selectedCandidates, setSelectedCandidates] = useState<Record<string, true>>({})
  const [edit, setEdit] = useState<EditState | null>(null)
  const [queryBusy, setQueryBusy] = useState(false)
  const [batchBusy, setBatchBusy] = useState(false)
  const [batchOpen, setBatchOpen] = useState(false)
  const [batchScope, setBatchScope] = useState<V2RightsScope>(emptyScope())
  const [batchEvidence, setBatchEvidence] = useState('')
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  const active = useCallback((kind: ContentOption['kind']) => options.filter((item) => item.kind === kind && item.active), [options])

  const refreshArticles = useCallback(async (page = 1) => {
    const result = await getV2Articles((page - 1) * PAGE_SIZE, PAGE_SIZE, {
      platform_id: platformFilter, category_id: categoryFilter, content_format_id: formatFilter,
    })
    setArticles(result.items)
    setTotal(result.total)
    setArticlePage(page)
  }, [platformFilter, categoryFilter, formatFilter])

  const restoreSession = useCallback(async (id: string) => {
    const first = await getV2DiscoverySession(id, 0, 200)
    // 2026-10-24：本次修改原因：恢复榜单会话时同步还原查询类目，避免表单条件与候选来源不一致。
    const requestCategory = first.request_params.type
    if (typeof requestCategory === 'string') setRankCategory(requestCategory)
    // 2026-10-24：本次修改原因：旧候选没有逐条存请求类目时，从会话白名单参数补回默认类目。
    const attachRequestCategory = (items: V2Candidate[]) => items.map((candidate) => ({
      ...candidate,
      normalized: { ...candidate.normalized,
        requested_source_category: candidate.normalized.requested_source_category ||
          (first.endpoint === 'ten_w_rank' || first.endpoint === 'original_rank' ? requestCategory as string : null) },
    }))
    const restored = attachRequestCategory([...first.candidates])
    for (let offset = restored.length; offset < first.candidate_total; offset += 200) {
      const next = await getV2DiscoverySession(id, offset, 200)
      restored.push(...attachRequestCategory(next.candidates))
    }
    setDiscoverySessionId(id)
    setCandidates(restored)
    setCandidatePage(1)
  }, [])

  useEffect(() => {
    getV2WechatCategories().then((result) => {
      setCategories(result.items)
      setRankCategory((current) => current || result.items[0] || '')
    }).catch((reason) => setError(reason instanceof Error ? reason.message : '公众号类目读取失败'))
    const saved = sessionStorage.getItem(SESSION_KEY)
    if (saved) void restoreSession(saved).catch(() => sessionStorage.removeItem(SESSION_KEY))
  }, [])

  useEffect(() => {
    void refreshArticles(articlePage).catch((reason) => setError(reason instanceof Error ? reason.message : '文章列表读取失败'))
  }, [refreshArticles, articlePage])

  useEffect(() => {
    if (!selectedArticleId) { setArticle(null); return }
    setDetailDraft(null)
    setArticleLoading(true)
    getV2Article(selectedArticleId).then(setArticle)
      .catch((reason) => setError(reason instanceof Error ? reason.message : '文章详情读取失败'))
      .finally(() => setArticleLoading(false))
  }, [selectedArticleId])

  const filteredArticles = useMemo(() => articles, [articles])

  const visibleCandidates = useMemo(() => candidates.filter((item) =>
    candidateFilter === 'all' || (candidateFilter === 'collected'
      ? Boolean(item.collected_article_id) : !item.collected_article_id)), [candidates, candidateFilter])
  const pageCount = Math.max(1, Math.ceil(visibleCandidates.length / CANDIDATE_PAGE_SIZE))
  const currentCandidates = visibleCandidates.slice((candidatePage - 1) * CANDIDATE_PAGE_SIZE,
    candidatePage * CANDIDATE_PAGE_SIZE)
  const selectedRows = candidates.filter((item) => selectedCandidates[item.id] && !item.collected_article_id)
  const eligibleRows = selectedRows.filter((item) => missingCandidate(candidateValue(item, options)).length === 0)
  const selectedCurrentPage = currentCandidates.filter((item) => selectedCandidates[item.id] && !item.collected_article_id)
  // 2026-10-24：本次修改原因：页首全选框需要正确呈现未全选、部分选中和全选三种状态。
  const selectableCurrentPage = currentCandidates.filter((item) => !item.collected_article_id)
  const allPageSelected = selectableCurrentPage.length > 0 && selectedCurrentPage.length === selectableCurrentPage.length
  const somePageSelected = selectedCurrentPage.length > 0 && !allPageSelected

  async function runDiscovery(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (queryMethod === 'keyword_search' && keyword.trim().length < 2) {
      setError('关键词至少输入 2 个字符。'); return
    }
    if (queryMethod !== 'keyword_search' && (!rankCategory || !startDate || !endDate || startDate >= endDate)) {
      setError('请选择有效的榜单类目和日期范围。'); return
    }
    setQueryBusy(true); setError(''); setNotice('')
    try {
      const result = await discoverV2Wechat({ method: queryMethod,
        ...(queryMethod === 'keyword_search' ? { keyword: keyword.trim(), sort_type: sortType, exact_match: exactMatch }
          : { category: rankCategory, start_date: startDate, end_date: endDate }) })
      // 2026-10-24：本次修改原因：即使后端候选映射版本尚未更新，前端也从当前榜单请求条件预填匹配的内部类目。
      const resultCandidates = result.candidates.map((candidate) => ({ ...candidate,
        normalized: { ...candidate.normalized,
          requested_source_category: candidate.normalized.requested_source_category ||
            (queryMethod === 'keyword_search' ? null : rankCategory) },
      }))
      setDiscoverySessionId(result.session_id)
      sessionStorage.setItem(SESSION_KEY, result.session_id)
      setCandidates(resultCandidates)
      setCandidatePage(1); setCandidateFilter('all'); setSelectedCandidates({})
      // setNotice(`查询完成，找到 ${result.count} 条候选。`) // 2026-10-24：查询数量已在候选列表标题行展示，避免重复成功提示。
    } catch (reason) { setError(reason instanceof Error ? reason.message : '查询失败') }
    finally { setQueryBusy(false) }
  }

  async function reloadSession() {
    if (discoverySessionId) await restoreSession(discoverySessionId)
  }

  function toggleCurrentPage(checked: boolean) {
    setSelectedCandidates((current) => {
      const next = { ...current }
      currentCandidates.forEach((candidate) => {
        if (candidate.collected_article_id) return
        if (checked) next[candidate.id] = true
        else delete next[candidate.id]
      })
      return next
    })
  }

  async function collectBatch() {
    if (batchScope.store !== true || eligibleRows.length === 0) return
    setBatchBusy(true); setError(''); setNotice('')
    try {
      const overridesByCandidate: Record<string, Partial<V2ArticleEditable>> = {}
      eligibleRows.forEach((candidate) => {
        const value = candidateValue(candidate, options)
        if (!candidate.normalized.category_id && value.category_id) {
          overridesByCandidate[candidate.id] = { category_id: value.category_id }
        }
      })
      const result = await collectV2Candidates(eligibleRows.map((candidate) => [candidate.id, candidate.row_version]),
        batchScope, batchEvidence || undefined, overridesByCandidate)
      await reloadSession()
      await refreshArticles(1)
      setBatchOpen(false); setSelectedCandidates({})
      setNotice(`已批量收录 ${result.count} 篇文章。`)
    } catch (reason) { setError(reason instanceof Error ? reason.message : '批量收录失败') }
    finally { setBatchBusy(false) }
  }

  function sourceForCandidate(candidate: V2Candidate) {
    return { provider: candidate.provider || 'redfox', endpoint: candidate.endpoint || '查询会话来源',
      raw_item: candidate.raw_item || null }
  }

  async function openCandidate(candidate: V2Candidate) {
    if (candidate.collected_article_id) {
      setTab('articles')
      setSelectedArticleId(candidate.collected_article_id)
      return
    }
    try {
      const full = await getV2Candidate(candidate.id)
      setEdit({ mode: 'candidate', candidate: { ...candidate, ...full } })
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '候选来源读取失败')
      setEdit({ mode: 'candidate', candidate })
    }
  }

  async function saveEditor(value: V2ArticleEditable, scope: V2RightsScope, evidence: string) {
    if (!edit) return
    if (edit.mode === 'candidate' && edit.candidate) {
      const candidate = edit.candidate
      const before = candidateValue(candidate, options)
      const overrides = changedPatch(before, value)
      // 2026-10-24：本次修改原因：单篇收录也提交按用户请求类目匹配出的默认内部类目，避免编辑器看似有值但服务端仍收到空值。
      if (!candidate.normalized.category_id && value.category_id) overrides.category_id = value.category_id
      // 2026-10-24：本次修改原因：单篇收录将从原始响应回退显示的发布时间写入标准文章字段。
      if (!candidate.normalized.published_at && value.published_at) overrides.published_at = value.published_at
      await collectV2Candidate(candidate.id, candidate.row_version, scope, evidence || undefined,
        Object.keys(overrides).length ? overrides : undefined)
      await reloadSession(); await refreshArticles(1)
      setEdit(null); setNotice('文章已收录到样本管理。')
    } else if (edit.mode === 'manual') {
      await createV2Article(value, scope, evidence || undefined)
      await refreshArticles(1)
      setEdit(null); setNotice('手动录入文章已保存。')
    } else if (edit.mode === 'edit' && edit.article) {
      const patch = changedPatch(articleValue(edit.article), value)
      const saved = await updateV2Article(edit.article.id, edit.article.row_version, patch)
      setArticle(await getV2Article(saved.id)); await refreshArticles(articlePage)
      setEdit(null); setNotice('文章修改已保存为新修订。')
    }
  }

  async function saveCandidateDraft(value: V2ArticleEditable) {
    if (!edit?.candidate) return
    const before = candidateValue(edit.candidate, options)
    const patch = changedPatch(before, value)
    if (Object.keys(patch).length) {
      await patchV2Candidate(edit.candidate.id, edit.candidate.row_version, patch)
      await reloadSession()
    }
    setEdit(null); setNotice('候选补充已保存到当前查询会话。')
  }

  function toggleCandidate(candidate: V2Candidate) {
    if (candidate.collected_article_id) return
    setSelectedCandidates((current) => {
      const next = { ...current }
      if (next[candidate.id]) delete next[candidate.id]
      else next[candidate.id] = true
      return next
    })
  }

  // 2026-10-24：本次修改原因：右侧详情就地保存沿用乐观锁和修订 API，与原编辑弹窗保持相同的数据契约。
  async function saveDetailDraft() {
    if (!article || !detailDraft) return
    const patch = changedPatch(articleValue(article), detailDraft)
    if (!Object.keys(patch).length) { setDetailDraft(null); return }
    setDetailSaving(true); setError('')
    try {
      await updateV2Article(article.id, article.row_version, patch)
      setArticle(await getV2Article(article.id))
      await refreshArticles(articlePage)
      setDetailDraft(null)
      setNotice('文章修改已保存为新修订。')
    } catch (reason) { setError(reason instanceof Error ? reason.message : '保存文章修改失败') }
    finally { setDetailSaving(false) }
  }

  return <div className="v2LibraryPage">
    {/* 旧页面标题及说明保留作回溯；栏目导航已能标识模块，移除重复标题说明。
    <header className="v2LibraryHeader"><div><h1>参考文章库</h1>
      <p>管理文章资产、核对来源，并为清洗与分析准备可靠数据。</p></div>
      {tab === 'articles' && <div className="v2Summary"><div><strong>{total}</strong><span>入库文章</span></div>
        <div><strong>{articles.filter((item) => item.review_status === 'pending').length}</strong><span>本页待核对</span></div>
        <div><strong>{articles.filter((item) => item.content_status === 'complete').length}</strong><span>本页正文完整</span></div></div>}
      {tab === 'discovery' && <button className="primaryButton" type="button"
        onClick={() => setEdit({ mode: 'manual' })}>手动录入</button>}
    </header> */}
    {/* 旧手动录入页头入口保留作回溯；入口移入查询表单，与查询按钮相邻。
    {tab === 'discovery' && <header className="v2LibraryHeader v2DiscoveryHeader">
      <button className="primaryButton" type="button" onClick={() => setEdit({ mode: 'manual' })}>手动录入</button>
    </header>} */}

    <nav className="v2LibraryTabs" aria-label="文章库视图">
      <button type="button" className={tab === 'articles' ? 'active' : ''} onClick={() => setTab('articles')}>样本管理</button>
      <button type="button" className={tab === 'discovery' ? 'active' : ''} onClick={() => setTab('discovery')}>发现与录入</button>
      <button type="button" className={tab === 'preparation' ? 'active' : ''} onClick={() => setTab('preparation')}>清洗与准备</button>
    </nav>

    {error && <div className="alert error" role="alert">{error}<button className="textButton" type="button" onClick={() => setError('')}>关闭</button></div>}
    {notice && tab !== 'articles' && <div className="alert success" role="status">{notice}<button className="textButton" type="button" onClick={() => setNotice('')}>关闭</button></div>}

    {tab === 'articles' && <>
      {/* 旧概览行保留作布局回溯：筛选器与统计卡现在并排显示。
      <div className="v2OverviewRow"><div className="v2Summary"><div><strong>{total}</strong><span>入库文章</span></div>
        <div><strong>{articles.filter((item) => item.review_status === 'pending').length}</strong><span>本页待核对</span></div>
        <div><strong>{articles.filter((item) => item.content_status === 'complete').length}</strong><span>本页正文完整</span></div></div>
      <div className="v2Filters">
          <label>平台<select value={platformFilter} onChange={(event) => { setPlatformFilter(event.target.value); setArticlePage(1) }}>
          <option value="">全部平台</option>{active('platform').map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
        </select></label>
        <label>类目<select value={categoryFilter} onChange={(event) => { setCategoryFilter(event.target.value); setArticlePage(1) }}>
          <option value="">全部类目</option>{active('category').map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
        </select></label>
        <label>体裁<select value={formatFilter} onChange={(event) => { setFormatFilter(event.target.value); setArticlePage(1) }}>
          <option value="">全部体裁</option>{active('format').map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
        </select></label>
      </div></div> */}
      {/* 2026-10-24：本次修改原因：导航上移后，筛选靠左、紧凑统计卡靠右共用一行。 */}
      <div className="v2OverviewRow"><div className="v2Filters">
        <label>平台<select value={platformFilter} onChange={(event) => { setPlatformFilter(event.target.value); setArticlePage(1) }}>
          <option value="">全部平台</option>{active('platform').map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
        </select></label>
        <label>类目<select value={categoryFilter} onChange={(event) => { setCategoryFilter(event.target.value); setArticlePage(1) }}>
          <option value="">全部类目</option>{active('category').map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
        </select></label>
        <label>体裁<select value={formatFilter} onChange={(event) => { setFormatFilter(event.target.value); setArticlePage(1) }}>
          <option value="">全部体裁</option>{active('format').map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
        </select></label>
      </div><div className="v2Summary"><div><strong>{total}</strong><span>入库文章</span></div>
        <div><strong>{articles.filter((item) => item.review_status === 'pending').length}</strong><span>本页待核对</span></div>
        <div><strong>{articles.filter((item) => item.content_status === 'complete').length}</strong><span>本页正文完整</span></div></div></div>
      <div className={selectedArticleId ? 'v2Workspace hasSelection' : 'v2Workspace'}>
      <section className="v2ArticleListPanel">
        <div className="v2PanelHeading"><h2>入库文章</h2><span>数据库共 {total} 篇</span></div>
        {filteredArticles.length === 0 ? <div className="v2Empty">当前页没有匹配文章。</div> : filteredArticles.map((item) =>
          <button key={item.id} type="button" className={selectedArticleId === item.id ? 'v2ArticleRow selected' : 'v2ArticleRow'}
            onClick={() => { setSelectedArticleId(item.id); setDetailDraft(null) }}
            title="单击查看详情并可在右侧直接编辑">
            <strong>{item.title}</strong><span>{optionLabel(options, item.platform_id)} · {optionLabel(options, item.category_id)}
              {item.author_name ? ` · ${item.author_name}` : ''}</span>
            <small>{item.review_status === 'ready' ? '已核对' : item.review_status === 'excluded' ? '已排除' : '待核对'}
              {' · 正文 '}{item.content_status === 'complete' ? '完整' : item.content_status === 'partial' ? '部分' : '待确认'}
              {' · '}{item.published_at ? item.published_at.slice(0, 10) : '发布时间未填写'}</small>
          </button>)}
        <div className="v2Pager"><button type="button" className="secondaryButton" disabled={articlePage <= 1}
          onClick={() => void refreshArticles(articlePage - 1)}>上一页</button>
          <span>第 {articlePage} / {Math.max(1, Math.ceil(total / PAGE_SIZE))} 页</span>
          <button type="button" className="secondaryButton" disabled={articlePage * PAGE_SIZE >= total}
            onClick={() => void refreshArticles(articlePage + 1)}>下一页</button></div>
      </section>
      {selectedArticleId && <section className="v2ArticleDetailPanel">
        {articleLoading || !article ? <p>正在加载文章详情…</p> : <>
          <div className="v2PanelHeading">
            {detailDraft
              ? <input className="v2DetailInlineInput v2DetailTitleInput" value={detailDraft.title}
                onChange={(event) => setDetailDraft({ ...detailDraft, title: event.target.value })} aria-label="标题" />
              : <h2>{article.title}</h2>}
            {detailDraft
              ? <div className="v2DetailEditActions">
                <button className="secondaryButton" type="button" disabled={detailSaving} onClick={() => setDetailDraft(null)}>取消</button>
                <button className="primaryButton" type="button" disabled={detailSaving} onClick={() => void saveDetailDraft()}>
                  {detailSaving ? '保存中…' : '保存修改'}</button>
              </div>
              : <button className="secondaryButton" type="button" onClick={() => setDetailDraft(articleValue(article))}>编辑文章</button>}
          </div>
          <dl className="v2DetailGrid">
            <div><dt>平台 / 类目</dt><dd>{optionLabel(options, article.platform_id)} / {detailDraft
              ? <select className="v2DetailInlineSelect" value={detailDraft.category_id || ''}
                onChange={(event) => setDetailDraft({ ...detailDraft, category_id: event.target.value || null })}>
                <option value="">选择类目</option>{active('category').map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
                {detailDraft.category_id && !active('category').some((item) => item.id === detailDraft.category_id) &&
                  <option value={detailDraft.category_id}>{detailDraft.category_id}</option>}
              </select> : optionLabel(options, article.category_id)}</dd></div>
            <div><dt>作者 / 发布时间</dt><dd className={detailDraft ? 'v2DetailInlinePair' : ''}>{detailDraft
              ? <><input className="v2DetailInlineInput" value={detailDraft.author_name || ''} placeholder="作者"
                onChange={(event) => setDetailDraft({ ...detailDraft, author_name: event.target.value })} />
                <input className="v2DetailInlineInput" type="date" value={(detailDraft.published_at || '').slice(0, 10)}
                  onChange={(event) => setDetailDraft({ ...detailDraft, published_at: event.target.value || null })} /></>
              : <>{article.author_name || '未填写'} / {article.published_at || '未填写'}</>}</dd></div>
            <div className="v2Wide"><dt>原文链接</dt><dd>{detailDraft
              ? <input className="v2DetailInlineInput" type="url" value={detailDraft.article_url || ''}
                onChange={(event) => setDetailDraft({ ...detailDraft, article_url: event.target.value || null })} />
              : article.article_url ? <a href={article.article_url} target="_blank" rel="noreferrer">打开原文 ↗</a> : '未提供'}</dd></div>
            <div className="v2Wide"><dt>摘要</dt><dd>{detailDraft
              ? <textarea className="v2DetailInlineTextarea" rows={3} value={detailDraft.summary || ''}
                onChange={(event) => setDetailDraft({ ...detailDraft, summary: event.target.value || null })} />
              : article.summary || '未提供'}</dd></div>
            <div className="v2Wide"><dt>正文</dt><dd className={detailDraft ? '' : 'v2ArticleBody'}>{detailDraft
              ? <textarea className="v2DetailInlineTextarea v2DetailBodyInput" rows={16} value={detailDraft.body_text || ''}
                onChange={(event) => setDetailDraft({ ...detailDraft, body_text: event.target.value || null })} />
              : article.body_text || '未提供'}</dd></div>
            <div><dt>复核状态</dt><dd>{detailDraft
              ? <select className="v2DetailInlineSelect" value={detailDraft.review_status || 'pending'}
                onChange={(event) => setDetailDraft({ ...detailDraft, review_status: event.target.value })}>
                <option value="pending">待核对</option><option value="ready">已核对</option><option value="excluded">已排除</option>
              </select> : article.review_status}</dd></div>
            <div><dt>正文状态</dt><dd>{detailDraft
              ? <select className="v2DetailInlineSelect" value={detailDraft.content_status || 'unknown'}
                onChange={(event) => setDetailDraft({ ...detailDraft,
                  content_status: event.target.value as V2ArticleEditable['content_status'] })}>
                <option value="unknown">待确认</option><option value="complete">完整</option>
                <option value="partial">部分正文</option><option value="missing">缺少正文</option>
              </select> : article.content_status}</dd></div>
            {/* 旧权限范围展示保留作审计回溯；内部授权状态不再作为文章详情字段展示。 */}
            {/* <div className="v2Wide"><dt>权限范围</dt><dd>{JSON.stringify(article.rights_scope)}</dd></div> */}
          </dl>
          <section className="v2Metrics"><h3>传播指标快照</h3>
            {!article.metrics?.length ? <p>尚无指标快照。</p> : article.metrics.map((metric) => <div key={metric.id}>
              <span>{metric.source_label} · {metric.observed_at.slice(0, 10)}</span>
              <p>阅读 {countText(metric.read_exact, metric.read_raw)}{metric.read_lower_bound ? `（≥${metric.read_lower_bound.toLocaleString('zh-CN')}）` : ''}
                {' · 点赞 '}{countText(metric.likes)} · 在看 {countText(metric.watch_count)} · 评论 {countText(metric.comments)}
                {' · 转发 '}{countText(metric.shares)} · 收藏 {countText(metric.saves)}</p></div>)}
          </section>
          <details className="v2SourceDetails"><summary>抓取来源字段汇总</summary>
            <p>字段来源与转换</p><pre>{JSON.stringify(article.field_provenance, null, 2)}</pre>
            {(article.sources || []).map((source) => <div key={source.id}>
              <h3>{source.provider} · {source.endpoint || source.acquisition_method}</h3>
              <p>请求参数</p><pre>{JSON.stringify(source.request_params, null, 2)}</pre>
              <p>来源字段映射</p><pre>{JSON.stringify(source.field_provenance, null, 2)}</pre>
              <p>原始返回项目</p><pre>{JSON.stringify(source.raw_item, null, 2)}</pre>
              {source.raw_content && <><p>原始正文</p><pre>{source.raw_content}</pre></>}
            </div>)}
          </details>
        </>}
      </section>}
      </div>
    </>}

    {tab === 'discovery' && <>
      <form className="v2DiscoveryForm" onSubmit={(event) => void runDiscovery(event)}>
        <label>目标平台<select value="wechat" disabled><option value="wechat">微信公众号</option>
          <option value="xiaohongshu" disabled>小红书（接入中）</option>
          <option value="baijiahao" disabled>百家号（接入中）</option>
          <option value="toutiao" disabled>今日头条（接入中）</option>
          <option value="multi" disabled>多平台（接入中）</option><option value="zhihu" disabled>知乎（接入中）</option>
        </select></label>
        <label>采集方式<select value={queryMethod} onChange={(event) => setQueryMethod(event.target.value as QueryMethod)}>
          <option value="ten_w_rank">10W+</option><option value="original_rank">原创爆款</option><option value="keyword_search">关键词</option>
        </select></label>
        {queryMethod === 'keyword_search' ? <label className="v2Keyword">关键词<input value={keyword}
          onChange={(event) => setKeyword(event.target.value)} placeholder="输入公众号文章关键词" maxLength={80} /></label> : <>
          <label>榜单类目<select value={rankCategory} onChange={(event) => setRankCategory(event.target.value)}>
            {categories.map((category) => <option key={category} value={category}>{category}</option>)}
          </select></label>
          <div className="v2DateField"><span>日期范围</span><DateRangePicker start={startDate} end={endDate}
            requireDifferentDays onConfirm={(start, end) => { setStartDate(start); setEndDate(end) }} /></div>
        </>}
        {queryMethod === 'keyword_search' && <div className="v2KeywordOptions">
          <label>排序<select value={sortType} onChange={(event) => setSortType(event.target.value as typeof sortType)}>
            <option value="_0">默认</option><option value="_2">时间</option><option value="_4">热度</option>
          </select></label>
          <label><input type="checkbox" checked={exactMatch} onChange={(event) => setExactMatch(event.target.checked)} />精确匹配</label>
        </div>}
        {/* 2026-10-24：本次修改原因：把手动录入放到查询按钮旁，减少页面顶部重复入口占位。 */}
        <div className="v2DiscoveryActions">
          <button className="primaryButton" type="submit" disabled={queryBusy}>{queryBusy ? '正在查询…' : '查询候选'}</button>
          <span className="v2DiscoveryActionDivider" aria-hidden="true" />
          <button className="secondaryButton" type="button" onClick={() => setEdit({ mode: 'manual' })}>手动录入</button>
        </div>
      </form>
      <p className="v2ProviderNotice">当前新库已接入公众号三种查询。榜单类目会传给 RedFox 作为筛选参数；实际文章分类以接口单项返回值为准，收录前请核对内容类目。其他平台暂不可在新库中收录；查询只在点击按钮时调用 RedFox。</p>

      {discoverySessionId && <section className="v2CandidatePanel">
        {/* 2026-10-24：本次修改原因：将结果数量和会话状态放在标题右侧，节省纵向空间并避免顶部提示重复。 */}
        <div className="v2PanelHeading"><h2>候选文章</h2>
          <span>本次结果 {candidates.length} 条 · 会话已保存在本地数据库</span>
        </div>
        {/* 2026-10-24：本次修改原因：把全选、状态筛选和批量收录放入同一操作行，降低视线跳转。 */}
        <div className="v2CandidateToolbar">
          <div className="v2CandidateSelectionBar">
            <label className="v2SelectCurrentPage">
              <input type="checkbox" checked={allPageSelected} disabled={!selectableCurrentPage.length}
                ref={(node) => { if (node) node.indeterminate = somePageSelected }}
                onChange={(event) => toggleCurrentPage(event.target.checked)} />
              <span>全选本页未收录</span>
            </label>
            <span>本页未收录 {selectableCurrentPage.length} 篇 · 已选 {selectedRows.length} 篇</span>
          </div>
          <div className="v2CandidateActions">
            <label>收录状态<select value={candidateFilter}
            onChange={(event) => { setCandidateFilter(event.target.value as typeof candidateFilter); setCandidatePage(1) }}>
            <option value="all">全部状态</option><option value="uncollected">未收录</option><option value="collected">已收录</option>
          </select></label>
            <button type="button" className="primaryButton" disabled={!selectedRows.length}
              onClick={() => { setBatchScope(emptyScope()); setBatchEvidence(''); setBatchOpen(true) }}>
              批量收录（{selectedRows.length}）
            </button>
          </div>
        </div>
        {currentCandidates.map((candidate) => {
          const value = candidateValue(candidate, options)
          const metrics = candidate.normalized.metrics || {}
          const collected = candidate.collected_article_id
          const categoryWarning = candidate.warnings.find((warning) => warning.includes('类目'))
          return <article key={candidate.id} className="v2CandidateRow">
            <label className="v2CandidateSelect" aria-label={`选择${value.title || '无标题'}`}>
              <input type="checkbox" checked={Boolean(selectedCandidates[candidate.id])} disabled={Boolean(collected)}
                onChange={() => toggleCandidate(candidate)} />
            </label>
            <div className="v2CandidateMain">
              <div className="v2CandidateTitle"><button type="button" onClick={() => void openCandidate(candidate)}>
                {value.title || '未提供标题'}</button>
                <span className={collected ? 'v2Status collected' : 'v2Status'}>{collected ? '已收录' : '未收录'}</span>
              </div>
              <div className="v2CandidateMetrics">
                {metrics.read_raw != null && <span>阅读 {countText(typeof metrics.read_exact === 'number' ? metrics.read_exact : null,
                  String(metrics.read_raw))}{typeof metrics.read_lower_bound === 'number' ? `（≥${metrics.read_lower_bound.toLocaleString('zh-CN')}）` : ''}</span>}
                {metrics.likes != null && <span>点赞 {String(metrics.likes)}</span>}
                {metrics.watch_count != null && <span>在看 {String(metrics.watch_count)}</span>}
                {metrics.comments != null && <span>评论 {String(metrics.comments)}</span>}
                {metrics.shares != null && <span>转发 {String(metrics.shares)}</span>}
              </div>
              <p>{value.summary || '接口未提供摘要'}{candidate.normalized.requested_source_category
                ? ` · 请求榜单类目 ${candidate.normalized.requested_source_category}` : ''}
                {candidate.normalized.source_category
                  ? ` · 接口返回类目 ${candidate.normalized.source_category}` : ''}
                {categoryWarning ? ` · ${categoryWarning}` : candidate.warnings.length ? ` · ${candidate.warnings[0]}` : ''}</p>
            </div>
            <div className="v2CandidateMeta">{value.author_name || '作者未提供'}<br />{value.published_at || '发布时间未提供'}
              {value.article_url && <a href={value.article_url} target="_blank" rel="noreferrer">打开原文 ↗</a>}
            </div>
            <button className="secondaryButton" type="button" onClick={() => void openCandidate(candidate)}>
              {collected ? '查看来源' : '核对补齐'}
            </button>
          </article>
        })}
        <div className="v2Pager"><button type="button" className="secondaryButton" disabled={candidatePage <= 1}
          onClick={() => setCandidatePage((current) => current - 1)}>上一页</button>
          <span>第 {candidatePage} / {pageCount} 页 · 已选 {selectedRows.length} 条</span>
          <button type="button" className="secondaryButton" disabled={candidatePage >= pageCount}
            onClick={() => setCandidatePage((current) => current + 1)}>下一页</button></div>
      </section>}
    </>}

    {tab === 'preparation' && <section className="v2PreparationPanel">
      <h2>清洗与准备</h2><p>文章清洗管线将在 Stage 3 接入。现有样本可先在详情中核对正文完整性和抓取来源。</p>
      <button type="button" className="secondaryButton" onClick={() => setTab('articles')}>返回样本管理</button>
    </section>}

    {edit && <V2ArticleEditorDialog key={`${edit.mode}-${edit.candidate?.id || edit.article?.id || 'new'}`}
      mode={edit.mode} options={options}
      initial={edit.candidate ? candidateValue(edit.candidate, options) : edit.article ? articleValue(edit.article) : { platform_id: 'platform_01' }}
      initialScope={edit.article?.rights_scope}
      sourceData={edit.candidate ? sourceForCandidate(edit.candidate) : edit.article?.sources?.[0]?.raw_item}
      provenance={edit.candidate?.field_provenance || edit.article?.field_provenance}
      warnings={edit.candidate?.warnings}
      onSave={saveEditor}
      onSaveDraft={edit.mode === 'candidate' ? saveCandidateDraft : undefined}
      onClose={() => setEdit(null)} />}

    {batchOpen && <div className="v2DialogBackdrop"><section className="v2BatchDialog" role="dialog" aria-modal="true">
      <header><h2>批量收录</h2><button type="button" onClick={() => setBatchOpen(false)} disabled={batchBusy}>×</button></header>
      <p>已选 {selectedRows.length} 条，可收录 {eligibleRows.length} 条，待补齐 {selectedRows.length - eligibleRows.length} 条。</p>
      <div className="v2BatchPreview">{selectedRows.map((candidate) => {
        const value = candidateValue(candidate, options)
        const missing = missingCandidate(value)
        return <div key={candidate.id}><strong>{value.title || '未提供标题'}</strong>
          <span>{missing.length ? `待补齐：${missing.join('、')}` : '字段齐全'}</span>
          {missing.length > 0 && <button type="button" onClick={() => { setBatchOpen(false); void openCandidate(candidate) }}>补充字段</button>}
        </div>
      })}</div>
      {/* 2026-10-24：本次修改原因：批量收录动作确认本地存储，其他用途权限由对应处理流程单独授予。 */}
      <p className="v2RightsNotice">点击“批量收录”即确认将可收录文章保存到样本管理。此操作不授予清洗、第三方模型分析或生成引用权限；这些权限在对应功能启用时另行确认。</p>
      <label className="v2BatchEvidence">权限依据/备注（可选）<input value={batchEvidence}
        onChange={(event) => setBatchEvidence(event.target.value)} /></label>
      {/* 原逐项权限勾选区保留供后续处理权限流程接入时对照。
      <fieldset className="v2RightsFields"><legend>本次权限确认</legend>
        {([['store', '允许保存到样本管理'], ['local_clean', '允许本地清洗与格式处理'],
          ['third_party_llm', '允许发送给第三方模型分析'], ['generation_reference', '允许作为内容生成参考']] as const)
          .map(([key, label]) => <label key={key}><input type="checkbox" checked={batchScope[key] === true}
            onChange={(event) => setBatchScope((current) => ({ ...current, [key]: event.target.checked }))} />{label}</label>)}
      </fieldset>
      */}
      <footer><button type="button" className="secondaryButton" onClick={() => setBatchOpen(false)} disabled={batchBusy}>取消</button>
        <button type="button" className="primaryButton" onClick={() => void collectBatch()}
          disabled={batchBusy || batchScope.store !== true || eligibleRows.length === 0}>
          {batchBusy ? '正在收录…' : `收录可用 ${eligibleRows.length} 篇`}</button></footer>
    </section></div>}
  </div>
}
