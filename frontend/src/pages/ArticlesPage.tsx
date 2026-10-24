// 2026-10-23：本次修改原因：文章库以已入库样本为默认工作区，并串起发现、复核、指标、画像和策略入口。
import { useEffect, useState, type FormEvent } from 'react'
import SamplesPage from './SamplesPage'
// 2026-10-23：本次修改原因：样本管理双击与候选收录共用字段编辑弹窗。
import ArticleEditorDialog, { blankArticleEditor, type ArticleEditorValue } from '../components/ArticleEditorDialog'
import {
  // 2026-10-24：本次修改原因：从样本详情确认删除未被画像或策略引用的文章。
  addArticleMetric, analyzeStyleProfile, createProfileStrategy, deleteLibraryArticle, getAnalysisRuns, getArticleSummary,
  getLibraryArticle, getLibraryArticles, getStyleProfile, getStyleProfiles,
  updateLibraryArticle, type AnalysisRun, type ArticleMetric, type ArticlePage, type ArticleSummary,
  type LibraryArticleDetail, type StyleProfile,
} from '../articleLibraryApi'
import type { ContentOption } from '../workspaceApi'

type LibraryTab = 'articles' | 'discovery' | 'profiles'

// 2026-10-23：本次修改原因：统计特征保留明确名称和单位，不把原始次数显示成评分。
const STAT_LABELS: Record<string, string> = {
  title_characters: '标题字数', paragraphs: '段落数',
  mean_sentence_characters: '平均句长（字）', quoted_dialogue_count: '引述片段数',
  number_mentions: '数字出现次数', mean_paragraph_characters: '平均段长（字）',
  short_sentence_ratio: '短句占比', question_ratio: '问句占比',
}
const FEATURE_LABELS: Record<string, string> = {
  title: '标题风格', structure: '文章结构', language: '语言风格', narrative: '叙事风格',
  emotion: '情绪表达', information_density: '信息密度', rhythm: '阅读节奏', interaction: '互动设计',
}
const STATUS_LABELS = { pending: '待核对', ready: '可分析', excluded: '已排除' }
const ANALYSIS_LABELS = { pending: '未分析', current: '已分析', stale: '需重分析' }

function displayDate(value: string | null | undefined): string {
  return value ? new Date(value).toLocaleDateString('zh-CN') : '未填写'
}

function displayRate(value: number | null): string {
  return value === null ? '未提供' : `${(value * 100).toFixed(2)}%`
}

// function metricValue(value: number | null): string {
//   return value === null ? '未提供' : value.toLocaleString('zh-CN')
// } 2026-10-24：原仅显示精确整数的函数留作对照。
// 2026-10-24：本次修改原因：样本详情优先显示精确值，缺失时显示候选原始近似值。
// function metricValue(value: number | null, raw?: string): string {
//   return value === null ? raw || '未提供' : value.toLocaleString('zh-CN')
// } 2026-10-24：原只处理 null 的函数留作对照。
// 2026-10-24：本次修改原因：旧接口暂未返回新增字段时也按缺失读数展示。
function metricValue(value: number | null | undefined, raw?: string): string {
  return value == null ? raw || '未提供' : value.toLocaleString('zh-CN')
}

// 2026-10-23：本次修改原因：把已入库文章的完整字段映射到与收录流程相同的弹窗。
function editorValue(article: LibraryArticleDetail): ArticleEditorValue {
  return { ...blankArticleEditor(article.platform_id, article.category_id),
    title: article.title, body_text: article.body_text, format_id: article.format_id || '',
    source_url: article.source_url || '', quality_score: article.quality_score,
    rights_confirmed: article.rights_confirmed, author_id: article.author_id || '',
    account_followers: article.account_followers?.toString() || '', published_at: article.published_at || '',
    audience_id: article.audience_id || '', topic: article.topic || '', tags: article.tags.join('、'),
    // 2026-10-24：本次修改原因：双击样本时继续展示已入库的 RedFox 请求与返回字段。
    usage_rights_note: article.usage_rights_note || '', review_status: article.review_status,
    source_data: article.source_data || {} }
}

// 2026-10-23：本次修改原因：核对页将原文、元数据、分析和指标放在同一文章上下文中。
export default function ArticlesPage({ options }: { options: ContentOption[] }) {
  const active = (kind: ContentOption['kind']) => options.filter((item) => item.kind === kind && item.active)
  const label = (id: string | null) => options.find((item) => item.id === id)?.label ?? '未分类'
  const [tab, setTab] = useState<LibraryTab>('articles')
  const [version, setVersion] = useState(0)
  const [platformId, setPlatformId] = useState('')
  const [categoryId, setCategoryId] = useState('')
  const [formatId, setFormatId] = useState('')
  const [audienceId, setAudienceId] = useState('')
  const [reviewStatus, setReviewStatus] = useState('')
  const [analysisStatus, setAnalysisStatus] = useState('')
  const [performanceBand, setPerformanceBand] = useState('')
  const [searchInput, setSearchInput] = useState('')
  const [query, setQuery] = useState('')
  const [page, setPage] = useState(1)
  const [summary, setSummary] = useState<ArticleSummary | null>(null)
  const [results, setResults] = useState<ArticlePage | null>(null)
  const [selectedId, setSelectedId] = useState('')
  const [article, setArticle] = useState<LibraryArticleDetail | null>(null)
  const [editMode, setEditMode] = useState(false)
  const [editorArticle, setEditorArticle] = useState<LibraryArticleDetail | null>(null)
  // 2026-10-24：本次修改原因：删除前展示目标文章和后果，避免误点直接移除样本。
  const [deleteTarget, setDeleteTarget] = useState<LibraryArticleDetail | null>(null)
  const [deleteError, setDeleteError] = useState('')
  const [draft, setDraft] = useState({ title: '', body_text: '', platform_id: '', category_id: '',
    format_id: '', source_url: '', quality_score: 4, rights_confirmed: false, author_id: '',
    account_followers: '', published_at: '', audience_id: '', topic: '', tags: '',
    usage_rights_note: '', review_status: 'pending' })
  // const [metric, setMetric] = useState({ source: '人工录入', captured_at: '', impressions: '', clicks: '', reads: '',
  //   likes: '', saves: '', comments: '', shares: '' }) 2026-10-24：原快照表单字段留作对照。
  // 2026-10-24：本次修改原因：手动补录来源文章读数时允许填写在看数。
  const [metric, setMetric] = useState({ source: '人工核对', captured_at: '', impressions: '', clicks: '', reads: '',
    // likes: '', watch_count: '', saves: '', comments: '', shares: ''  // 2026-10-24：原快照字段留作对照。
    // 2026-10-24：本次修改原因：人工复核时可补充公众号打赏与综合互动量。
    likes: '', watch_count: '', saves: '', reward_count: '', interactive_count: '', comments: '', shares: '' })
  const [profiles, setProfiles] = useState<StyleProfile[]>([])
  const [runs, setRuns] = useState<AnalysisRun[]>([])
  const [profile, setProfile] = useState<StyleProfile | null>(null)
  const [profileId, setProfileId] = useState('')
  const [profilePlatform, setProfilePlatform] = useState('')
  const [profileCategory, setProfileCategory] = useState('')
  const [profileFormat, setProfileFormat] = useState('')
  const [profileAudience, setProfileAudience] = useState('')
  const [includeAi, setIncludeAi] = useState(false)
  // const [startWithForm, setStartWithForm] = useState(false) // 2026-10-23：顶部新增样本快捷入口移除后，原状态留作对照。
  // const [discoveryKey, setDiscoveryKey] = useState(0) // 2026-10-23：顶部重复入口移除后，原重置键留作对照。
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  // 2026-10-23：本次修改原因：从策略审核页返回时直接打开对应画像，保持来源追溯连续。
  useEffect(() => {
    const pending = sessionStorage.getItem('ai4geo.openProfileId')
    if (!pending) return
    sessionStorage.removeItem('ai4geo.openProfileId')
    setProfileId(pending)
    setTab('profiles')
  }, [])

  // 2026-10-23：本次修改原因：筛选和概况分别由服务器计算，快速切换时丢弃过期响应。
  useEffect(() => {
    let cancelled = false
    getArticleSummary(platformId).then((value) => { if (!cancelled) setSummary(value) })
      .catch((reason) => { if (!cancelled) setError(reason instanceof Error ? reason.message : '概况读取失败') })
    return () => { cancelled = true }
  }, [platformId, version])

  useEffect(() => {
    let cancelled = false
    getLibraryArticles({ page, page_size: 20, q: query, platform_id: platformId,
      category_id: categoryId, format_id: formatId, audience_id: audienceId,
      review_status: reviewStatus, analysis_status: analysisStatus,
      performance_band: performanceBand }).then((value) => { if (!cancelled) setResults(value) })
      .catch((reason) => { if (!cancelled) setError(reason instanceof Error ? reason.message : '文章列表读取失败') })
    return () => { cancelled = true }
  }, [page, query, platformId, categoryId, formatId, audienceId, reviewStatus, analysisStatus, performanceBand, version])

  useEffect(() => {
    if (!selectedId) { setArticle(null); return }
    let cancelled = false
    getLibraryArticle(selectedId).then((value) => { if (!cancelled) setArticle(value) })
      .catch((reason) => { if (!cancelled) setError(reason instanceof Error ? reason.message : '文章详情读取失败') })
    return () => { cancelled = true }
  }, [selectedId, version])

  useEffect(() => {
    let cancelled = false
    getStyleProfiles(platformId).then((value) => { if (!cancelled) setProfiles(value) })
      .catch((reason) => { if (!cancelled) setError(reason instanceof Error ? reason.message : '画像读取失败') })
    return () => { cancelled = true }
  }, [platformId, version])

  // 2026-10-23：本次修改原因：分析运行的成功与失败状态随画像视图一同刷新。
  useEffect(() => {
    let cancelled = false
    getAnalysisRuns().then((value) => { if (!cancelled) setRuns(value) })
      .catch((reason) => { if (!cancelled) setError(reason instanceof Error ? reason.message : '分析记录读取失败') })
    return () => { cancelled = true }
  }, [version])

  useEffect(() => {
    if (!profileId) { setProfile(null); return }
    let cancelled = false
    getStyleProfile(profileId).then((value) => { if (!cancelled) setProfile(value) })
      .catch((reason) => { if (!cancelled) setError(reason instanceof Error ? reason.message : '画像详情读取失败') })
    return () => { cancelled = true }
  }, [profileId, version])

  useEffect(() => {
    if (!article) return
    setDraft({ title: article.title, body_text: article.body_text, platform_id: article.platform_id,
      category_id: article.category_id, format_id: article.format_id ?? '',
      source_url: article.source_url ?? '', quality_score: article.quality_score,
      rights_confirmed: article.rights_confirmed, author_id: article.author_id ?? '',
      account_followers: article.account_followers?.toString() ?? '',
      published_at: article.published_at ?? '', audience_id: article.audience_id ?? '',
      topic: article.topic ?? '', tags: article.tags.join('、'),
      usage_rights_note: article.usage_rights_note ?? '', review_status: article.review_status })
  }, [article])

  function refresh() { setVersion((current) => current + 1) }
  function changeFilter(setter: (value: string) => void, value: string) { setter(value); setPage(1) }

  // 2026-10-23：本次修改原因：列表双击先读取完整字段，再打开与收录相同的编辑弹窗。
  async function openArticleEditor(id: string) {
    setError(''); setNotice('')
    try { setEditorArticle(await getLibraryArticle(id)) }
    catch (reason) { setError(reason instanceof Error ? reason.message : '文章详情读取失败') }
  }

  // 2026-10-24：本次修改原因：删除后同步清空详情、刷新统计和分页；引用冲突在确认弹窗内说明。
  async function confirmDeleteArticle() {
    if (!deleteTarget || busy) return
    setBusy(true); setDeleteError(''); setError(''); setNotice('')
    try {
      await deleteLibraryArticle(deleteTarget.id)
      if (selectedId === deleteTarget.id) { setSelectedId(''); setArticle(null) }
      if (editorArticle?.id === deleteTarget.id) setEditorArticle(null)
      // 2026-10-24：本次修改原因：筛选变化后详情可能仍是旧选择，只在目标确实位于当前页时调整页码。
      const visibleOnPage = results?.items.some((item) => item.id === deleteTarget.id) ?? false
      const lastOnPage = visibleOnPage && results?.items.length === 1 && page > 1
      setResults((current) => current ? { ...current,
        items: current.items.filter((item) => item.id !== deleteTarget.id),
        total: visibleOnPage ? Math.max(0, current.total - 1) : current.total } : current)
      setDeleteTarget(null)
      setNotice('文章已删除。')
      if (lastOnPage) setPage((current) => current - 1)
      // else refresh()  // 2026-10-24：原仅在当前页仍有文章时刷新的逻辑留作对照。
      // 2026-10-24：本次修改原因：末页回退时也必须刷新顶部真实统计。
      refresh()
    } catch (reason) {
      setDeleteError(reason instanceof Error ? reason.message : '删除失败')
    } finally { setBusy(false) }
  }

  // function openDiscovery(manual: boolean) { // 2026-10-23：顶部重复跳转入口移除，原逻辑留作对照。
  //   setStartWithForm(manual)
  //   setDiscoveryKey((current) => current + 1)
  //   setTab('discovery')
  //   setError('')
  // }

  async function saveArticle(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!article) return
    setBusy(true); setError(''); setNotice('')
    try {
      await updateLibraryArticle(article.id, {
        ...draft, format_id: draft.format_id || null, source_url: draft.source_url.trim() || null,
        author_id: draft.author_id.trim() || null,
        account_followers: draft.account_followers === '' ? null : Number(draft.account_followers),
        published_at: draft.published_at || null,
        audience_id: draft.audience_id || null, topic: draft.topic.trim() || null,
        tags: draft.tags.split(/[、,，]/).map((value) => value.trim()).filter(Boolean),
        usage_rights_note: draft.usage_rights_note.trim() || null,
      })
      setEditMode(false)
      setNotice('文章已保存。正文变化会使旧分析标记为需重分析。')
      refresh()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '文章保存失败')
    } finally { setBusy(false) }
  }

  async function saveMetric(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!article) return
    setBusy(true); setError(''); setNotice('')
    try {
      const values = Object.fromEntries(Object.entries(metric).map(([key, value]) =>
        [key, key === 'source' ? value.trim() : key === 'captured_at' ? value || null :
          value === '' ? null : Number(value)]))
      await addArticleMetric(article.id, values)
      setNotice('指标快照已保存，历史读数仍可查看。')
      refresh()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '指标保存失败')
    } finally { setBusy(false) }
  }

  async function analyze(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setBusy(true); setError(''); setNotice('')
    try {
      const created = await analyzeStyleProfile({ platform_id: profilePlatform,
        category_id: profileCategory, format_id: profileFormat || null,
        audience_id: profileAudience || null, include_ai: includeAi })
      setProfileId(created.id)
      setNotice(`画像 V${created.version} 已保存，包含 ${created.sample_count} 篇文章。请核对结果后再创建策略草稿。`)
      refresh()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '画像分析失败')
    } finally { setBusy(false) }
  }

  async function createStrategy() {
    if (!profile) return
    setBusy(true); setError('')
    try {
      const created = await createProfileStrategy(profile.id)
      sessionStorage.setItem('ai4geo.openStrategyId', created.strategy_id)
      window.location.hash = '#/strategies'
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '策略草稿创建失败')
    } finally { setBusy(false) }
  }

  // 2026-10-23：本次修改原因：页面上只显示可解释的真实状态，分组表现尚无可比条件时不提供虚假排名。
  return <div className="articleLibraryPage">
    {/* <div className="libraryTop"><div><h1>参考文章库</h1><p>核对来源与质量，分析同类文章的可复用写法。</p></div><div className="libraryTopActions"><button className="secondaryButton" type="button" onClick={() => openDiscovery(false)}>发现候选</button><button className="primaryButton" type="button" onClick={() => openDiscovery(true)}>新增样本</button></div></div> 2026-10-23：原页眉及重复入口留作对照。 */}
    {/* 2026-10-23：本次修改原因：视图切换已承担导航，标题只供读屏器使用。 */}
    <h1 className="libraryScreenReaderTitle">参考文章库</h1>
    <nav className="libraryTabs" aria-label="文章库视图">
      {([['articles', '样本管理'], ['discovery', '发现与录入'], ['profiles', '风格画像']] as const).map(([key, text]) =>
        <button key={key} type="button" className={tab === key ? 'active' : ''}
          aria-current={tab === key ? 'page' : undefined} onClick={() => { setTab(key); setError(''); setNotice('') }}>{text}</button>)}
    </nav>
    {error && <p className="alert error" role="alert">{error}</p>}
    {notice && <p className="alert success" role="status">{notice}</p>}

    {/* {tab === 'discovery' && <><p className="libraryNotice">候选标题和摘要只是线索；取得正文后仍需核对原文、分类与使用权限，保存后才进入文章库。</p><SamplesPage key={discoveryKey} options={options} mode="discovery" startWithForm={startWithForm} onSaved={() => { setNotice('样本已保存，可在样本管理中继续核对。'); setTab('articles'); refresh() }} /></>} 2026-10-23：原常驻说明与快捷入口状态留作对照。 */}
    {/* 2026-10-23：本次修改原因：发现页直接呈现查询和录入操作，省去重复说明。 */}
    {/* {tab === 'discovery' && <SamplesPage options={options} mode="discovery" onSaved={() => { setNotice('样本已保存，可在样本管理中继续核对。'); setTab('articles'); refresh() }} />} 2026-10-23：原每收录一篇就切换视图的逻辑暂留供对照。 */}
    {/* 2026-10-23：本次修改原因：连续收录时留在候选列表，样本管理的统计和分页同步刷新。 */}
    {tab === 'discovery' && <SamplesPage options={options} mode="discovery"
      onSaved={() => { setNotice('已收录到样本管理。'); refresh() }} />}

    {tab === 'articles' && <>
      <div className="librarySummary" aria-label="文章库概况">
        <div><strong>{summary?.total ?? '—'}</strong><span>文章总数</span></div>
        <div><strong>{summary?.pending ?? '—'}</strong><span>待核对</span></div>
        <div><strong>{summary?.ready ?? '—'}</strong><span>可分析</span></div>
        <div><strong>{summary?.analyzed ?? '—'}</strong><span>已分析</span></div>
        <div><strong>{summary?.profiles ?? '—'}</strong><span>风格画像</span></div>
      </div>
      <form className="libraryFilterBar" onSubmit={(event) => { event.preventDefault(); changeFilter(setQuery, searchInput.trim()) }}>
        {/* 2026-10-23：本次修改原因：筛选条件横向排列，搜索作为下一行的独立操作。 */}
        <div className="libraryFilterControls">
        <label>平台<select value={platformId} onChange={(event) => changeFilter(setPlatformId, event.target.value)}>
          <option value="">全部平台</option>{active('platform').map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}</select></label>
        <label>类目<select value={categoryId} onChange={(event) => changeFilter(setCategoryId, event.target.value)}>
          <option value="">全部类目</option>{active('category').map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}</select></label>
        <label>体裁<select value={formatId} onChange={(event) => changeFilter(setFormatId, event.target.value)}>
          <option value="">全部体裁</option>{active('format').map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}</select></label>
        <label>受众<select value={audienceId} onChange={(event) => changeFilter(setAudienceId, event.target.value)}>
          <option value="">全部受众</option>{active('audience').map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}</select></label>
        <label>状态<select value={reviewStatus} onChange={(event) => changeFilter(setReviewStatus, event.target.value)}>
          <option value="">全部状态</option><option value="pending">待核对</option><option value="ready">可分析</option><option value="excluded">已排除</option></select></label>
        <label>分析<select value={analysisStatus} onChange={(event) => changeFilter(setAnalysisStatus, event.target.value)}>
          <option value="">全部分析状态</option><option value="pending">未分析</option><option value="current">已分析</option><option value="stale">需重分析</option></select></label>
        <label>表现<select value={performanceBand} onChange={(event) => changeFilter(setPerformanceBand, event.target.value)}>
          <option value="">全部表现</option><option value="high">高表现</option><option value="middle">中等表现</option><option value="low">低表现</option></select></label>
        </div>
        {/* <label className="librarySearch">搜索<input value={searchInput} onChange={(event) => setSearchInput(event.target.value)} placeholder="标题、正文、来源或账号" /></label><button className="secondaryButton" type="submit">搜索</button> 2026-10-23：原与筛选条件同排的搜索入口留作对照。 */}
        {/* 2026-10-23：本次修改原因：输入框与按钮单独成行，给关键词搜索稳定的宽度。 */}
        <div className="librarySearchRow">
          <input aria-label="搜索文章" value={searchInput} onChange={(event) => setSearchInput(event.target.value)}
            placeholder="搜索标题、正文、来源或账号" />
          <button className="secondaryButton" type="submit">搜索</button>
        </div>
      </form>
      <div className="libraryWorkArea">
        <section className="libraryArticleList" aria-label="文章列表">
          <div className="librarySectionHead"><h2>入库文章</h2><span>符合条件 {results?.total ?? '—'} 篇</span></div>
          {results?.items.length === 0 ? <div className="emptyState"><h3>没有匹配的文章</h3><p>{performanceBand
            ? '当前没有满足同类、同期、相近账号规模及指标快照条件的这一组文章。'
            : '调整筛选条件，或切换到“发现与录入”。'}</p></div> :
            results?.items.map((item) => <button key={item.id} type="button"
              className={selectedId === item.id ? 'libraryArticleRow selected' : 'libraryArticleRow'}
              onClick={() => { setSelectedId(item.id); setEditMode(false); setNotice('') }}
              onDoubleClick={() => void openArticleEditor(item.id)} title="双击查看与修改保存字段">
              <strong>{item.title}</strong><span>{label(item.platform_id)} · {label(item.category_id)} · {label(item.format_id)}
                {item.author_id ? ` · ${item.author_id}` : ''}</span>
              <small>{STATUS_LABELS[item.review_status]} · {ANALYSIS_LABELS[item.analysis_status]} · 编辑质量 {item.quality_score}/5
                {' · '}{item.published_at || '发布时间未填'}</small></button>)}
          <div className="libraryPager"><button type="button" className="secondaryButton" disabled={page <= 1}
            onClick={() => setPage((value) => value - 1)}>上一页</button><span>第 {page} / {Math.max(1, Math.ceil((results?.total ?? 0) / 20))} 页</span>
            <button type="button" className="secondaryButton" disabled={!results || page * 20 >= results.total}
              onClick={() => setPage((value) => value + 1)}>下一页</button></div>
        </section>
        <section className="libraryArticleDetail" aria-label="文章详情">
          {!article ? <div className="emptyState"><h3>选择一篇文章</h3><p>在此核对原文、分类、指标和分析结果。</p></div> : <>
            {/* <div className="librarySectionHead"><h2>{article.title}</h2><button type="button" className="secondaryButton" onClick={() => setEditMode((value) => !value)}>{editMode ? '取消编辑' : '编辑与复核'}</button></div> 2026-10-23：原右侧内嵌编辑入口暂留供对照。 */}
            {/* 2026-10-23：本次修改原因：右侧按钮和列表双击打开同一弹窗，避免两套编辑入口。 */}
            {/* <div className="librarySectionHead"><h2>{article.title}</h2><button type="button" className="secondaryButton" onClick={() => void openArticleEditor(article.id)}>编辑与复核</button></div> 2026-10-24：原单一编辑操作留作对照。 */}
            {/* 2026-10-24：本次修改原因：当前文章详情集中放置编辑和删除入口，列表保持简洁。 */}
            <div className="librarySectionHead"><h2>{article.title}</h2><div className="libraryArticleActions">
              <button type="button" className="secondaryButton" onClick={() => void openArticleEditor(article.id)}>编辑与复核</button>
              <button type="button" className="dangerButton" onClick={() => { setDeleteError(''); setDeleteTarget(article) }}>删除文章</button>
            </div></div>
            {editMode ? <form className="libraryEditForm" onSubmit={(event) => void saveArticle(event)}>
              <label>标题<input required maxLength={300} value={draft.title} onChange={(event) => setDraft({ ...draft, title: event.target.value })} /></label>
              <div className="libraryFieldPair"><label>平台<select value={draft.platform_id} onChange={(event) => setDraft({ ...draft, platform_id: event.target.value })}>
                {active('platform').map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}</select></label>
                <label>类目<select value={draft.category_id} onChange={(event) => setDraft({ ...draft, category_id: event.target.value })}>
                  {active('category').map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}</select></label></div>
              <div className="libraryFieldPair"><label>体裁<select value={draft.format_id} onChange={(event) => setDraft({ ...draft, format_id: event.target.value })}>
                <option value="">未分类</option>{active('format').map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}</select></label>
                <label>目标受众<select value={draft.audience_id} onChange={(event) => setDraft({ ...draft, audience_id: event.target.value })}>
                  <option value="">未填写</option>{active('audience').map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}</select></label></div>
              <div className="libraryFieldPair"><label>账号或作者<input value={draft.author_id} onChange={(event) => setDraft({ ...draft, author_id: event.target.value })} /></label>
                <label>账号粉丝数（可选）<input type="number" min="0" value={draft.account_followers}
                  onChange={(event) => setDraft({ ...draft, account_followers: event.target.value })} /></label></div>
              <label>发布时间<input type="date" value={draft.published_at} onChange={(event) => setDraft({ ...draft, published_at: event.target.value })} /></label>
              <label>主题<input value={draft.topic} onChange={(event) => setDraft({ ...draft, topic: event.target.value })} /></label>
              <label>标签（用顿号或逗号分隔）<input value={draft.tags} onChange={(event) => setDraft({ ...draft, tags: event.target.value })} /></label>
              <label>来源链接<input type="url" value={draft.source_url} onChange={(event) => setDraft({ ...draft, source_url: event.target.value })} /></label>
              <label>正文<textarea rows={14} minLength={50} maxLength={30000} required value={draft.body_text}
                onChange={(event) => setDraft({ ...draft, body_text: event.target.value })} /></label>
              <div className="libraryFieldPair"><label>编辑质量<select value={draft.quality_score} onChange={(event) => setDraft({ ...draft, quality_score: Number(event.target.value) })}>
                {[1, 2, 3, 4, 5].map((score) => <option key={score} value={score}>{score}/5</option>)}</select></label>
                <label>复核状态<select value={draft.review_status} onChange={(event) => setDraft({ ...draft, review_status: event.target.value })}>
                  <option value="pending">待核对</option><option value="ready">可分析</option><option value="excluded">已排除</option></select></label></div>
              <label>使用权限说明<textarea rows={2} value={draft.usage_rights_note}
                onChange={(event) => setDraft({ ...draft, usage_rights_note: event.target.value })} /></label>
              {/* <label className="libraryCheck"><input type="checkbox" checked={draft.rights_confirmed}
                onChange={(event) => setDraft({ ...draft, rights_confirmed: event.target.checked,
                  review_status: event.target.checked ? draft.review_status : 'pending' })} />已确认本项目可存储、分析和使用该正文</label> 2026-10-24：原只确认权限、不完成复核的做法留作对照。 */}
              {/* 2026-10-24：本次修改原因：详情编辑中的权限确认与录入弹窗保持同一复核状态规则。 */}
              <label className="libraryCheck"><input type="checkbox" checked={draft.rights_confirmed}
                onChange={(event) => setDraft({ ...draft, rights_confirmed: event.target.checked,
                  review_status: event.target.checked ? (draft.review_status === 'excluded' ? 'excluded' : 'ready') : 'pending' })} />
                {/* 2026-10-24：本次修改原因：权限勾选联动复核状态时明确原文核对含义。 */}
                我已核对原文，并确认可在本项目中存储、分析和使用该正文</label>
              <button className="primaryButton" type="submit" disabled={busy}>{busy ? '正在保存…' : '保存文章'}</button>
            </form> : <>
              <p className="libraryMeta">{label(article.platform_id)} · {label(article.category_id)} · {label(article.format_id)} · {label(article.audience_id)}
                {' · '}{STATUS_LABELS[article.review_status]} · {ANALYSIS_LABELS[article.analysis_status]}</p>
              {/* <p className="libraryMeta">作者或账号：{article.author_id || '未填写'} · 粉丝数：{article.account_followers ?? '未填写'} 2026-10-24：原粉丝数展示留作对照。 */}
              {/* 2026-10-24：本次修改原因：精确粉丝数缺失时仍展示候选保存的原始值。 */}
              <p className="libraryMeta">作者或账号：{article.author_id || '未填写'} · 粉丝数：{article.account_followers ?? article.metrics.find((item) => item.raw_counts?.followers)?.raw_counts?.followers ?? '未提供'}
                {' · '}发布：{article.published_at || '未填写'} · 采集：{displayDate(article.collected_at)}</p>
              <p className="libraryMeta">来源：{article.source_url ? <a href={article.source_url} target="_blank" rel="noreferrer">打开原文 ↗</a> : '未填写'}
                {' · '}权限：{article.rights_confirmed ? '已确认' : '待确认'}</p>
              {article.usage_rights_note && <p className="libraryMeta">权限说明：{article.usage_rights_note}</p>}
              {article.tags.length > 0 && <p className="libraryMeta">标签：{article.tags.join('、')}</p>}
              {/* 2026-10-23：本次修改原因：传播分组与风格分析分开显示，并说明比较样本条件不足的情况。 */}
              {/* <p className="libraryPerformance">传播表现：{article.performance.band ?? '暂不分组'} 2026-10-24：原泛称留作对照。 */}
              {/* 2026-10-24：本次修改原因：表现分组只评价已入库的来源文章。 */}
              <p className="libraryPerformance">来源文章表现：{article.performance.band ?? '暂不分组'}
                {article.performance.metric && ` · ${article.performance.metric}`}
                {article.performance.percentile !== null && ` · 同类百分位 ${(article.performance.percentile * 100).toFixed(0)}%`}
                {' · '}{article.performance.reason}{article.performance.peer_count > 0 && `（可比文章 ${article.performance.peer_count} 篇）`}</p>
              <details open><summary>文章正文</summary><div className="libraryBody">{article.body_text}</div></details>
              {/* <details><summary>单篇特征 {article.feature_version ? `· ${article.feature_version}` : '· 未分析'}</summary> 2026-10-24：原未分析时仍渲染空区块的入口留作对照。 */}
              {/* 2026-10-24：本次修改原因：未分析文章不显示空的单篇特征区块。 */}
              {article.features && <details><summary>单篇特征 · {article.feature_version || '已分析'}</summary>
                {article.features ? <div className="libraryFeatures">{Object.entries(article.features).map(([key, value]) =>
                  <div key={key}><strong>{FEATURE_LABELS[key] ?? key}</strong><code>{JSON.stringify(value, null, 2)}</code></div>)}</div> :
                  <p className="subtle">在“风格画像”中按范围分析后，这里会显示可复算特征。</p>}</details>}
              {/* <details><summary>互动指标快照（{article.metrics.length}）</summary> 2026-10-24：原泛称留作对照。 */}
              {/* 2026-10-24：本次修改原因：明确这些读数属于入库的来源文章，而非未来生成稿。 */}
              {/* 2026-10-24：本次修改原因：来源文章互动读数区块从样本详情移除；原补录和历史展示暂保留在代码中。 */}
              {false && <details><summary>来源文章互动读数（{article?.metrics?.length || 0}）</summary>
                {article?.metrics?.map((item: ArticleMetric) => <div className="libraryMetricRow" key={item.id}>
                  <strong>{displayDate(item.captured_at)} · {item.source}</strong>
                  {/* <span>曝光 {metricValue(item.impressions)} · 点击 {metricValue(item.clicks)} · 阅读 {metricValue(item.reads)}</span>
                  <span>点赞 {metricValue(item.likes)} · 收藏 {metricValue(item.saves)} · 评论 {metricValue(item.comments)} · 分享 {metricValue(item.shares)}</span> 2026-10-24：原不含在看和近似值的展示留作对照。 */}
                  {/* 2026-10-24：本次修改原因：逐项显示来源文章的精确数或原始近似值。 */}
                  <span>曝光 {metricValue(item.impressions)} · 点击 {metricValue(item.clicks)} · 阅读 {metricValue(item.reads, item.raw_counts?.reads)}</span>
                  {/* <span>点赞 {metricValue(item.likes, item.raw_counts?.likes)} · 在看 {metricValue(item.watch_count, item.raw_counts?.watch_count)} · 收藏 {metricValue(item.saves, item.raw_counts?.saves)} · 评论 {metricValue(item.comments, item.raw_counts?.comments)} · 分享 {metricValue(item.shares, item.raw_counts?.shares)}</span> 2026-10-24：原五项互动展示留作对照。 */}
                  {/* 2026-10-24：本次修改原因：关键词收藏/打赏和榜单互动量在样本详情中完整回显。 */}
                  <span>点赞 {metricValue(item.likes, item.raw_counts?.likes)} · 在看 {metricValue(item.watch_count, item.raw_counts?.watch_count)} · 收藏 {metricValue(item.saves, item.raw_counts?.saves)} · 评论 {metricValue(item.comments, item.raw_counts?.comments)} · 分享 {metricValue(item.shares, item.raw_counts?.shares)}</span>
                  {(item.reward_count !== null || item.raw_counts?.reward_count || item.interactive_count !== null || item.raw_counts?.interactive_count) &&
                    <span>打赏 {metricValue(item.reward_count, item.raw_counts?.reward_count)} · 互动量 {metricValue(item.interactive_count, item.raw_counts?.interactive_count)}</span>}
                  <small>点击率 {displayRate(item.ctr)} · 收藏率 {displayRate(item.save_rate)} · 评论率 {displayRate(item.comment_rate)}</small></div>)}
                <form className="libraryMetricForm" onSubmit={(event) => void saveMetric(event)}>
                  {/* <h3>新增指标快照</h3> 2026-10-24：原标题留作对照。 */}
                  {/* 2026-10-24：本次修改原因：补录入口指明只填写来源文章已观察到的读数。 */}
                  <h3>补录来源文章读数</h3><div className="libraryFieldPair"><label>数据来源<input required value={metric.source}
                    onChange={(event) => setMetric({ ...metric, source: event.target.value })} /></label>
                    <label>观测时间（空白表示现在）<input type="datetime-local" value={metric.captured_at}
                      onChange={(event) => setMetric({ ...metric, captured_at: event.target.value })} /></label></div>
                  {/* 2026-10-24：本次修改原因：手动快照的在看数与抓取快照使用同一字段。 */}
                  {/* <div className="libraryMetricInputs">{(['impressions', 'clicks', 'reads', 'likes', 'watch_count', 'saves', 'comments', 'shares'] as const).map((key) =>  // 2026-10-24：原补录字段范围留作对照。 */}
                  <div className="libraryMetricInputs">{(['impressions', 'clicks', 'reads', 'likes', 'watch_count', 'saves', 'reward_count', 'interactive_count', 'comments', 'shares'] as const).map((key) =>
                    <label key={key}>{({ impressions: '曝光', clicks: '点击', reads: '阅读', likes: '点赞', watch_count: '在看', saves: '收藏', reward_count: '打赏', interactive_count: '互动量', comments: '评论', shares: '分享' })[key]}
                      <input type="number" min="0" value={metric[key]} onChange={(event) => setMetric({ ...metric, [key]: event.target.value })} /></label>)}</div>
                  <button className="secondaryButton" type="submit" disabled={busy}>保存快照</button></form>
              </details>}
              {/* 2026-10-24：本次修改原因：样本详情保留公众号接口原始非正文字段及实际查询条件。 */}
              {/* 2026-10-24：本次修改原因：抓取请求与返回字段集中展示为来源字段汇总。 */}
              {article.source_data?.response && <details className="articleSourceFields"><summary>抓取来源字段汇总</summary>
                {article.source_data.request && <><strong>请求条件</strong><dl>{Object.entries(article.source_data.request).map(([key, value]) =>
                  <div key={key}><dt>{key}</dt><dd>{value == null ? '未提供' : String(value)}</dd></div>)}</dl></>}
                <strong>返回字段</strong><dl>{Object.entries(article.source_data.response).map(([key, value]) =>
                  <div key={key}><dt>{key}</dt><dd>{value == null ? '未提供' : String(value)}</dd></div>)}</dl>
              </details>}
              <div className="libraryRelations"><strong>来源关系</strong>
                {article.profile_ids.length === 0 && article.strategy_ids.length === 0 ? <span>暂未被画像或策略引用</span> : <>
                  {article.profile_ids.map((id) => <button key={id} type="button" className="textButton"
                    onClick={() => { setProfileId(id); setTab('profiles') }}>查看引用画像 {id.slice(0, 8)} ↗</button>)}
                  {article.strategy_ids.map((id) => <a key={id} className="textButton" href="#/strategies"
                    onClick={() => sessionStorage.setItem('ai4geo.openStrategyId', id)}>查看引用策略 {id.slice(0, 8)} ↗</a>)}
                </>}</div>
            </>}
          </>}
        </section>
      </div>
    </>}

    {tab === 'profiles' && <div className="libraryProfileArea">
      <section className="card"><div className="librarySectionHead"><h2>分析同类文章</h2></div>
        <p className="subtle">按平台、类目、体裁和受众形成样本组。仅使用已核对、已确认权限且编辑质量至少 4 分的文章。</p>
        <form className="libraryEditForm" onSubmit={(event) => void analyze(event)}>
          <label>平台<select required value={profilePlatform} onChange={(event) => setProfilePlatform(event.target.value)}>
            <option value="">选择平台</option>{active('platform').map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}</select></label>
          <label>类目<select required value={profileCategory} onChange={(event) => setProfileCategory(event.target.value)}>
            <option value="">选择类目</option>{active('category').map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}</select></label>
          <div className="libraryFieldPair"><label>体裁<select value={profileFormat} onChange={(event) => setProfileFormat(event.target.value)}>
            <option value="">全部体裁</option>{active('format').map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}</select></label>
            <label>受众<select value={profileAudience} onChange={(event) => setProfileAudience(event.target.value)}>
              <option value="">全部受众</option>{active('audience').map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}</select></label></div>
          <label className="libraryCheck"><input type="checkbox" checked={includeAi} onChange={(event) => setIncludeAi(event.target.checked)} />
            用默认模型补充语义分析（会发送少量已授权代表文章并可能计费）</label>
          <button className="primaryButton" type="submit" disabled={busy}>{busy ? '正在分析…' : '分析并保存画像'}</button>
        </form>
        <div className="libraryRuns"><h3>最近分析</h3>{runs.length === 0 ? <p className="subtle">暂无运行记录。</p> :
          runs.slice(0, 5).map((run) => <div key={run.id}><strong>{label(run.scope.platform_id)} · {label(run.scope.category_id)}</strong>
            <span>{run.status === 'completed' ? '已完成' : run.status === 'failed' ? '失败' : '运行中'} · {run.method} · {displayDate(run.created_at)}</span>
            {run.error && <small>{run.error}</small>}</div>)}</div>
      </section>
      <section className="card"><div className="librarySectionHead"><h2>画像版本</h2><span>{profiles.length} 个</span></div>
        {profiles.length === 0 ? <div className="emptyState"><h3>还没有画像</h3><p>选定样本范围并运行一次分析。</p></div> :
          <div className="libraryProfileList">{profiles.map((item) => <button key={item.id} type="button"
            className={profileId === item.id ? 'selected' : ''} onClick={() => setProfileId(item.id)}>
            <strong>{label(item.platform_id)} · {label(item.category_id)} · {label(item.format_id)}</strong>
            <span>V{item.version} · {item.sample_count} 篇 · {item.method} · {displayDate(item.created_at)}</span></button>)}</div>}
        {profile && <div className="libraryProfileDetail">
          <h3>{label(profile.platform_id)} · {label(profile.category_id)} · V{profile.version}</h3>
          <p className="subtle">{profile.profile.confidence_note}。统计值描述样本群体，不能当作传播表现预测。</p>
          {/* {Boolean(profile.stale_sample_count) && <p className="alert warning">有 {profile.stale_sample_count} 篇来源文章内容、分类或权限已变化。请重新分析后再创建策略。</p>} 2026-10-24：原提示未涵盖删除的来源文章，留作对照。 */}
          {/* 2026-10-24：本次修改原因：画像失效提示明确包括已删除的来源文章。 */}
          {Boolean(profile.stale_sample_count) && <p className="alert warning">有 {profile.stale_sample_count} 篇来源文章已删除或发生变化。请重新分析后再创建策略。</p>}
          <div className="libraryStatistics">{Object.entries(profile.profile.statistics).map(([key, value]) =>
            <div key={key}><span>{STAT_LABELS[key] ?? key}</span><strong>{value.mean}</strong>
              <small>中位数 {value.p50} · 常见区间 {value.p10}–{value.p90} · 标准差 {value.std}</small></div>)}</div>
          {Object.keys(profile.profile.semantic).length > 0 && <div className="librarySemantic">
            <h4>模型语义观察 · {profile.model_name}</h4>{Object.entries(profile.profile.semantic).map(([key, value]) =>
              <p key={key}><strong>{FEATURE_LABELS[key] ?? key}：</strong>{value}</p>)}</div>}
          <p className="libraryMeta">来源文章 {profile.sample_count} 篇 · 代表文章 {profile.profile.representative_ids.length} 篇 · 已生成策略 {profile.strategy_ids?.length ?? 0} 个</p>
          <div className="libraryRelations"><strong>代表文章</strong>{profile.profile.representative_ids.map((id) =>
            <button key={id} type="button" className="textButton" onClick={() => { setSelectedId(id); setTab('articles') }}>
              打开文章 {id.slice(0, 8)} ↗</button>)}</div>
          <div className="libraryProfileActions"><button className="primaryButton" type="button" disabled={busy || Boolean(profile.stale_sample_count)}
            onClick={() => void createStrategy()}>{busy ? '正在创建…' : '以此画像创建策略草稿'}</button>
            <span>草稿仍需到“内容策略”审核和发布。</span></div>
        </div>}
      </section>
    </div>}
    {/* 2026-10-23：本次修改原因：双击样本或点击编辑均查看同一套已保存字段并调用原有 PATCH 接口。 */}
    {editorArticle && <ArticleEditorDialog key={editorArticle.id} mode="edit" initial={editorValue(editorArticle)}
      options={options} metrics={editorArticle.metrics} onClose={() => setEditorArticle(null)}
      onSave={async (payload) => {
        // await updateLibraryArticle(editorArticle.id, payload) // 2026-10-24：原仅更新文章字段、不保存编辑弹窗中新读数的逻辑留作对照。
        // 2026-10-24：本次修改原因：编辑弹窗与手动录入使用同一读数输入；有值时另存来源快照。
        const { new_metric: newMetric, ...changes } = payload
        await updateLibraryArticle(editorArticle.id, changes)
        if (newMetric) await addArticleMetric(editorArticle.id, newMetric as Record<string, unknown>)
        setEditorArticle(null)
        setSelectedId(editorArticle.id)
        setNotice('文章已保存。')
        refresh()
      }} />}
    {/* 2026-10-24：本次修改原因：删除属于不可撤销操作，明确目标与关联限制后再提交。 */}
    {deleteTarget && <div className="articleDialogBackdrop">
      <section className="articleDialog libraryDeleteDialog" role="dialog" aria-modal="true" aria-label="确认删除文章">
        <div className="articleDialogHead"><h2>删除文章</h2></div>
        <div className="libraryDeleteContent"><strong>{deleteTarget.title}</strong>
          <p>删除后，文章正文、来源信息和互动读数将从样本管理移除，无法恢复。</p>
          {/* {(deleteTarget.profile_ids.length > 0 || deleteTarget.strategy_ids.length > 0) && <p className="alert warning">这篇文章已被画像或策略引用，不能删除。可在“编辑与复核”中设为“已排除”。</p>} 2026-10-24：原引用阻止删除提示留作对照。 */}
          {/* 2026-10-24：本次修改原因：删除权限优先于画像和策略引用，明确关联内容将失效或停用。 */}
          {(deleteTarget.profile_ids.length > 0 || deleteTarget.strategy_ids.length > 0) &&
            <p className="alert warning">关联的风格画像将标记为失效，依赖这篇文章或这些画像的内容策略将停用。</p>}
          {deleteError && <p className="alert error" role="alert">{deleteError}</p>}
        </div>
        <div className="articleDialogActions">
          <button type="button" className="secondaryButton" disabled={busy}
            onClick={() => { setDeleteTarget(null); setDeleteError('') }}>取消</button>
          {/* <button type="button" className="dangerButton" disabled={busy || deleteTarget.profile_ids.length > 0 || deleteTarget.strategy_ids.length > 0} 2026-10-24：原引用禁止确认的条件留作对照。 */}
          <button type="button" className="dangerButton" disabled={busy}
            onClick={() => void confirmDeleteArticle()}>{busy ? '正在删除…' : '确认删除'}</button>
        </div>
      </section>
    </div>}
  </div>
}
