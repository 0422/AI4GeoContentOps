// 2026-10-23：本次修改原因：让用户安全录入、检索和检查各平台的高质量参考样本。
// import { useEffect, useState, type FormEvent } from 'react' // 2026-10-23：原导入留作对照。
// 2026-10-23：本次修改原因：取文期间切换录入对象时，用请求序号阻止旧结果覆盖新表单。
import { useEffect, useRef, useState, type FormEvent } from 'react'
// import { addSample, getSamples, type ContentOption, type ContentSample } from '../workspaceApi' // 2026-10-23：原导入保留供对照。
// 2026-10-23：本次修改原因：在样本库中增加 RedFox 公众号候选搜索与按需预览。
// import { addSample, getSamples, getRedFoxStatus, getRedFoxWechatArticle, searchRedFoxWechat, // 2026-10-23：原导入保留供对照。
// 2026-10-23：本次修改原因：样本库增加三种榜单采集请求。
// import { addSample, getSamples, getRedFoxStatus, getRedFoxWechatArticle, getRedFoxWechatRank, searchRedFoxWechat, // 2026-10-23：原公众号专用发现接口导入暂留供对照。
// 2026-10-23：本次修改原因：六个平台共用发现查询，并使用可确认的日期范围弹层。
// import { addSample, getSamples, getRedFoxStatus, getRedFoxWechatArticle, getRedFoxCandidateDetail, discoverRedFoxCandidates, // 2026-10-24：原收录时再次查询作品详情的导入留作对照。
// 2026-10-24：本次修改原因：发现页收录直接使用已返回的 RedFox 候选字段，不再发起第二次取文请求。
import { addSample, getSamples, getRedFoxStatus, getRedFoxWechatArticle, discoverRedFoxCandidates,
  type ContentOption, type ContentSample, type RedFoxCandidate, type RedFoxSearchResult } from '../workspaceApi'
import DateRangePicker from '../components/DateRangePicker'
// 2026-10-23：本次修改原因：候选收录和手动录入使用统一的字段确认弹窗。
// import ArticleEditorDialog, { blankArticleEditor, type ArticleEditorValue } from '../components/ArticleEditorDialog' // 2026-10-24：原导入留作对照。
// 2026-10-24：本次修改原因：批量收录复用单篇弹窗的字段转换，避免来源指标丢失。
import ArticleEditorDialog, { blankArticleEditor, editorPayload, type ArticleEditorValue } from '../components/ArticleEditorDialog'
// 2026-10-23：本次修改原因：新版录入一次提交文章和来源元数据，旧录入 API 继续保留给旧页面模式。
// import { createLibraryArticle } from '../articleLibraryApi' // 2026-10-24：原单篇接口导入留作对照。
// 2026-10-24：本次修改原因：候选草稿独立暂存，批量提交成功后移除草稿。
import { createLibraryArticle, deleteCandidateDraft, getCandidateDrafts, saveCandidateDraft } from '../articleLibraryApi'
// 2026-10-23：本次修改原因：候选文章可直接提炼为待审核策略草稿。
// import { analyzeRedFoxWechatArticle, type ContentStrategy } from '../workspaceApi' // 2026-10-23：原样本库内提炼入口暂留供对照。

// 2026-10-23：本次修改原因：榜单类目以 RedFox 标准类目为准，与项目里可编辑的内容类目分开选择。
// const RANK_CATEGORIES = ['总排名', '人文资讯', '知识百科', '健康养生', '时尚潮流', '美食餐饮',
//   '乐活生活', '旅游出行', '搞笑幽默', '情感心理', '体育娱乐', '美容美体', '文摘精选',
//   '财富理财', '科技数码', '创投商业', '汽车交通', '房产楼市', '职场发展', '教育考试',
//   '学术研究', '企业品牌']  // 2026-10-24：原含未在两份榜单文档列出的美食餐饮选项留作对照。
// 2026-10-24：本次修改原因：榜单类目严格使用两份接口文档共同列出的值。
const RANK_CATEGORIES = ['总排名', '人文资讯', '知识百科', '健康养生', '时尚潮流',
  '乐活生活', '旅游出行', '搞笑幽默', '情感心理', '体育娱乐', '美容美体', '文摘精选',
  '财富理财', '科技数码', '创投商业', '汽车交通', '房产楼市', '职场发展', '教育考试',
  '学术研究', '企业品牌']

// 2026-10-23：本次修改原因：日期控件使用本地日期，避免 UTC 日期跨日使榜单默认范围偏移。
function localDateOffset(days: number): string {
  const value = new Date()
  value.setDate(value.getDate() + days)
  return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`
}

// 2026-10-23：本次修改原因：仅把精确数字写入指标快照，“10W+”等近似文本保持缺失。
function exactCount(value: number | string | null | undefined): string {
  if (typeof value === 'number') return Number.isSafeInteger(value) && value >= 0 ? String(value) : ''
  if (typeof value === 'string' && /^\d[\d,]*$/.test(value.trim())) {
    const number = Number(value.replaceAll(',', ''))
    return Number.isSafeInteger(number) && number >= 0 ? String(number) : ''
  }
  return ''
}

// 2026-10-23：本次修改原因：采集方式包含现有关键词发现和新增的三个榜单。
// type CollectMode = 'quality' | 'hot' | 'ten_w' | 'original' | 'growth' // 2026-10-23：原公众号模式类型暂留供对照。
// 2026-10-23：本次修改原因：采集方式随目标平台变化，关键词只出现在需要输入的方式。
type CollectPlatform = 'wechat' | 'xiaohongshu' | 'baijiahao' | 'toutiao' | 'multi' | 'zhihu'
type CollectMode = 'ten_w' | 'original' | 'keyword' | 'dark_horse' | 'daily' | 'weekly' | 'top10' | 'hotspot'
const COLLECT_METHODS: Record<CollectPlatform, { value: CollectMode; label: string }[]> = {
  wechat: [{ value: 'ten_w', label: '10W+' }, { value: 'original', label: '原创爆款' }, { value: 'keyword', label: '关键词' }],
  xiaohongshu: [{ value: 'dark_horse', label: '黑马爆文' }, { value: 'daily', label: '每日爆款笔记' }, { value: 'weekly', label: '七日爆款笔记' }],
  baijiahao: [{ value: 'keyword', label: '关键词搜索' }],
  toutiao: [{ value: 'keyword', label: '关键词搜索' }],
  multi: [{ value: 'top10', label: '热点 Top10' }, { value: 'keyword', label: '关键词' }, { value: 'hotspot', label: '热点榜' }],
  zhihu: [{ value: 'keyword', label: '关键词搜索' }, { value: 'hotspot', label: '热点' }],
}
// 2026-10-23：本次修改原因：采用 RedFox 小红书文档列出的完整赛道类目。
// const XHS_CATEGORIES = ['综合全部', '出行代步', '医疗保健', '时尚穿搭', '美味佳肴'] // 2026-10-23：原示例类目暂留供对照。
const XHS_CATEGORIES = ['综合全部', '出行代步', '医疗保健', '休闲爱好', '综合杂项', '婚庆婚礼',
  '居家装修', '影视娱乐', '星座情感', '拍摄记录', '学习教育', '旅行度假', '亲子育儿', '日常生活',
  '科学探索', '数码科技', '时尚穿搭', '化妆美容', '个人护理', '美味佳肴', '职业发展',
  '宠物天地', '新闻资讯', '体育锻炼', '潮流鞋包']
const HOTSPOT_PLATFORMS = [['6', '小红书'], ['9', '知乎'], ['10', '今日头条'], ['7', '百度'], ['5', '微博'], ['8', 'B站'], ['2', '抖音'], ['1', '快手']]
const PLATFORM_LABELS: Record<CollectPlatform, string> = {
  wechat: '微信公众号', xiaohongshu: '小红书', baijiahao: '百家号',
  toutiao: '今日头条', multi: '多平台', zhihu: '知乎',
}
// 2026-10-23：本次修改原因：查询结果用简短名称区分文章候选与热点话题。
const SOURCE_LABELS: Record<RedFoxSearchResult['source'], string> = {
  quality: '公众号关键词', hot: '公众号热门', ten_w: '10W+', original: '原创爆款', growth: '阅读增长',
  keyword: '关键词', dark_horse: '黑马爆文', daily: '每日爆款笔记', weekly: '七日爆款笔记',
  top10: '热点 Top10', hotspot: '热点榜',
}

// 2026-10-24：本次修改原因：跨页选择、草稿与已收录标记使用同一个候选身份。
const candidateKey = (candidate: RedFoxCandidate, fallback: CollectPlatform) =>
  `${candidate.platform || fallback}:${candidate.id}`

// 2026-10-24：本次修改原因：批量预检遵守单篇入库必填规则，未补齐项保留在待处理列表。
function draftMissing(value?: ArticleEditorValue): string[] {
  if (!value) return ['尚未核对']
  return [!value.title.trim() && '标题', value.body_text.trim().length < 50 && '正文',
    !value.platform_id && '平台', !value.category_id && '类目',
    !value.rights_confirmed && '使用权限'].filter(Boolean) as string[]
}

// 2026-10-24：本次修改原因：截断的抓取正文不能仅凭字数达标就一键入库。
function candidateMissing(candidate: RedFoxCandidate, value?: ArticleEditorValue): string[] {
  const missing = draftMissing(value)
  if (candidate.body_truncated && (!value || value.body_text === candidate.body_text)) missing.push('正文截断待补齐')
  return missing
}

// export default function SamplesPage({ options }: { options: ContentOption[] }) { // 2026-10-23：原单页入口保留供对照。
// 2026-10-23：本次修改原因：公众号发现与录入可嵌入新版文章库，旧页面模式仍保留。
// export default function SamplesPage({ options, mode = 'legacy', onSaved, startWithForm = false }: { options: ContentOption[]; mode?: 'legacy' | 'discovery'; onSaved?: () => void; startWithForm?: boolean }) { // 2026-10-23：原顶部快捷入口传参留作对照。
// 2026-10-23：本次修改原因：手动录入由查询按钮旁直接触发，不再从页眉传入展开状态。
export default function SamplesPage({ options, mode = 'legacy', onSaved }: {
  options: ContentOption[]; mode?: 'legacy' | 'discovery'; onSaved?: () => void
}) {
  const active = (kind: ContentOption['kind']) => options.filter((item) => item.kind === kind && item.active)
  const label = (id: string | null) => options.find((item) => item.id === id)?.label ?? '通用'
  const [samples, setSamples] = useState<ContentSample[]>([])
  const [platformId, setPlatformId] = useState('')
  const [categoryId, setCategoryId] = useState('')
  const [formatId, setFormatId] = useState('')
  const [title, setTitle] = useState('')
  const [sourceUrl, setSourceUrl] = useState('')
  const [body, setBody] = useState('')
  const [qualityScore, setQualityScore] = useState(4)
  const [rightsConfirmed, setRightsConfirmed] = useState(false)
  // 2026-10-23：本次修改原因：在首次入库时记录作者、发布时间、受众与权限依据，减少事后补录。
  const [authorId, setAuthorId] = useState('')
  const [accountFollowers, setAccountFollowers] = useState('')
  const [publishedAt, setPublishedAt] = useState('')
  const [audienceId, setAudienceId] = useState('')
  const [topic, setTopic] = useState('')
  const [tags, setTags] = useState('')
  const [usageRightsNote, setUsageRightsNote] = useState('')
  const [reviewStatus, setReviewStatus] = useState<'pending' | 'ready'>('ready')
  const [metricSource, setMetricSource] = useState('人工录入')
  const [candidateMetrics, setCandidateMetrics] = useState({ reads: '', likes: '', comments: '', shares: '' })
  const [query, setQuery] = useState('')
  const [filterPlatform, setFilterPlatform] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  // 2026-10-23：本次修改原因：参考文章录入只在手动新建或候选填入后展开，样本列表保持主视图。
  // const [showSampleForm, setShowSampleForm] = useState(false) // 2026-10-23：原初始折叠状态保留供对照。
  // 2026-10-23：本次修改原因：从“新增样本”入口进入时直接展开录入表单。
  // const [showSampleForm, setShowSampleForm] = useState(startWithForm) // 2026-10-23：原快捷入口初始状态留作对照。
  // 2026-10-23：本次修改原因：录入表单仅由手动按钮或候选条目展开，并区分标题显示。
  const [showSampleForm, setShowSampleForm] = useState(false)
  const [formOrigin, setFormOrigin] = useState<'manual' | 'candidate' | null>(null)
  // 2026-10-23：本次修改原因：搜索结果只是候选；用户选择后才请求全文并填写现有样本表单。
  const [redfoxConfigured, setRedfoxConfigured] = useState<boolean | null>(null)
  const [collectKeyword, setCollectKeyword] = useState('')
  // 2026-10-23：本次修改原因：优质库搜索用于寻找可取全文的文章，热门库用于选题发现。
  // const [searchSource, setSearchSource] = useState<'quality' | 'hot'>('quality') // 2026-10-23：原仅关键词来源状态保留供对照。
  // 2026-10-23：本次修改原因：不同采集方式分别显示关键词、类目与日期参数。
  // 2026-10-23：本次修改原因：目标平台决定可选方式，时间范围只有确认后才更新查询条件。
  const [collectPlatform, setCollectPlatform] = useState<CollectPlatform>('wechat')
  const [collectMode, setCollectMode] = useState<CollectMode>('ten_w')
  const [rankCategory, setRankCategory] = useState('总排名')
  const [xhsCategory, setXhsCategory] = useState('综合全部')
  const [hotspotPlatform, setHotspotPlatform] = useState('6')
  const [rankStartDate, setRankStartDate] = useState(() => localDateOffset(-2))
  const [rankEndDate, setRankEndDate] = useState(() => localDateOffset(-1))
  const [rankDate, setRankDate] = useState(() => localDateOffset(-1))
  const [topStart, setTopStart] = useState(() => `${localDateOffset(0)} 00:00:00`)
  const [topEnd, setTopEnd] = useState(() => `${localDateOffset(0)} 23:59:59`)
  const [collectResult, setCollectResult] = useState<RedFoxSearchResult | null>(null)
  // 2026-10-23：本次修改原因：按已提交的条件翻页并缓存看过的页，避免返回上一页时重复调用 RedFox。
  const [candidatePage, setCandidatePage] = useState(1)
  const candidatePages = useRef<Record<number, RedFoxSearchResult>>({})
  // 2026-10-24：本次修改原因：缓存的发现查询必须保留必需的平台和采集方式字段，分页请求才能满足 API 契约。
  type CandidateQuery = Omit<Parameters<typeof discoverRedFoxCandidates>[0], 'page'>
  const submittedQuery = useRef<CandidateQuery | null>(null)
  const candidateRequestId = useRef(0)
  const [collectedIds, setCollectedIds] = useState<string[]>([])
  const [editor, setEditor] = useState<{ key: string; value: ArticleEditorValue; candidate: boolean; issue: string } | null>(null)
  // 2026-10-24：本次修改原因：跨页保留选择、草稿和本页状态筛选，批量结果逐篇可追溯。
  const [selectedCandidates, setSelectedCandidates] = useState<Record<string, RedFoxCandidate>>({})
  const [candidateDrafts, setCandidateDrafts] = useState<Record<string, ArticleEditorValue>>({})
  const [statusFilter, setStatusFilter] = useState<'all' | 'uncollected' | 'collected'>('all')
  const [batchOpen, setBatchOpen] = useState(false)
  const [batchBusy, setBatchBusy] = useState(false)
  const [batchProgress, setBatchProgress] = useState('')
  const [batchResults, setBatchResults] = useState<{ key: string; title: string; error: string }[]>([])
  // 2026-10-24：本次修改原因：批量核对可统一补类目，并由用户明确确认选中正文的使用权限。
  const [batchCategoryId, setBatchCategoryId] = useState('')
  const [batchRightsConfirmed, setBatchRightsConfirmed] = useState(false)
  const [batchReviewMessage, setBatchReviewMessage] = useState('')
  const [returnToBatch, setReturnToBatch] = useState(false)
  const [collectBusy, setCollectBusy] = useState(false)
  const [collectError, setCollectError] = useState('')
  const [previewUrl, setPreviewUrl] = useState('')
  // 2026-10-23：本次修改原因：异步取文只更新当前正在录入的候选。
  const previewRequest = useRef(0)

  // 2026-10-24：本次修改原因：待收录草稿从本地 API 恢复，刷新页面后仍能继续补齐。
  useEffect(() => {
    if (mode !== 'discovery') return
    getCandidateDrafts<ArticleEditorValue>().then(setCandidateDrafts)
      .catch((reason) => setCollectError(reason instanceof Error ? reason.message : '待收录草稿加载失败'))
  }, [mode])
  // 2026-10-23：本次修改原因：跟踪单篇分析状态并在当前页展示策略结果。
  // const [analysisUrl, setAnalysisUrl] = useState('') // 2026-10-23：原样本库分析状态暂留供对照。
  // const [analysisResult, setAnalysisResult] = useState<ContentStrategy | null>(null) // 2026-10-23：原策略结果状态暂留供对照。

  useEffect(() => {
    setPlatformId((current) => active('platform').some((item) => item.id === current) ? current : active('platform')[0]?.id ?? '')
    setCategoryId((current) => active('category').some((item) => item.id === current) ? current : active('category')[0]?.id ?? '')
  }, [options])

  useEffect(() => {
    // 2026-10-23：本次修改原因：发现视图不再下载整批样本正文，已入库列表改由分页接口读取。
    if (mode === 'discovery') return
    getSamples().then(setSamples).catch((reason) =>
      setError(reason instanceof Error ? reason.message : '样本读取失败'))
  }, [mode])

  // 2026-10-23：本次修改原因：从文章库“新增样本”进入时直接定位到已展开的录入表单。
  // useEffect(() => { if (startWithForm) openSampleForm() }, [startWithForm]) // 2026-10-23：原快捷入口自动展开逻辑留作对照。

  // 2026-10-23：本次修改原因：策略页取全文失败后回到样本库时，自动填入已知标题与来源，用户只需补正文。
  useEffect(() => {
    const pending = sessionStorage.getItem('ai4geo.sampleImportCandidate')
    if (!pending) return
    sessionStorage.removeItem('ai4geo.sampleImportCandidate')
    try {
      const candidate = JSON.parse(pending) as { title: string; url: string; category_id: string; format_id: string | null }
      // 2026-10-24：本次修改原因：从策略页移交的候选也进入新弹窗，避免旧下方表单隐藏后无法补录。
      if (mode === 'discovery') {
        const value = blankArticleEditor('platform_01', candidate.category_id)
        value.title = candidate.title
        value.source_url = candidate.url
        value.format_id = candidate.format_id || ''
        setEditor({ key: `handoff-${candidate.url}`, value, candidate: true, issue: '' })
        return
      }
      setPlatformId('platform_01')
      setTitle(candidate.title)
      setSourceUrl(candidate.url)
      setCategoryId(candidate.category_id)
      setFormatId(candidate.format_id ?? '')
      setBody('')
      setRightsConfirmed(false)
      // setMessage('已填入候选标题和来源链接。请核对原文、补入正文并确认使用权限后保存。') // 2026-10-23：原重复操作说明留作对照。
      // 2026-10-23：本次修改原因：仅提示实际预填结果及缺失内容。
      setMessage('已预填标题和来源，请补正文。')
      // 2026-10-23：本次修改原因：外部移交的候选使用预填表单，不显示手动录入标题。
      setFormOrigin('candidate')
      // requestAnimationFrame(() => document.getElementById('sample-import-form')?.scrollIntoView({ behavior: 'smooth', block: 'start' })) // 2026-10-23：原直接滚动逻辑暂留供对照。
      // 2026-10-23：本次修改原因：先展开录入区，再定位表单，避免折叠状态下滚动失效。
      openSampleForm()
    } catch {
      setError('候选信息无法读取，请重新搜索文章。')
    }
  }, [])

  // 2026-10-23：本次修改原因：仅展示后端密钥配置状态，不向前端返回密钥本身。
  useEffect(() => {
    getRedFoxStatus().then((status) => setRedfoxConfigured(status.configured))
      .catch(() => setRedfoxConfigured(false))
  }, [])

  // 2026-10-23：本次修改原因：候选预填和手动录入共用展开逻辑，确保用户直接看到可编辑正文。
  function openSampleForm() {
    setShowSampleForm(true)
    window.setTimeout(() => document.getElementById('sample-import-form')?.scrollIntoView({
      behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth',
      block: 'start',
    }), 0)
  }

  // 2026-10-23：本次修改原因：查询旁的手动录入始终打开空白表单，避免沿用上一个候选的数据。
  function startManualEntry() {
    if (showSampleForm && formOrigin === 'manual') { openSampleForm(); return }
    previewRequest.current += 1
    setPreviewUrl('')
    setFormOrigin('manual')
    // setPlatformId(active('platform')[0]?.id ?? '') // 2026-10-23：原固定首个平台预选暂留供对照。
    // 2026-10-23：本次修改原因：手动录入预选当前目标平台，跨平台热点不预设文章来源。
    const selectedPlatform = active('platform').find((item) => item.label === PLATFORM_LABELS[collectPlatform] ||
      (collectPlatform === 'toutiao' && item.label === '头条'))
    setPlatformId(collectPlatform === 'multi' ? '' : selectedPlatform?.id ?? active('platform')[0]?.id ?? '')
    setCategoryId(active('category')[0]?.id ?? '')
    setTitle('')
    setSourceUrl('')
    setBody('')
    setAuthorId('')
    setAccountFollowers('')
    setPublishedAt('')
    setAudienceId('')
    setTopic('')
    setTags('')
    setUsageRightsNote('')
    setFormatId('')
    setQualityScore(4)
    setReviewStatus('ready')
    setMetricSource('人工录入')
    setCandidateMetrics({ reads: '', likes: '', comments: '', shares: '' })
    setRightsConfirmed(false)
    setError('')
    setMessage('')
    openSampleForm()
  }

  // 2026-10-23：本次修改原因：首轮搜索只取近七天最多十篇候选，以控制接口调用量。
  async function searchCandidates(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const requestId = ++candidateRequestId.current
    setCollectError('')
    setCollectResult(null)
    setCandidatePage(1)
    candidatePages.current = {}
    // 2026-10-24：本次修改原因：新查询不继承旧候选选择，已暂存草稿继续保留。
    setSelectedCandidates({})
    setStatusFilter('all')
    setBatchResults([])
    // 2026-10-24：本次修改原因：新查询不沿用上批文章的类目和权限确认。
    setBatchCategoryId('')
    setBatchRightsConfirmed(false)
    setBatchReviewMessage('')
    setCollectBusy(true)
    try {
      // setCollectResult(await searchRedFoxWechat(collectKeyword.trim())) // 2026-10-23：原固定热门库搜索暂留供对照。
      // setCollectResult(await searchRedFoxWechat(collectKeyword.trim(), searchSource)) // 2026-10-23：原二选一关键词采集保留供对照。
      // 2026-10-23：本次修改原因：榜单无需关键词；按类型传送准确的类目和日期参数。
      // 2026-10-23：原公众号分支暂留供对照。
      // if (collectMode === 'quality' || collectMode === 'hot') {
      //   setCollectResult(await searchRedFoxWechat(collectKeyword.trim(), collectMode))
      // } else if (collectMode === 'growth') {
      //   setCollectResult(await getRedFoxWechatRank({ source: 'growth', rank_date: rankDate }))
      // } else {
      //   setCollectResult(await getRedFoxWechatRank({ source: collectMode, category: rankCategory,
      //     start_date: rankStartDate, end_date: rankEndDate }))
      //   const matchedCategory = active('category').find((item) => item.label === rankCategory)
      //   if (matchedCategory) setCategoryId(matchedCategory.id)
      // }
      // 2026-10-23：本次修改原因：仅提交当前平台和方式真正需要的条件。
      const needsRange = (collectPlatform === 'wechat' && collectMode !== 'keyword') ||
        collectPlatform === 'multi' || (collectPlatform === 'zhihu' && collectMode === 'hotspot')
      const needsCategory = collectPlatform === 'xiaohongshu' || (collectPlatform === 'wechat' && collectMode !== 'keyword')
      const isTop10 = collectPlatform === 'multi' && collectMode === 'top10'
      if (collectMode === 'keyword' && collectKeyword.trim().length < 2) {
        throw new Error('请至少输入两个关键词字符')
      }
      const search: CandidateQuery = {
        platform: collectPlatform, method: collectMode,
        keyword: collectMode === 'keyword' ? collectKeyword.trim() : '',
        category: needsCategory ? (collectPlatform === 'xiaohongshu' ? xhsCategory : rankCategory) : '',
        start_date: needsRange ? (isTop10 ? topStart : rankStartDate) : '',
        end_date: needsRange ? (isTop10 ? topEnd : rankEndDate) : '',
        rank_date: collectPlatform === 'xiaohongshu' ? rankDate : '',
        hotspot_platform: collectPlatform === 'multi' && collectMode === 'hotspot' ? hotspotPlatform : '',
      }
      submittedQuery.current = search
      const result = await discoverRedFoxCandidates({ ...search, page: '1' })
      if (requestId !== candidateRequestId.current) return
      candidatePages.current[1] = result
      setCollectResult(result)
      if (collectPlatform === 'wechat' && needsCategory) {
        const matchedCategory = active('category').find((item) => item.label === rankCategory)
        if (matchedCategory) setCategoryId(matchedCategory.id)
      }
    } catch (reason) {
      if (requestId === candidateRequestId.current) setCollectError(reason instanceof Error ? reason.message : '候选查询失败')
    } finally {
      if (requestId === candidateRequestId.current) setCollectBusy(false)
    }
  }

  // 2026-10-23：本次修改原因：候选按页读取，只有首次打开某页才调用外部查询。
  async function goCandidatePage(page: number) {
    if (page < 1 || !submittedQuery.current) return
    const cached = candidatePages.current[page]
    if (cached) { setCandidatePage(page); setCollectResult(cached); return }
    const requestId = ++candidateRequestId.current
    setCollectBusy(true); setCollectError('')
    try {
      const result = await discoverRedFoxCandidates({ ...submittedQuery.current, page: String(page) })
      if (requestId !== candidateRequestId.current) return
      // 2026-10-24：本次修改原因：提供商未给总数时可能多报一页；空页不覆盖当前结果。
      if (page > 1 && result.items.length === 0) {
        const current = candidatePages.current[candidatePage]
        if (current) {
          candidatePages.current[candidatePage] = { ...current, has_more: false }
          setCollectResult(candidatePages.current[candidatePage])
        }
        return
      }
      candidatePages.current[page] = result
      setCandidatePage(page); setCollectResult(result)
    } catch (reason) {
      if (requestId === candidateRequestId.current) setCollectError(reason instanceof Error ? reason.message : '翻页失败')
    } finally {
      if (requestId === candidateRequestId.current) setCollectBusy(false)
    }
  }

  // 2026-10-24：本次修改原因：单篇核对与批量核对共用 RedFox 候选到录入字段的映射。
  function candidateEditorValue(candidate: RedFoxCandidate, identity: string): ArticleEditorValue {
    const sourcePlatform = (candidate.platform || collectPlatform) as CollectPlatform
    const sourceOption = active('platform').find((item) => item.label === PLATFORM_LABELS[sourcePlatform] ||
      (sourcePlatform === 'toutiao' && item.label === '头条'))
    const contentCategory = active('category').find((item) => item.label === (candidate.category || rankCategory))
    const initial = blankArticleEditor(sourceOption?.id || '', contentCategory?.id || '')
    initial.title = candidate.title === '未提供标题' ? '' : candidate.title
    initial.body_text = candidate.body_text || ''
    initial.source_url = candidate.url || ''
    initial.author_id = candidate.author || ''
    initial.account_followers = exactCount(candidate.account_followers)
    initial.published_at = candidate.published_at?.match(/^\d{4}-\d{2}-\d{2}/)?.[0] || ''
    initial.metric_source = `RedFox · ${PLATFORM_LABELS[sourcePlatform]}`
    const syncedAt = candidate.source_data?.response?.syncTime
    if (typeof syncedAt === 'string' && /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(syncedAt)) {
      initial.metric_captured_at = syncedAt.replace(' ', 'T')
    }
    initial.source_data = { ...(candidate.source_data || {}), candidate_key: identity }
    initial.raw_counts = Object.fromEntries(([
      ['followers', candidate.account_followers], ['reads', candidate.read_count],
      ['likes', candidate.like_count], ['watch_count', candidate.watch_count],
      ['comments', candidate.comment_count], ['shares', candidate.share_count],
      ['saves', candidate.save_count], ['reward_count', candidate.reward_count],
      ['interactive_count', candidate.interactive_count],
    ] as const).filter(([, value]) => value != null && String(value).trim() && String(value).length <= 40)
      .map(([key, value]) => [key, String(value)]))
    initial.reads = exactCount(candidate.read_count)
    initial.likes = exactCount(candidate.like_count)
    initial.watch_count = exactCount(candidate.watch_count)
    initial.comments = exactCount(candidate.comment_count)
    initial.shares = exactCount(candidate.share_count)
    initial.saves = exactCount(candidate.save_count)
    initial.reward_count = exactCount(candidate.reward_count)
    initial.interactive_count = exactCount(candidate.interactive_count)
    return initial
  }

  // 2026-10-24：本次修改原因：弹窗中的可收录数量、逐篇缺项和提交预检使用同一份批量补齐结果。
  function batchCandidateValue(key: string, candidate: RedFoxCandidate): ArticleEditorValue {
    const prior = candidateDrafts[key] || candidateEditorValue(candidate, key)
    /* 2026-10-24：原批量确认权限后仍沿用草稿待核对状态的映射留作对照。
    return { ...prior, category_id: prior.category_id || batchCategoryId,
      rights_confirmed: prior.rights_confirmed || batchRightsConfirmed,
      source_data: { ...prior.source_data, candidate_key: key } }
    */
    // 2026-10-24：本次修改原因：批量确认正文及使用权限后同步标为可分析。
    const confirmed = prior.rights_confirmed || batchRightsConfirmed
    return { ...prior, category_id: prior.category_id || batchCategoryId,
      rights_confirmed: confirmed, review_status: confirmed ? 'ready' : 'pending',
      source_data: { ...prior.source_data, candidate_key: key } }
  }

  // 2026-10-23：原收录时才补取选中作品正文的做法留作对照。
  // 2026-10-24：本次修改原因：收录直接使用 RedFox 查询结果，缺正文时在同一弹窗提示人工补齐。
  // async function collectCandidate(candidate: RedFoxCandidate) { // 2026-10-24：原收录等待二次网络请求的签名留作对照。
  // 2026-10-24：本次修改原因：直接打开 RedFox 候选核对弹窗，无需异步采集状态。
  function collectCandidate(candidate: RedFoxCandidate) {
    if (candidate.kind === 'topic') return
    // const identity = `${candidate.platform || collectPlatform}:${candidate.id}` // 2026-10-24：原候选身份拼接留作对照。
    // 2026-10-24：本次修改原因：已暂存候选打开时保留人工补充字段，不用接口结果覆盖。
    const identity = candidateKey(candidate, collectPlatform)
    if (candidate.collected || collectedIds.includes(identity) || previewUrl) return
    const savedDraft = candidateDrafts[identity]
    if (savedDraft) {
      setEditor({ key: identity, value: savedDraft, candidate: true,
        issue: candidateMissing(candidate, savedDraft).length ? '待收录草稿仍需补齐。' : '' })
      return
    }
    /* 2026-10-24：原单篇候选映射留作对照，现由 candidateEditorValue 统一处理。
    const sourcePlatform = (candidate.platform || collectPlatform) as CollectPlatform
    const sourceOption = active('platform').find((item) => item.label === PLATFORM_LABELS[sourcePlatform] ||
      (sourcePlatform === 'toutiao' && item.label === '头条'))
    const contentCategory = active('category').find((item) => item.label === (candidate.category || rankCategory))
    const initial = blankArticleEditor(sourceOption?.id || '', contentCategory?.id || '')
    initial.title = candidate.title === '未提供标题' ? '' : candidate.title
    initial.body_text = candidate.body_text || ''
    initial.source_url = candidate.url || ''
    initial.author_id = candidate.author || ''
    // 2026-10-24：本次修改原因：RedFox 提供账号规模时预填精确粉丝数，近似值留作核对。
    initial.account_followers = exactCount(candidate.account_followers)
    initial.published_at = candidate.published_at?.match(/^\d{4}-\d{2}-\d{2}/)?.[0] || ''
    initial.metric_source = `RedFox · ${PLATFORM_LABELS[sourcePlatform]}`
    // 2026-10-24：本次修改原因：关键词结果的 syncTime 比本地保存时间更接近指标实际观测时间。
    const syncedAt = candidate.source_data?.response?.syncTime
    if (typeof syncedAt === 'string' && /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(syncedAt)) {
      initial.metric_captured_at = syncedAt.replace(' ', 'T')
    }
    // 2026-10-24：本次修改原因：保存查询条件与接口原始来源字段，供样本管理逐项核对。
    // initial.source_data = candidate.source_data || {} // 2026-10-24：原只保存来源字段留作对照。
    // 2026-10-24：本次修改原因：无原文链接时仍能用候选身份恢复已收录状态。
    initial.source_data = { ...(candidate.source_data || {}), candidate_key: identity }
    // 2026-10-24：本次修改原因：候选显示的每项原始读数随文章保存，避免“10W+”入库后消失。
    initial.raw_counts = Object.fromEntries(([
      ['followers', candidate.account_followers], ['reads', candidate.read_count],
      ['likes', candidate.like_count], ['watch_count', candidate.watch_count],
      ['comments', candidate.comment_count], ['shares', candidate.share_count],
      ['saves', candidate.save_count], ['reward_count', candidate.reward_count],
      ['interactive_count', candidate.interactive_count],
    ] as const).filter(([, value]) => value != null && String(value).trim() && String(value).length <= 40)
      .map(([key, value]) => [key, String(value)]))
    initial.reads = exactCount(candidate.read_count)
    initial.likes = exactCount(candidate.like_count)
    initial.watch_count = exactCount(candidate.watch_count)
    initial.comments = exactCount(candidate.comment_count)
    initial.shares = exactCount(candidate.share_count)
    // 2026-10-24：本次修改原因：关键词收藏/打赏及榜单互动量有值时预填精确指标。
    initial.saves = exactCount(candidate.save_count)
    initial.reward_count = exactCount(candidate.reward_count)
    initial.interactive_count = exactCount(candidate.interactive_count)
    */
    // 2026-10-24：本次修改原因：批量与单篇核对得到完全一致的正文、来源字段和互动读数。
    const initial = candidateEditorValue(candidate, identity)
    /* 2026-10-24：原收录前再调用公众号浏览器取文或其他平台详情接口的流程留作对照。
    let issue = ''
    setPreviewUrl(candidate.url || candidate.id)
    try {
      if (initial.body_text.trim().length < 50 && sourcePlatform === 'wechat' && candidate.url) {
        const detail = await getRedFoxWechatArticle(candidate.url)
        initial.body_text = detail.body_text || ''
        if (!initial.title) initial.title = detail.title || ''
        if (detail.truncated) issue = '正文已截断，请核对补齐。'
      } else if (initial.body_text.trim().length < 50 && ['xiaohongshu', 'baijiahao', 'toutiao'].includes(sourcePlatform)) {
        const detail = await getRedFoxCandidateDetail({ platform: sourcePlatform, work_id: candidate.id, url: candidate.url })
        initial.body_text = detail.body_text || ''
        if (!initial.title) initial.title = detail.title || ''
        if (!initial.source_url) initial.source_url = detail.source_url || ''
        if (detail.body_truncated) issue = '正文已截断，请核对补齐。'
      }
    } catch (reason) {
      issue = reason instanceof Error ? `正文未取得：${reason.message}` : '正文未取得，请手动补齐。'
    } finally {
      setPreviewUrl('')
      setEditor({ key: identity, value: initial, candidate: true, issue })
    }
    */
    // 2026-10-24：本次修改原因：保留 RedFox 已取得的正文、摘要、指标和来源；无正文时只提示补录。
    const issue = candidate.body_truncated ? 'RedFox 正文已截断，请核对补齐。'
      : initial.body_text.trim().length < 50 ? 'RedFox 本次未提供可入库的正文，请打开原文后手动补齐。' : ''
    setEditor({ key: identity, value: initial, candidate: true, issue })
  }

  // 2026-10-23：本次修改原因：热点话题转为可查询的文章关键词，避免把话题当文章直接保存。
  function searchTopicArticles(candidate: RedFoxCandidate) {
    setCollectPlatform('wechat')
    setCollectMode('keyword')
    setCollectKeyword(candidate.title)
    setCollectResult(null)
    setCollectError('')
  }

  // 2026-10-23：本次修改原因：手动录入使用同一弹窗，来源平台优先采用当前选择。
  function openManualDialog() {
    const sourceOption = active('platform').find((item) => item.label === PLATFORM_LABELS[collectPlatform] ||
      (collectPlatform === 'toutiao' && item.label === '头条'))
    setEditor({ key: `manual-${Date.now()}`, value: blankArticleEditor(sourceOption?.id || ''),
      candidate: false, issue: '' })
  }

  // 2026-10-23：本次修改原因：仅在编辑选择某篇文章后拉取详情，并由其自行核对和确认使用权限。
  async function previewCandidate(candidate: RedFoxCandidate) {
    // 2026-10-23：本次修改原因：热点是选题线索，不能作为已找到原文的文章候选录入。
    if (candidate.kind === 'topic') return
    const requestId = ++previewRequest.current
    // 2026-10-23：本次修改原因：录入表单按候选来源预选平台，头条兼容旧选项名称。
    const sourcePlatform = candidate.platform as CollectPlatform | undefined
    const platformOption = active('platform').find((item) => item.label === PLATFORM_LABELS[sourcePlatform || 'wechat'] ||
      (sourcePlatform === 'toutiao' && item.label === '头条'))
    const candidatePlatformId = platformOption?.id || ''
    setCollectError('')
    // 2026-10-23：本次修改原因：清除上一次全文错误，并在增长榜已有可用内容时直接填入待核对表单。
    setError('')
    // 2026-10-23：本次修改原因：双击任一候选都在下方打开其专属预填表单，缺链接时也能补录。
    setFormOrigin('candidate')
    setPreviewUrl(candidate.url || candidate.id)
    // setPlatformId('platform_01') // 2026-10-23：原公众号固定平台预选暂留供对照。
    setPlatformId(candidatePlatformId)
    setTitle(candidate.title)
    setAuthorId(candidate.author || '')
    setPublishedAt(candidate.published_at?.match(/^\d{4}-\d{2}-\d{2}/)?.[0] ?? '')
    setSourceUrl(candidate.url)
    setBody(candidate.body_text || '')
    setRightsConfirmed(false)
    setMessage('')
    setFormatId('')
    setAccountFollowers('')
    setAudienceId('')
    setTopic('')
    setTags('')
    setUsageRightsNote('')
    setReviewStatus('pending')
    // 2026-10-23：本次修改原因：保留 RedFox 返回时的指标快照，不将未返回或近似读数补零。
    setMetricSource(`RedFox · ${collectResult?.source ?? '候选'}`)
    setCandidateMetrics({ reads: exactCount(candidate.read_count), likes: exactCount(candidate.like_count),
      comments: exactCount(candidate.comment_count), shares: exactCount(candidate.share_count) })
    // 2026-10-23：本次修改原因：双击时先展示预填表单，网络取文随后更新正文。
    openSampleForm()
    try {
      if (candidate.body_text && candidate.body_text.length >= 200) {
        // setPlatformId('platform_01') // 2026-10-23：原公众号固定平台预选暂留供对照。
        setPlatformId(candidatePlatformId)
        setTitle(candidate.title)
        // 2026-10-23：本次修改原因：榜单提供的作者与日期作为待核对预填值，不自动视为已审核。
        setAuthorId(candidate.author || '')
        setPublishedAt(candidate.published_at?.match(/^\d{4}-\d{2}-\d{2}/)?.[0] ?? '')
        setSourceUrl(candidate.url)
        setBody(candidate.body_text)
        setRightsConfirmed(false)
        // 2026-10-23：本次修改原因：增长榜内容被样本字段上限截断时要求编辑核对并补齐。
        // setMessage(candidate.body_truncated ? '增长榜内容超过 30000 字，已截断填入；请打开原文核对并补齐，再确认使用权限。' : '增长榜返回了文章内容，已填入表单；请打开原文核对是否完整，再确认使用权限。') // 2026-10-23：原长提示留作对照。
        // 2026-10-23：本次修改原因：正文状态只说明需要核对或补齐的具体原因。
        setMessage(candidate.body_truncated ? '正文已截断，请核对补齐。' : '正文已预填，请核对原文。')
        // document.getElementById('sample-import-form')?.scrollIntoView({ behavior: 'smooth', block: 'start' }) // 2026-10-23：原滚动逻辑暂留供对照。
        // 2026-10-23：本次修改原因：榜单提供正文时先展开表单，再定位到待核对内容。
        // openSampleForm() // 2026-10-23：表单已在双击候选时展开，无需取文完成后再次滚动。
        return
      }
      // 2026-10-23：本次修改原因：无原文链接的候选仍可带入已知内容，供编辑手动补全。
      if (!candidate.url) {
        // setPlatformId('platform_01') // 2026-10-23：原公众号固定平台预选暂留供对照。
        setPlatformId(candidatePlatformId)
        setTitle(candidate.title)
        setAuthorId(candidate.author || '')
        setPublishedAt(candidate.published_at?.match(/^\d{4}-\d{2}-\d{2}/)?.[0] ?? '')
        setSourceUrl('')
        setBody(candidate.body_text || '')
        setRightsConfirmed(false)
        setError('该候选没有原文链接，请核对来源并手动补全正文。')
        setMessage('')
        // openSampleForm() // 2026-10-23：表单已在双击候选时展开，无需重复滚动。
        return
      }
      // 2026-10-23：本次修改原因：候选卡片直接请求后端的 DeepSeek Fetch，保留原文链接供人工核对。
      // 2026-10-23：本次修改原因：同一按钮改由后端启动浏览器取文，编辑仍在本页核对并入库。
      // 2026-10-23：本次修改原因：公众号浏览器取文只处理微信链接；其他平台先预填来源，正文由编辑核对补入。
      if (sourcePlatform !== 'wechat') {
        setMessage('请核对原文并补入正文。')
        return
      }
      const detail = await getRedFoxWechatArticle(candidate.url)
      if (requestId !== previewRequest.current) return
      // setPlatformId('platform_01') // 2026-10-23：候选双击时已预填，取文完成不覆盖编辑修改。
      // 2026-10-23：本次修改原因：等待正文时若编辑已修改标题或正文，不覆盖其输入。
      setTitle((current) => current === candidate.title ? (detail.title || candidate.title) : current)
      // setAuthorId(candidate.author || '') // 2026-10-23：候选双击时已预填，保留编辑修改。
      // setPublishedAt(candidate.published_at?.match(/^\d{4}-\d{2}-\d{2}/)?.[0] ?? '') // 2026-10-23：候选双击时已预填。
      // setSourceUrl(candidate.url) // 2026-10-23：候选双击时已预填。
      setBody((current) => current === (candidate.body_text || '') ? detail.body_text : current)
      // setRightsConfirmed(false) // 2026-10-23：等待取文期间已确认权限时不反复重置。
      // setMessage(detail.body_available ? '已填入文章正文，请核对内容、分类和使用权限后再保存样本。' : '详情已返回，但未识别出正文字段；请在来源文章核对后手动粘贴可用的正文。') // 2026-10-23：原提示逻辑暂留供对照。
      // 2026-10-23：本次修改原因：全文超过样本字段上限时明确告知编辑已截断。
      // setMessage(detail.truncated ? '正文超过 30000 字，已截断填入。请核对内容、分类和使用权限后再保存样本。' : detail.body_available ? '已填入文章正文，请核对内容、分类和使用权限后再保存样本。' : '详情已返回，但未识别出正文字段；请在来源文章核对后手动粘贴可用的正文。') // 2026-10-23：原提示保留供对照。
      // 2026-10-23：本次修改原因：展示正文来源及标题不一致风险，保存前要求人工核对。
      // setMessage(`${detail.origin === 'deepseek_fetch' ? 'DeepSeek 已抓取正文' : '公开原文页已读取正文'}；${detail.truncated ? '内容超过 30000 字，已截断；' : ''}${detail.title && !detail.title.includes(candidate.title) && !candidate.title.includes(detail.title) ? '抓取标题与榜单标题不同，请仔细核对；' : ''}请核对正文完整性、分类和使用权限后保存样本。`) // 2026-10-23：原来源提示保留供对照。
      // 2026-10-23：本次修改原因：向编辑说明正文来自浏览器还是公开页备用读取。
      // setMessage(`${detail.origin === 'playwright_browser' ? '浏览器已提取正文' : '公开原文页已读取正文'}；${detail.truncated ? '内容超过 30000 字，已截断；' : ''}${detail.title && !detail.title.includes(candidate.title) && !candidate.title.includes(detail.title) ? '抓取标题与榜单标题不同，请仔细核对；' : ''}请核对正文完整性、分类和使用权限后保存样本。`) // 2026-10-23：原长提示留作对照。
      // 2026-10-23：本次修改原因：取文后只反馈完成状态和必须注意的异常。
      setMessage(`正文已获取，请核对原文。${detail.truncated ? ' 内容已截断，请补齐。' : ''}${detail.title && !detail.title.includes(candidate.title) && !candidate.title.includes(detail.title) ? ' 抓取标题与榜单不同。' : ''}`)
      // document.getElementById('sample-import-form')?.scrollIntoView({ behavior: 'smooth', block: 'start' }) // 2026-10-23：原滚动逻辑暂留供对照。
      // 2026-10-23：本次修改原因：浏览器取文成功后显式展开录入表单。
      // openSampleForm() // 2026-10-23：取文成功时只更新已展开的表单。
    } catch (reason) {
      if (requestId !== previewRequest.current) return
      // setCollectError(reason instanceof Error ? reason.message : '文章详情获取失败') // 2026-10-23：原仅报错的回退暂留供对照。
      // 2026-10-23：本次修改原因：全文不可得时保留已知元数据，避免重新填写标题和链接。
      // setPlatformId('platform_01'); setTitle(candidate.title); setAuthorId(candidate.author || ''); setPublishedAt(candidate.published_at?.match(/^\d{4}-\d{2}-\d{2}/)?.[0] ?? ''); setSourceUrl(candidate.url); setBody(''); setRightsConfirmed(false) // 2026-10-23：双击时已预填，取文失败不清空编辑修改。
      // setCollectError(reason instanceof Error ? reason.message : '文章详情获取失败') // 2026-10-23：原两处同时报错的处理保留供对照。
      // 2026-10-23：本次修改原因：取文错误随预填表单展示一次，避免候选区和录入区重复报错。
      // 2026-10-23：本次修改原因：滚动至手动表单后仍能看见具体接口错误，不再只有“全文未取得”通用文案。
      setError(reason instanceof Error ? reason.message : '文章详情获取失败')
      // setMessage('全文未取得。已填写标题和链接；可从原文补入正文，保存后在内容策略页选样提炼。') // 2026-10-23：原失败说明误用绿色成功样式，暂留供对照。
      // 2026-10-23：本次修改原因：失败信息统一显示为红色，不再把未取得正文标成成功。
      setMessage('')
      // document.getElementById('sample-import-form')?.scrollIntoView({ behavior: 'smooth', block: 'start' }) // 2026-10-23：原滚动逻辑暂留供对照。
      // 2026-10-23：本次修改原因：取文失败时直接展示已预填的标题和链接供人工补正文。
      // openSampleForm() // 2026-10-23：取文失败时保留已展开表单供手动补录。
    } finally {
      if (requestId === previewRequest.current) setPreviewUrl('')
    }
  }

  // 2026-10-23：本次修改原因：不要求用户手填标题、链接、正文，直接从搜索结果创建策略草稿。
  // 2026-10-23：原样本库直接提炼逻辑暂留供对照。
  // async function analyzeCandidate(candidate: RedFoxCandidate) {
  //   setCollectError('')
  //   setAnalysisResult(null)
  //   setAnalysisUrl(candidate.url)
  //   try {
  //     const strategy = await analyzeRedFoxWechatArticle({
  //       url: candidate.url, title: candidate.title,
  //       category_id: categoryId, format_id: formatId || null,
  //     })
  //     setAnalysisResult(strategy)
  //   } catch (reason) {
  //     setCollectError(reason instanceof Error ? reason.message : '文章写法分析失败')
  //   } finally {
  //     setAnalysisUrl('')
  //   }
  // }

  // 2026-10-23：本次修改原因：样本库只移交候选元数据，进入策略页后再请求正文和提炼。
  /* 2026-10-23：本次修改原因：样本库负责采集和入库；原候选直达策略流程暂留供对照。
  function sendToStrategies(candidate: RedFoxCandidate) {
    // if (!categoryId) return // 2026-10-23：原条件保留供对照。
    // 2026-10-23：本次修改原因：缺少原文链接或标题时不发起无法完成的策略提炼。
    if (!categoryId || !candidate.url || !candidate.title) return
    sessionStorage.setItem('ai4geo.strategyCandidate', JSON.stringify({
      url: candidate.url, title: candidate.title,
      category_id: categoryId, format_id: formatId || null,
    }))
    window.location.hash = '#/strategies'
  }
  */

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError('')
    setMessage('')
    setBusy(true)
    try {
      // const saved = await addSample({ title: title.trim(), body_text: body.trim(), platform_id: platformId, category_id: categoryId, format_id: formatId || null, source_url: sourceUrl.trim() || null, quality_score: qualityScore, rights_confirmed: rightsConfirmed }) // 2026-10-23：旧入库请求保留供对照。
      // 2026-10-23：本次修改原因：新页面原文和元数据一次提交；旧页面模式仍沿用原 API。
      const base = { title: title.trim(), body_text: body.trim(), platform_id: platformId,
        category_id: categoryId, format_id: formatId || null, source_url: sourceUrl.trim() || null,
        quality_score: qualityScore, rights_confirmed: rightsConfirmed }
      const saved = mode === 'discovery'
        ? await createLibraryArticle({ ...base, author_id: authorId.trim() || null,
          account_followers: accountFollowers === '' ? null : Number(accountFollowers),
          published_at: publishedAt || null, audience_id: audienceId || null,
          topic: topic.trim() || null, tags: tags.split(/[、,，]/).map((item) => item.trim()).filter(Boolean),
          usage_rights_note: usageRightsNote.trim() || null, review_status: reviewStatus,
          initial_metric: Object.values(candidateMetrics).some((value) => value !== '') ? {
            source: metricSource, reads: candidateMetrics.reads === '' ? null : Number(candidateMetrics.reads),
            likes: candidateMetrics.likes === '' ? null : Number(candidateMetrics.likes),
            comments: candidateMetrics.comments === '' ? null : Number(candidateMetrics.comments),
            shares: candidateMetrics.shares === '' ? null : Number(candidateMetrics.shares),
          } : null })
        : await addSample(base)
      setSamples((current) => [saved, ...current])
      setTitle('')
      setBody('')
      setSourceUrl('')
      setRightsConfirmed(false)
      setAuthorId('')
      setAccountFollowers('')
      setPublishedAt('')
      setAudienceId('')
      setTopic('')
      setTags('')
      setUsageRightsNote('')
      setReviewStatus('ready')
      setMetricSource('人工录入')
      setCandidateMetrics({ reads: '', likes: '', comments: '', shares: '' })
      // setMessage('样本已加入库中。现在可以在“内容策略”中使用它。') // 2026-10-23：原提示保留供对照。
      // 2026-10-23：本次修改原因：明确从已入库样本进入策略提取的下一步。
      setMessage('样本已保存。请到“内容策略”页勾选它，与其他样本一起提炼写法。')
      // 2026-10-23：本次修改原因：保存成功后返回统一文章库继续复核。
      onSaved?.()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '样本保存失败')
    } finally {
      setBusy(false)
    }
  }

  // 2026-10-24：本次修改原因：状态筛选只作用于当前已取得的一页，避免为筛选额外调用 RedFox。
  const isCollected = (candidate: RedFoxCandidate) =>
    Boolean(candidate.collected || collectedIds.includes(candidateKey(candidate, collectPlatform)))
  const pageCandidates = (collectResult?.items || []).filter((candidate) =>
    statusFilter === 'all' || (statusFilter === 'collected' ? isCollected(candidate)
      : candidate.kind === 'article' && !isCollected(candidate)))
  const selectablePage = pageCandidates.filter((candidate) => candidate.kind === 'article' && !isCollected(candidate))
  const selectedEntries = Object.entries(selectedCandidates).filter(([, candidate]) => !isCollected(candidate))
  // const readyEntries = selectedEntries.filter(([key]) => draftMissing(candidateDrafts[key]).length === 0) // 2026-10-24：原未拦截截断正文的预检留作对照。
  // 2026-10-24：本次修改原因：统一类目和权限选择后立即更新可收录数量。
  const readyEntries = selectedEntries.filter(([key, candidate]) =>
    candidateMissing(candidate, batchCandidateValue(key, candidate)).length === 0)
  const allPageSelected = selectablePage.length > 0 && selectablePage.every((candidate) =>
    Boolean(selectedCandidates[candidateKey(candidate, collectPlatform)]))

  // 2026-10-24：本次修改原因：只选择本页未收录文章，已选文章跨页保留。
  function toggleCandidate(candidate: RedFoxCandidate) {
    const key = candidateKey(candidate, collectPlatform)
    setSelectedCandidates((current) => {
      const next = { ...current }
      if (next[key]) delete next[key]
      else next[key] = candidate
      return next
    })
  }

  function toggleCurrentPage() {
    setSelectedCandidates((current) => {
      const next = { ...current }
      selectablePage.forEach((candidate) => {
        const key = candidateKey(candidate, collectPlatform)
        if (allPageSelected) delete next[key]
        else next[key] = candidate
      })
      return next
    })
  }

  // 2026-10-24：本次修改原因：批量预检发现缺项时回到同一篇的核对弹窗，关闭后继续批量处理。
  function reviewBatchCandidate(candidate: RedFoxCandidate) {
    setBatchOpen(false)
    setReturnToBatch(true)
    collectCandidate(candidate)
  }

  /* 2026-10-24：原 collectReadyDrafts 只接收已逐篇暂存的草稿，选中 RedFox 候选无法一键进入预检和收录，留作对照。 */
  // 2026-10-24：本次修改原因：一键核对和一键收录共用候选预填、缺项检查与草稿暂存。
  async function prepareSelected(): Promise<[string, RedFoxCandidate, ArticleEditorValue][]> {
    const ready: [string, RedFoxCandidate, ArticleEditorValue][] = []
    for (const [index, [key, candidate]] of selectedEntries.entries()) {
      setBatchProgress(`正在核对字段 ${index + 1}/${selectedEntries.length}：${candidate.title}`)
      /* 2026-10-24：原核对阶段独立补入类目和权限的映射留作对照。
      const prior = candidateDrafts[key] || candidateEditorValue(candidate, key)
      const value: ArticleEditorValue = { ...prior,
        category_id: prior.category_id || batchCategoryId,
        rights_confirmed: prior.rights_confirmed || batchRightsConfirmed,
        source_data: { ...prior.source_data, candidate_key: key } }
      */
      // 2026-10-24：本次修改原因：预检结果与弹窗实时计数遵循同一映射。
      const value = batchCandidateValue(key, candidate)
      try {
        await saveCandidateDraft(key, value)
        setCandidateDrafts((current) => ({ ...current, [key]: value }))
        if (candidateMissing(candidate, value).length === 0) ready.push([key, candidate, value])
      } catch (reason) {
        setBatchResults((current) => [...current, { key, title: candidate.title,
          error: reason instanceof Error ? reason.message : '核对暂存失败' }])
      }
    }
    setBatchReviewMessage(`字段检查完成：可收录 ${ready.length} 篇，待补齐 ${selectedEntries.length - ready.length} 篇。`)
    setBatchProgress('')
    return ready
  }

  // 2026-10-24：本次修改原因：单次点击检查全部选中候选的字段并标出缺项，不请求 RedFox 详情。
  async function reviewSelected() {
    if (!selectedEntries.length || batchBusy) return
    setBatchBusy(true); setBatchResults([]); setBatchReviewMessage('')
    try { await prepareSelected() }
    finally { setBatchProgress(''); setBatchBusy(false) }
  }

  // 2026-10-24：本次修改原因：一键收录先执行相同预检，仅提交完整且权限已明确确认的文章。
  async function collectReadyDrafts() {
    if (!selectedEntries.length || batchBusy) return
    setBatchBusy(true); setBatchResults([]); setBatchReviewMessage('')
    let succeeded = 0
    let attempted = 0
    try {
      const ready = await prepareSelected()
      attempted = ready.length
      for (const [index, [key, candidate, value]] of ready.entries()) {
        setBatchProgress(`正在收录 ${index + 1}/${ready.length}：${candidate.title}`)
        try {
          const payload = editorPayload(value, true)
          payload.source_data = { ...(payload.source_data as Record<string, unknown>), candidate_key: key }
          await createLibraryArticle(payload)
          succeeded += 1
          setCollectedIds((current) => current.includes(key) ? current : [...current, key])
          setSelectedCandidates((current) => { const next = { ...current }; delete next[key]; return next })
          setCandidateDrafts((current) => { const next = { ...current }; delete next[key]; return next })
          try { await deleteCandidateDraft(key) } catch { /* 已入库成功，草稿清理失败不影响收录结果。 */ }
          setBatchResults((current) => [...current, { key, title: candidate.title, error: '' }])
        } catch (reason) {
          setBatchResults((current) => [...current, { key, title: candidate.title,
            error: reason instanceof Error ? reason.message : '收录失败' }])
        }
      }
    } finally {
      setBatchProgress(''); setBatchBusy(false)
      // 2026-10-24：本次修改原因：批量结束时显示实际成功、失败和待补齐数量，不保留过时的预检数字。
      setBatchReviewMessage(`收录完成：成功 ${succeeded} 篇，失败 ${attempted - succeeded} 篇，待补齐 ${selectedEntries.length - attempted} 篇。`)
      if (succeeded) onSaved?.()
    }
  }

  // 2026-10-24：本次修改原因：从批量清单进入单篇核对后，关闭弹窗仍返回原清单。
  function closeEditor() {
    setEditor(null)
    if (returnToBatch) { setBatchOpen(true); setReturnToBatch(false) }
  }

  const filtered = samples.filter((item) =>
    (!filterPlatform || item.platform_id === filterPlatform) &&
    (!query.trim() || [item.title, item.body_text, label(item.category_id)].some((value) =>
      value.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())))
  )

  return <>
    {/* 2026-10-23：本次修改原因：新版文章库自身提供页面标题，嵌入采集区不重复显示。 */}
    {mode === 'legacy' && <div className="pageHeading">
      {/* <div><p className="kicker">LIBRARY / 样本库</p><h1>把好内容沉淀为可用样本</h1> 2026-10-23：原装饰性页眉保留供对照。 */}
      {/* 2026-10-23：本次修改原因：用模块名称作为稳定页面标题。 */}
      <div><h1>样本库</h1>
        <p>记录平台、领域和质量判断，让策略提炼有可追溯的依据。</p></div>
      {/* <span className="headingIndex">02 / 04</span> 2026-10-23：原四页编号暂留供对照。 */}
      {/* 2026-10-23：本次修改原因：导航增加品牌库，更新页面总数。 */}
      <span className="headingIndex">02 / 05</span>
    </div>}
    {mode === 'legacy' && <div className="infoBanner"><span className="bannerIcon">i</span>
      {/* 当前支持录入已确认使用权限的文章。自动采集需按各平台的数据接口与授权范围单独接入。 2026-10-23：原提示暂留供对照。 */}
      {/* 公众号接口搜索结果仅作候选参考；取得全文不会自动入库，保存样本前仍需确认使用权限。 2026-10-23：原仅搜索说明保留供对照。 */}
      {/* 2026-10-23：本次修改原因：榜单与关键词结果都只作为候选，不在查询时自动保存样本。 */}
      公众号榜单和关键词结果仅作候选参考；取得内容不会自动入库，保存样本前仍需核对原文与使用权限。
    </div>}
    {/* 2026-10-23：本次修改原因：在样本库首屏提供限量搜索、候选预览和清晰的下一步操作。 */}
    <section className="card redfoxPilot">
      {/* <div className="sectionHeading"><div><span className="stepTag teal">试</span><h2>公众号候选采集</h2></div> 2026-10-23：原试验标记保留供对照。 */}
      {/* 2026-10-23：本次修改原因：采集入口名称直接描述操作，弱化装饰性标记。 */}
      {/* <div className="sectionHeading"><div><h2>发现公众号文章</h2></div>{mode === 'discovery' && <button className="secondaryButton" type="button" onClick={openSampleForm}>{showSampleForm ? '查看录入表单' : '手动录入样本'}</button>}<span className="externalCost">RedFox 查询可能计费</span></div> 2026-10-23：原重复标题、表单入口和常驻费用说明留作对照。 */}
      {/* 2026-10-23：本次修改原因：发现视图由查询控件直接说明用途，旧独立页面仍保留标题。 */}
      {/* {mode === 'legacy' && <div className="sectionHeading"><div><h2>发现公众号文章</h2></div></div>} 2026-10-23：原公众号标题暂留供对照。 */}
      {/* 2026-10-23：本次修改原因：旧页面标题与新增的六平台采集范围一致。 */}
      {mode === 'legacy' && <div className="sectionHeading"><div><h2>发现参考文章</h2></div></div>}
        {/* <p>RedFox · 近 7 天 · 最多 10 篇 / 次</p> 2026-10-23：原提示暂留供对照。 */}
        {/* <p>RedFox · 近 7 天 · 最多 10 篇 / 次 · 搜索与取全文均按接口计费</p> 2026-10-23：原提示暂留供对照。 */}
        {/* <p>RedFox · 近 7 天热门文章（文档标注阅读量 5000+）· 最多 10 篇 / 次 · 按接口计费</p> 2026-10-23：原固定来源说明暂留供对照。 */}
        {/* 2026-10-23：本次修改原因：按搜索来源展示实际数据范围。 */}
        {/* <p>RedFox · 每次最多显示 10 篇候选 · 搜索与取全文可能计费</p> 2026-10-23：原统一数量说明保留供对照。 */}
        {/* 2026-10-23：本次修改原因：榜单显示上限为 20 篇，关键词搜索仍沿用原上限。 */}
        {/* <p>RedFox · {collectMode === 'quality' || collectMode === 'hot' ? '关键词最多显示 10 篇' : '榜单最多显示 20 篇'} · 查询与取全文可能计费</p> 2026-10-23：原长说明保留供对照。 */}
        {/* 2026-10-23：本次修改原因：外部查询费用保留为精简的可见提示。 */}
        {/* <span className="externalCost">RedFox 查询可能计费</span> 2026-10-23：原常驻费用提示留作对照。 */}
      {/* <form className="redfoxSearch" onSubmit={searchCandidates}> 2026-10-23：原二项关键词表单保留供对照。 */}
      {/* 2026-10-23：本次修改原因：采集方式决定表单字段，避免榜单用户被要求填写无关关键词。 */}
      <form className="redfoxSearch redfoxCollectForm" onSubmit={searchCandidates}>
        {/* <label className="field"><span>搜索关键词</span><input value={collectKeyword} onChange={(event) => setCollectKeyword(event.target.value)} minLength={2} maxLength={80} required placeholder="例如：久坐健康、职场沟通" /></label> 2026-10-23：原关键词固定显示保留供对照。 */}
        {/* 2026-10-23：本次修改原因：先选平台，再展示该平台实际可用的采集方式。 */}
        <label className="field"><span>目标平台</span><select value={collectPlatform} onChange={(event) => {
          const next = event.target.value as CollectPlatform
          setCollectPlatform(next)
          setCollectMode(COLLECT_METHODS[next][0].value)
          setCollectResult(null)
          setCollectError('')
        }}><option value="wechat">公众号</option><option value="xiaohongshu">小红书</option>
          <option value="baijiahao">百家号</option><option value="toutiao">今日头条</option>
          <option value="multi">多平台</option><option value="zhihu">知乎</option></select></label>
        <label className="field"><span>采集方式</span><select value={collectMode} onChange={(event) => {
          setCollectMode(event.target.value as CollectMode)
          setCollectResult(null)
          setCollectError('')
        }}>
          {/* <option value="ten_w">10W+ 文章</option><option value="original">原创爆款文章</option> 2026-10-23：原固定公众号方式保留供对照。 */}
          {/* <option value="growth">阅读增长榜</option><option value="quality">优质库关键词</option> 2026-10-23：原选项行保留供对照。 */}
          {/* 2026-10-23：本次修改原因：接口没有类目筛选，直接在选项名称中说明。 */}
          {/* <option value="growth">阅读增长榜（无类目筛选）</option><option value="quality">优质库关键词</option><option value="hot">近期热门关键词</option> 2026-10-23：原固定公众号方式保留供对照。 */}
          {COLLECT_METHODS[collectPlatform].map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
        </select></label>
        {/* 2026-10-23：本次修改原因：区分可尝试获取全文的优质库与选题发现用的热门库。 */}
        {/* <label className="field"><span>搜索来源</span><select value={searchSource} onChange={(event) => setSearchSource(event.target.value as 'quality' | 'hot')}><option value="quality">公众号作品优质库</option><option value="hot">近期热门文章</option></select></label> 2026-10-23：原来源选择保留供对照。 */}
        {/* 2026-10-23：本次修改原因：关键词、分类和日期字段仅在对应接口需要时出现。 */}
        {/* {(collectMode === 'quality' || collectMode === 'hot') && <label className="field"><span>搜索关键词</span>...</label>} 2026-10-23：原公众号关键词条件暂留供对照。 */}
        {collectMode === 'keyword' && <label className="field"><span>关键词</span>
          <input value={collectKeyword} onChange={(event) => setCollectKeyword(event.target.value)}
            minLength={2} maxLength={80} required placeholder="例如：久坐健康、职场沟通" /></label>}
        {(collectPlatform === 'wechat' && (collectMode === 'ten_w' || collectMode === 'original')) && <>
          <label className="field"><span>榜单类目</span><select value={rankCategory} onChange={(event) => setRankCategory(event.target.value)}>
            {RANK_CATEGORIES.map((item) => <option key={item} value={item}>{item}</option>)}
          </select></label>
          {/* <label className="field"><span>开始日期</span><input type="date" value={rankStartDate} max={rankEndDate} onChange={(event) => setRankStartDate(event.target.value)} required /></label><label className="field"><span>结束日期</span><input type="date" value={rankEndDate} min={rankStartDate} onChange={(event) => setRankEndDate(event.target.value)} required /></label> 2026-10-23：原分开的日期输入暂留供对照。 */}
        </>}
        {/* 2026-10-23：本次修改原因：小红书三个榜单使用各自支持的单日类目条件。 */}
        {collectPlatform === 'xiaohongshu' && <>
          <label className="field"><span>榜单类目</span><select value={xhsCategory} onChange={(event) => setXhsCategory(event.target.value)}>
            {XHS_CATEGORIES.map((item) => <option key={item}>{item}</option>)}</select></label>
          <label className="field"><span>榜单日期</span><input type="date" value={rankDate} max={localDateOffset(0)}
            onChange={(event) => setRankDate(event.target.value)} required /></label>
        </>}
        {/* 2026-10-23：本次修改原因：全网热点榜必须指明要查看哪个平台，避免隐式查询多次。 */}
        {collectPlatform === 'multi' && collectMode === 'hotspot' && <label className="field"><span>热点平台</span>
          <select value={hotspotPlatform} onChange={(event) => setHotspotPlatform(event.target.value)}>
            {HOTSPOT_PLATFORMS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select></label>}
        {/* 2026-10-23：本次修改原因：范围先在弹层编辑，确定后再作为查询参数。 */}
        {((collectPlatform === 'wechat' && collectMode !== 'keyword') || collectPlatform === 'multi' ||
          (collectPlatform === 'zhihu' && collectMode === 'hotspot')) && <div className="field dateRangeField"><span>日期范围</span>
            {collectPlatform === 'multi' && collectMode === 'top10'
              ? <DateRangePicker start={topStart} end={topEnd} withTime onConfirm={(start, end) => { setTopStart(start); setTopEnd(end) }} />
              : <DateRangePicker start={rankStartDate} end={rankEndDate} requireDifferentDays={collectPlatform === 'wechat'}
                  onConfirm={(start, end) => { setRankStartDate(start); setRankEndDate(end) }} />}
          </div>}
        {/* 2026-10-23：本次修改原因：查询和手动录入作为一组始终相邻，窄屏时一起换行。 */}
        <div className="libraryDiscoveryActions">
          <button className="primaryButton" type="submit" disabled={collectBusy || !redfoxConfigured}>
            {/* {collectBusy ? '正在搜索…' : '搜索候选文章'} 2026-10-23：原按钮文案保留供对照。 */}
            {/* {collectBusy ? '正在查询…' : (collectMode === 'quality' || collectMode === 'hot' ? '搜索候选文章' : '查询榜单')} 2026-10-23：原公众号分支文案暂留供对照。 */}
            {collectBusy ? '正在查询…' : collectMode === 'keyword' ? '搜索候选' : '查询榜单'}</button>
          {/* 2026-10-23：本次修改原因：手动录入紧邻查询操作，点击后在下方展开空白表单。 */}
          {mode === 'discovery' && <button className="secondaryButton" type="button"
            onClick={openManualDialog}>手动录入</button>}
        </div>
      </form>
      {/* 2026-10-23：本次修改原因：提前说明增长榜是账号榜且未提供类目过滤，避免误解采集范围。 */}
      {/* {collectMode === 'growth' && <p className="redfoxModeNote">阅读增长榜按公众号增长率排序，展示账号的最高、最低阅读文章；RedFox 接口没有类目筛选。</p>} 2026-10-23：旧增长榜已不在目标平台采集方式中，原说明暂留供对照。 */}
      {/* {(collectMode === 'ten_w' || collectMode === 'original') && <p className="redfoxModeNote">榜单返回的是数据快照；摘要不等于全文。选中文章后可单独尝试取全文。</p>} 2026-10-24：原二次取全文说明已不符合直接收录流程，留作对照。 */}
      {/* 2026-10-23：本次修改原因：分析前明确策略适用的类目与内容形式。 */}
      {/* <div className="analysisScope"> 2026-10-23：原策略适用范围表单暂留供对照。 */}
      {/* 2026-10-23：本次修改原因：此处只记录候选类目；策略适用范围与选样由策略页负责。 */}
      {/* 2026-10-23：本次修改原因：候选发现只负责找文章，分类统一在展开的样本录入表单中完成。 */}
      {/* <div className="analysisScope">
        <label className="field"><span>候选内容类目</span><select value={categoryId} onChange={(event) => setCategoryId(event.target.value)}>
          {active('category').map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
        </select></label>
        <label className="field"><span>候选内容形式</span><select value={formatId} onChange={(event) => setFormatId(event.target.value)}>
          <option value="">形式通用</option>
          {active('format').map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
        </select></label>
      </div> */}
      {redfoxConfigured === false && <p className="alert error">先在 backend/.env 配置 REDFOX_API_KEY，然后重启后端。</p>}
      {collectError && <p className="alert error" role="alert">{collectError}</p>}
      {collectResult && <>
        {/* <p className="redfoxSummary">{collectResult.start_date} 至 {collectResult.end_date} · 找到 {collectResult.items.length} 篇可预览候选。阅读量是 RedFox 入库时的数据，仅供筛选参考。</p> 2026-10-23：原仅热门库摘要暂留供对照。 */}
        {/* 2026-10-23：本次修改原因：优质库没有固定七日窗口，阅读数为第三方返回值。 */}
        {/* <p className="redfoxSummary">{collectResult.source === 'hot' ? `${collectResult.start_date} 至 ${collectResult.end_date} · 近期热门` : '公众号作品优质库'} · 找到 {collectResult.items.length} 篇候选。阅读数仅供参考。</p> 2026-10-23：原两种搜索结果说明保留供对照。 */}
        {/* 2026-10-23：本次修改原因：准确标记榜单类型、返回账号或文章数量与快照性质。 */}
        {/* <p className="redfoxSummary">{({ quality: '公众号作品优质库', hot: '近期热门文章', ten_w: '10W+ 文章榜', original: '原创爆款文章榜', growth: '公众号阅读增长榜' } as const)[collectResult.source]}...</p> 2026-10-23：原公众号汇总暂留供对照。 */}
        {/* 2026-10-23：本次修改原因：结果栏只显示平台、方式、范围和数量。 */}
        {/* <p className="redfoxSummary">{PLATFORM_LABELS[(collectResult.platform || 'wechat') as CollectPlatform]} · {SOURCE_LABELS[collectResult.source]} · {collectResult.category} · {collectResult.start_date} 至 {collectResult.end_date} · 共 {collectResult.total_count} 条。</p> 2026-10-24：原查询说明行暂留供对照。 */}
        {/* 2026-10-24：本次修改原因：原说明行改为本页选择、跨页已选数、批量入口和本页状态筛选。 */}
        {/* 2026-10-24：本次修改原因：旧页面模式仍使用原单篇入口，批量栏只出现在发现与录入视图。 */}
        {mode === 'discovery' && !collectResult.items.some((item) => item.kind === 'topic') && <div className="libraryCandidateToolbar"
          aria-label={`${PLATFORM_LABELS[(collectResult.platform || 'wechat') as CollectPlatform]} ${SOURCE_LABELS[collectResult.source]}候选操作`}>
          <div className="libraryCandidateSelection"><label><input type="checkbox" checked={allPageSelected}
            disabled={selectablePage.length === 0} onChange={toggleCurrentPage} />全选本页未收录</label>
            <strong>已选 {selectedEntries.length} 篇</strong>
            <button type="button" className="primaryButton" disabled={selectedEntries.length === 0}
              onClick={() => { setBatchResults([]); setBatchReviewMessage(''); setBatchOpen(true) }}>批量收录</button></div>
          <div className="libraryStatusFilter" role="group" aria-label="本页收录状态筛选"><span>本页显示</span>
            {([['all', '全部'], ['uncollected', '未收录'], ['collected', '已收录']] as const).map(([value, label]) =>
              <button key={value} type="button" className={statusFilter === value ? 'active' : ''}
                aria-pressed={statusFilter === value} onClick={() => setStatusFilter(value)}>{label}</button>)}</div>
        </div>}
        {/* 2026-10-23：本次修改原因：部分条目未返回时保留已取得文章，同时就地显示缺失说明。 */}
        {collectResult.warnings?.map((warning) => <p className="alert warning" role="status" key={warning}>{warning}</p>)}
        {/* {collectResult.items.length === 0 ? <div className="emptyState"><h3>没有匹配的候选文章</h3><p>可尝试更具体的关键词。</p></div> : 2026-10-23：原统一空状态保留供对照。 */}
        {/* 2026-10-23：本次修改原因：候选条目双击直接预填下方表单，回车也可完成同一操作。 */}
        {/* {collectResult.items.length === 0 ? <div className="emptyState"><h3>本次没有可显示的文章</h3>...</div> : ...} 2026-10-23：原公众号空状态暂留供对照。 */}
        {/* {collectResult.items.length === 0 ? <div className="emptyState"><h3>暂无结果</h3></div> : <div className="redfoxResults">{collectResult.items.map((candidate) => candidate)}</div>} 2026-10-24：原不按状态筛选的列表入口留作对照。 */}
        {/* className={`redfoxItem${candidate.kind === 'topic' ? ' redfoxTopic' : ''}${candidate.collected || collectedIds.includes(`${candidate.platform || collectPlatform}:${candidate.id}`) ? ' redfoxCollected' : ''}`}；title/aria-label 原仅判断 candidate.collected。2026-10-24：原状态判断留作对照。 */}
        {pageCandidates.length === 0 ? <div className="emptyState"><h3>{collectResult.items.length ? '本页没有符合状态的文章' : '暂无结果'}</h3></div> :
          <div className="redfoxResults">{pageCandidates.map((candidate) => <article
            className={`redfoxItem${candidate.kind === 'topic' ? ' redfoxTopic' : ''}${isCollected(candidate) ? ' redfoxCollected' : ''}`} key={candidate.id}
            tabIndex={candidate.kind === 'topic' ? -1 : 0}
            title={candidate.kind === 'topic' ? '热点话题' : isCollected(candidate) ? '已收录' : '双击收录这篇文章'}
            aria-label={candidate.kind === 'topic' ? `热点话题：${candidate.title}` : isCollected(candidate)
              ? `已收录文章：${candidate.title}` : `候选文章：${candidate.title || '未提供标题'}。双击或按回车收录`}
            aria-busy={previewUrl === (candidate.url || candidate.id)}
            onDoubleClick={(event) => {
              // if (candidate.kind === 'topic' || previewUrl || (event.target instanceof Element && event.target.closest('a, button'))) return // 2026-10-24：原双击排除控件范围留作对照。
              // 2026-10-24：本次修改原因：点击行内复选框时不触发单篇收录弹窗。
              if (candidate.kind === 'topic' || previewUrl || (event.target instanceof Element && event.target.closest('a, button, input, label'))) return
              // void previewCandidate(candidate) // 2026-10-23：原双击展开下方表单的入口暂留供对照。
              void (mode === 'discovery' ? collectCandidate(candidate) : previewCandidate(candidate))
            }}
            onKeyDown={(event) => {
              if (candidate.kind === 'topic' || event.key !== 'Enter' || event.target !== event.currentTarget || previewUrl) return
              event.preventDefault()
              // void previewCandidate(candidate) // 2026-10-23：原回车展开下方表单的入口暂留供对照。
              void (mode === 'discovery' ? collectCandidate(candidate) : previewCandidate(candidate))
            }}>
            {/* 2026-10-24：本次修改原因：复选框紧靠文章标题，已收录和热点不进入批量选择。 */}
            {mode === 'discovery' && candidate.kind === 'article' && !isCollected(candidate) && <label className="libraryCandidateCheck"
              onClick={(event) => event.stopPropagation()} onDoubleClick={(event) => event.stopPropagation()}>
              <input type="checkbox" aria-label={`选择文章：${candidate.title}`}
                checked={Boolean(selectedCandidates[candidateKey(candidate, collectPlatform)])}
                onChange={() => toggleCandidate(candidate)} /></label>}
            {/* <div className="redfoxItemHead"><h3>{candidate.title}</h3><span>{candidate.read_count == null ? '阅读量未提供' : `阅读 ${candidate.read_count}`}</span></div> 2026-10-23：原仅显示阅读数的卡片标题保留供对照。 */}
            {/* 2026-10-23：本次修改原因：标题、阅读与互动数据逐项标出缺失状态，保留 10w+ 等原始读数。 */}
            <div className="redfoxItemHead"><h3>{candidate.title || 'RedFox 未提供标题'}</h3>
              {candidate.work_role && <span>{candidate.work_role}</span>}
              {/* 2026-10-24：本次修改原因：区分已入库、待补齐和可批量收录的草稿。 */}
              {/* 2026-10-24：本次修改原因：已收录状态由现有按钮表达，行内只标识暂存草稿的处理进度。 */}
              {mode === 'discovery' && candidate.kind === 'article' && !isCollected(candidate) &&
                candidateDrafts[candidateKey(candidate, collectPlatform)] && <span className="libraryCandidateState">
                  {candidateMissing(candidate, candidateDrafts[candidateKey(candidate, collectPlatform)]).length ? '待补齐' : '可收录'}
                </span>}</div>
            {/* 2026-10-23：本次修改原因：不同平台只展示实际返回的指标，热点话题不套用文章阅读指标。 */}
            <div className="redfoxMetrics">{candidate.kind === 'topic' && <span>热点话题</span>}
              {/* 2026-10-24：本次修改原因：账号粉丝数若由查询返回，在候选中与其他可保存读数一起核对。 */}
              {candidate.account_followers != null && <span>粉丝 {candidate.account_followers}</span>}
              {candidate.read_count != null && <span>阅读 {candidate.read_count}</span>}
              {candidate.like_count != null && <span>点赞 {candidate.like_count}</span>}
              {candidate.watch_count != null && <span>在看 {candidate.watch_count}</span>}
              {candidate.share_count != null && <span>分享 {candidate.share_count}</span>}
              {candidate.comment_count != null && <span>评论 {candidate.comment_count}</span>}
              {/* 2026-10-24：本次修改原因：发现页展示的公众号专有指标也进入保存映射。 */}
              {candidate.save_count != null && <span>收藏 {candidate.save_count}</span>}
              {candidate.reward_count != null && <span>打赏 {candidate.reward_count}</span>}
              {candidate.interactive_count != null && <span>互动量 {candidate.interactive_count}</span>}
              {candidate.growth_rate != null && <span>账号增长率 {candidate.growth_rate}%</span>}</div>
            {/* <p>{candidate.summary || '暂无摘要'}</p> 2026-10-23：原摘要提示保留供对照。 */}
            {candidate.summary && <p>{candidate.summary}</p>}
            {/* 2026-10-23：本次修改原因：榜单摘要与待核对正文明确区分，并说明缺少原文链接时的操作限制。 */}
            {['ten_w', 'original', 'growth'].includes(collectResult.source) && <p className="redfoxAvailability">
              {/* {candidate.body_truncated ? '榜单内容超过 30000 字，填写样本时会截断，需核对原文。' : candidate.body_status === 'rank_content_unverified' ? '榜单返回了文章内容，需核对原文是否完整。' : '榜单未提供可直接入库的全文，可单独尝试取全文。'} 2026-10-23：原长提示保留供对照。 */}
              {/* 2026-10-23：本次修改原因：候选卡片只呈现差异和下一步，避免每篇重复完整说明。 */}
              {candidate.body_truncated ? '正文超长，入库前请核对。'
                : candidate.body_status === 'rank_content_unverified' ? '榜单正文待核对。'
                : '未提供全文。'}
              {/* {!candidate.url && ' 原文链接缺失，无法自动取全文或送往策略提取。'} 2026-10-23：原长提示保留供对照。 */}
              {!candidate.url && ' 缺少原文链接，需手动录入。'}</p>}
            <div className="redfoxItemFoot"><span>{candidate.author || PLATFORM_LABELS[(candidate.platform || 'wechat') as CollectPlatform]}{candidate.published_at ? ` · ${candidate.published_at}` : ''}</span>
              <div>{/* <a className="textButton" href={candidate.url} target="_blank" rel="noreferrer">打开原文 ↗</a> 2026-10-23：原始链接按钮保留供对照。 */}
                {/* 2026-10-23：本次修改原因：RedFox 未给出原文链接时不渲染无效跳转。 */}
                {candidate.url && <a className="textButton" href={candidate.url} target="_blank" rel="noreferrer">打开原文 ↗</a>}
                {/* 2026-10-23：本次修改原因：文章候选可按需取文后收录，热点话题转成文章搜索词。 */}
                {mode === 'discovery' && (candidate.kind === 'topic'
                  ? <button className="secondaryButton" type="button" onClick={() => searchTopicArticles(candidate)}>查相关文章</button>
                  : <button className="secondaryButton" type="button" disabled={Boolean(previewUrl) || candidate.collected || collectedIds.includes(`${candidate.platform || collectPlatform}:${candidate.id}`)}
                    onClick={() => void collectCandidate(candidate)}>
                    {/* {candidate.collected || collectedIds.includes(`${candidate.platform || collectPlatform}:${candidate.id}`) ? '已收录' : previewUrl === (candidate.url || candidate.id) ? '正在采集…' : '收录'} 2026-10-24：原二次取文等待文案留作对照。 */}
                    {/* 2026-10-24：本次修改原因：RedFox 查询已完成，收录操作立即打开字段核对弹窗。 */}
                    {candidate.collected || collectedIds.includes(`${candidate.platform || collectPlatform}:${candidate.id}`) ? '已收录' : '收录'}</button>)}
                {/* 2026-10-23：本次修改原因：将一键分析作为候选文章的主要操作。 */}
                {/* <button className="primaryButton" type="button" disabled={Boolean(analysisUrl || previewUrl || !categoryId)} onClick={() => void analyzeCandidate(candidate)}>{analysisUrl === candidate.url ? '正在分析…' : '分析写法'}</button> 2026-10-23：原样本库内提炼按钮暂留供对照。 */}
                {/* 2026-10-23：本次修改原因：点击候选只将其交给策略页分析，职责不在样本库内。 */}
                {/* <button className="primaryButton" type="button" disabled={!categoryId} onClick={() => sendToStrategies(candidate)}>送往策略提取</button> 2026-10-23：原操作保留供对照。 */}
                {/* 2026-10-23：本次修改原因：链接或标题缺失时禁止提交无效策略任务。 */}
                {/* <button className="primaryButton" type="button" disabled={!categoryId || !candidate.url || !candidate.title} onClick={() => sendToStrategies(candidate)}>送往策略提取</button> 2026-10-23：原候选直达策略按钮保留供对照。 */}
                {/* 2026-10-23：本次修改原因：先获取并保存样本，再去策略页勾选已入库样本。 */}
                {/* <button className="secondaryButton" type="button" disabled={Boolean(previewUrl)} onClick={() => void previewCandidate(candidate)}>取全文并填写样本</button> 2026-10-23：原按钮保留供对照。 */}
                {/* <button className="secondaryButton" type="button" disabled={Boolean(previewUrl) || !candidate.url} 2026-10-23：原按钮样式保留供对照。 */}
                {/* <button className="primaryButton" type="button" disabled={Boolean(previewUrl) || !candidate.url} onClick={() => void previewCandidate(candidate)}>{previewUrl === candidate.url ? '正在获取…' : candidate.body_text ? '填写内容到样本' : '浏览器取全文并填写样本'}</button> 2026-10-23：原候选按钮改由条目双击承担，留作对照。 */}
                  {/* {previewUrl === candidate.url ? '正在获取…' : candidate.body_text ? '填写内容到样本' : 'DeepSeek 取全文并填写样本'} 2026-10-23：原按钮文案保留供对照。 */}
                  {/* 2026-10-23：本次修改原因：明确按需调用本机浏览器取得公众号正文。 */}
                </div></div>
          </article>)}</div>}
        {/* 2026-10-23：本次修改原因：候选页码来自真实查询结果，翻到旧页直接复用本地结果。 */}
        <div className="libraryPager"><button type="button" className="secondaryButton" disabled={collectBusy || candidatePage <= 1}
          onClick={() => void goCandidatePage(candidatePage - 1)}>上一页</button>
          {/* <span>第 {candidatePage} 页 · 每页 {collectResult.page_size || 10} 条</span> 2026-10-24：原分页计数留作对照。 */}
          {/* 2026-10-24：本次修改原因：查询总数移到底部分页栏，顶部留给批量操作。 */}
          <span>第 {candidatePage} 页 · 每页 {collectResult.page_size || 10} 条 · {collectResult.total_count == null
            ? `本页 ${collectResult.items.length} 条` : `共 ${collectResult.total_count} 条`}</span>
          <button type="button" className="secondaryButton" disabled={collectBusy || !collectResult.has_more}
            onClick={() => void goCandidatePage(candidatePage + 1)}>下一页</button></div>
      </>}
      {/* 2026-10-23：本次修改原因：单篇提炼只生成草稿，用户可查看规则并到策略页审核发布。 */}
      {/* 2026-10-23：原样本库内策略展示暂留供对照；详情统一在策略页查看。
      {analysisResult && <div className="analysisResult" role="status">
        <div className="sectionHeading compact"><div><span className="stepTag teal">✓</span><h2>已生成待审核策略</h2></div>
          <a className="secondaryButton" href="#/strategies">前往策略页审核 ↗</a></div>
        <p className="muted">{analysisResult.title}。以下是单篇文章推断出的写法，请核对是否适合复用，再决定是否发布。</p>
        <dl className="guideList">
          <div><dt>标题方向</dt><dd>{analysisResult.guide.title_rule}</dd></div>
          <div><dt>关键词使用</dt><dd>{analysisResult.guide.keyword_rule}</dd></div>
          <div><dt>遣词造句</dt><dd>{analysisResult.guide.language_rule}</dd></div>
          <div><dt>行文结构</dt><dd>{analysisResult.guide.structure_rule}</dd></div>
          <div><dt>应避免</dt><dd>{analysisResult.guide.avoid_rule}</dd></div>
        </dl>
      </div>} */}
    </section>
    {/* <div className="twoColumnLayout"> 2026-10-23：原始终并列显示录入表单和样本列表的布局保留供对照。 */}
    {/* 2026-10-23：本次修改原因：默认先浏览已录入样本，按需展开长表单。 */}
    {/* 2026-10-23：本次修改原因：发现页只展示录入区，不重复加载新版文章库已经显示的样本列表。 */}
    <div className={mode === 'discovery' ? 'singleColumnLayout' : showSampleForm ? 'twoColumnLayout' : 'singleColumnLayout'}>
      {/* <section className="card"> 2026-10-23：原开头暂留供对照。 */}
      {/* {showSampleForm && <section className="card" id="sample-import-form"> 2026-10-23：原发现页下方展开表单的条件暂留供对照。 */}
      {/* 2026-10-23：本次修改原因：发现页改用统一弹窗，旧表单仍供旧页面模式使用。 */}
      {/* 2026-10-24：本次修改原因：旧表单也保留 discovery 分支的可选字段，避免外层条件把 discovery 类型缩窄为 legacy。 */}
      {showSampleForm && <section className="card" id="sample-import-form">
        {/* <div className="sectionHeading"><div><span className="stepTag">01</span><h2>录入参考文章</h2></div></div> 2026-10-23：原标题保留供对照。 */}
        {/* 2026-10-23：本次修改原因：明确手动录入是可选的备用路径。 */}
        {/* <div className="sectionHeading"><div><span className="stepTag">01</span><h2>手动录入参考文章 <small>可选</small></h2></div></div> 2026-10-23：原冗余“可选”标题保留供对照。 */}
        {/* 2026-10-23：本次修改原因：展开后表单标题保持简短。 */}
        {/* <div className="sectionHeading"><div><h2>录入参考文章</h2></div></div> 2026-10-23：原所有录入路径都显示标题的逻辑留作对照。 */}
        {/* 2026-10-23：本次修改原因：手动新建才显示标题，双击候选后直接呈现预填字段。 */}
        {(mode === 'legacy' || formOrigin === 'manual') && <div className="sectionHeading"><div><h2>录入参考文章</h2></div></div>}
        {/* 2026-10-23：本次修改原因：只在候选全文实际获取期间显示操作状态。 */}
        {previewUrl && <p className="libraryFetchStatus" role="status">正在获取正文…</p>}
        <form className="contentForm" onSubmit={submit}>
          <label className="field full"><span>文章标题 <em>*</em></span>
            <input value={title} onChange={(event) => setTitle(event.target.value)} maxLength={300} required
              placeholder="输入参考文章的原标题" />
          </label>
          <label className="field"><span>来源平台</span>
            <select value={platformId} onChange={(event) => setPlatformId(event.target.value)} required>
              {/* 2026-10-23：本次修改原因：全网热点没有单一文章来源，手动录入时需明确选择。 */}
              <option value="" disabled>选择平台</option>
              {active('platform').map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
            </select>
          </label>
          <label className="field"><span>内容类目</span>
            <select value={categoryId} onChange={(event) => setCategoryId(event.target.value)} required>
              {active('category').map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
            </select>
          </label>
          <label className="field"><span>内容形式 <small>可选</small></span>
            <select value={formatId} onChange={(event) => setFormatId(event.target.value)}>
              <option value="">通用 / 未分类</option>
              {active('format').map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
            </select>
          </label>
          <label className="field"><span>编辑质量评价</span>
            <select value={qualityScore} onChange={(event) => setQualityScore(Number(event.target.value))}>
              {[5, 4, 3, 2, 1].map((score) => <option key={score} value={score}>{score} / 5 分</option>)}
            </select>
          </label>
          {/* 2026-10-23：本次修改原因：候选与手动入库均可直接补齐分析分组所需的元数据。 */}
          {mode === 'discovery' && <>
            <label className="field"><span>作者或账号</span><input value={authorId} onChange={(event) => setAuthorId(event.target.value)} maxLength={200} /></label>
            <label className="field"><span>发布时间</span><input type="date" value={publishedAt} onChange={(event) => setPublishedAt(event.target.value)} /></label>
            <label className="field"><span>账号粉丝数 <small>可选</small></span><input type="number" min="0" value={accountFollowers}
              onChange={(event) => setAccountFollowers(event.target.value)} /></label>
            <label className="field"><span>目标受众</span><select value={audienceId} onChange={(event) => setAudienceId(event.target.value)}>
              <option value="">未确定</option>{active('audience').map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}</select></label>
            <label className="field"><span>主题</span><input value={topic} onChange={(event) => setTopic(event.target.value)} maxLength={200} /></label>
            <label className="field"><span>标签（用顿号或逗号分隔）</span><input value={tags} onChange={(event) => setTags(event.target.value)} /></label>
            <label className="field"><span>复核状态</span><select value={reviewStatus}
              onChange={(event) => setReviewStatus(event.target.value as 'pending' | 'ready')}>
              <option value="pending">待核对</option><option value="ready">可分析</option></select></label>
          </>}
          <label className="field full"><span>来源链接 <small>可选</small></span>
            <input type="url" value={sourceUrl} onChange={(event) => setSourceUrl(event.target.value)}
              placeholder="https://…" maxLength={1000} />
          </label>
          {/* 2026-10-23：本次修改原因：候选接口的可用读数可核对后随文章保存，缺失值留空。 */}
          {mode === 'discovery' && <div className="sampleMetricFields">
            <p>互动数据快照 <small>来源：{metricSource}；近似读数未预填。</small></p>
            {(['reads', 'likes', 'comments', 'shares'] as const).map((key) => <label className="field" key={key}>
              <span>{({ reads: '阅读', likes: '点赞', comments: '评论', shares: '分享' })[key]}</span>
              <input type="number" min="0" value={candidateMetrics[key]}
                onChange={(event) => setCandidateMetrics({ ...candidateMetrics, [key]: event.target.value })} /></label>)}
          </div>}
          <label className="field full"><span>文章正文 <em>*</em></span>
            <textarea rows={9} value={body} onChange={(event) => setBody(event.target.value)}
              placeholder="粘贴可用于分析的正文；至少 50 字。" required minLength={50} maxLength={30000} />
            {/* <small>标题和正文会用于策略提炼；系统不会直接照搬到生成结果。</small> 2026-10-23：原重复说明暂留供对照。 */}
          </label>
          {mode === 'discovery' && <label className="field full"><span>使用权限说明 <small>可选</small></span>
            <textarea rows={2} maxLength={2000} value={usageRightsNote} onChange={(event) => setUsageRightsNote(event.target.value)}
              placeholder="例如：自有内容、已获授权或可在本项目中分析的资料" /></label>}
          {/* <label className="checkField full"><input type="checkbox" checked={rightsConfirmed}
            onChange={(event) => setRightsConfirmed(event.target.checked)} required /> 2026-10-24：原旧表单只更新权限状态的做法留作对照。 */}
          {/* 2026-10-24：本次修改原因：旧录入入口确认权限时也同步完成复核状态。 */}
          <label className="checkField full"><input type="checkbox" checked={rightsConfirmed}
            onChange={(event) => { setRightsConfirmed(event.target.checked); setReviewStatus(event.target.checked ? 'ready' : 'pending') }} required />
            {/* <span>我确认拥有该样本在本项目中存储、分析与使用的权限。</span> 2026-10-24：原标签未说明原文核对，留作对照。 */}
            {/* 2026-10-24：本次修改原因：旧录入入口的勾选文案与自动完成复核的行为一致。 */}
            <span>我已核对原文，并确认可在本项目中存储、分析和使用该正文。</span>
          </label>
          <div className="formActions"><button className="primaryButton" type="submit"
            disabled={busy || !platformId || !categoryId || !rightsConfirmed}>{busy ? '正在保存…' : '保存样本'}</button></div>
        </form>
        {error && <p className="alert error" role="alert">{error}</p>}
        {message && <p className="alert success" role="status">{message}</p>}
      {/* </section> 2026-10-23：原常驻录入区结束标签保留供对照。 */}
      </section>}

      {mode === 'legacy' && <section className="card libraryCard">
        {/* <div className="sectionHeading"><div><span className="stepTag teal">02</span><h2>已录入样本 <span className="countBadge">{samples.length}</span></h2></div></div> 2026-10-23：原无操作的列表标题保留供对照。 */}
        {/* 2026-10-23：本次修改原因：列表标题提供录入表单的明确开关，候选预填仍自动展开。 */}
        <div className="sectionHeading"><div><h2>已录入样本 <span className="countBadge">{samples.length}</span></h2></div>
          {/* 2026-10-23：本次修改原因：折叠时不引用尚未渲染的表单节点。 */}
          <button className="secondaryButton" type="button" aria-expanded={showSampleForm}
            aria-controls={showSampleForm ? 'sample-import-form' : undefined}
            onClick={() => showSampleForm ? setShowSampleForm(false) : startManualEntry()}>
            {showSampleForm ? '收起录入' : '手动录入样本'}</button></div>
        {/* 2026-10-23：本次修改原因：录入区折叠时仍展示样本列表读取错误。 */}
        {!showSampleForm && error && <p className="alert error" role="alert">{error}</p>}
        <div className="libraryFilters">
          <input aria-label="搜索样本" value={query} onChange={(event) => setQuery(event.target.value)}
            placeholder="搜索标题、类目或正文" />
          <select aria-label="按平台筛选样本" value={filterPlatform}
            onChange={(event) => setFilterPlatform(event.target.value)}>
            <option value="">全部平台</option>
            {options.filter((item) => item.kind === 'platform').map((item) =>
              <option key={item.id} value={item.id}>{item.label}</option>)}
          </select>
        </div>
        {filtered.length === 0 ? <div className="emptyState"><span>▤</span><h3>没有匹配的样本</h3>
          <p>录入文章后，就能在这里查看和筛选。</p></div> :
          <div className="sampleList">{filtered.map((item) => <article className="sampleItem" key={item.id}>
            <div className="sampleTags"><span>{label(item.platform_id)}</span><span>{label(item.category_id)}</span>
              <span>{label(item.format_id)}</span></div>
            <h3>{item.title}</h3>
            <p>{item.body_text.slice(0, 120)}{item.body_text.length > 120 ? '…' : ''}</p>
            <div className="sampleMeta"><span>编辑评分 {item.quality_score} / 5</span>
              <span>{new Date(item.created_at).toLocaleDateString('zh-CN')}</span></div>
            <details><summary>查看正文与来源</summary><div className="sampleBody">{item.body_text}</div>
              {item.source_url && <a href={item.source_url} target="_blank" rel="noreferrer">打开来源链接 ↗</a>}</details>
          </article>)}</div>}
      </section>}
    </div>
    {/* 2026-10-23：本次修改原因：收录后停留在发现页，标记当前候选并刷新样本管理数据。 */}
    {/* 2026-10-24：本次修改原因：批量确认分开展示可入库与待补齐文章，并反馈每篇结果。 */}
    {mode === 'discovery' && batchOpen && <div className="articleDialogBackdrop" onMouseDown={(event) => {
      if (event.target === event.currentTarget && !batchBusy) setBatchOpen(false)
    }}><section className="articleDialog libraryBatchDialog" role="dialog" aria-modal="true" aria-label="批量收录">
      <div className="articleDialogHead"><h2>批量收录</h2><button type="button" className="articleDialogClose"
        aria-label="关闭" disabled={batchBusy} onClick={() => setBatchOpen(false)}>×</button></div>
      <div className="libraryBatchBody">
        <strong>已选 {selectedEntries.length} 篇 · 可收录 {readyEntries.length} 篇 · 待补齐 {selectedEntries.length - readyEntries.length} 篇</strong>
        {/* 2026-10-24：本次修改原因：批量补齐共同类目，使用权限只由用户显式确认。 */}
        <div className="libraryBatchCommon"><label>统一补入类目<select value={batchCategoryId}
          onChange={(event) => setBatchCategoryId(event.target.value)} disabled={batchBusy}>
          <option value="">逐篇已有类目</option>{active('category').map((item) =>
            <option key={item.id} value={item.id}>{item.label}</option>)}</select></label>
          <label className="libraryCheck"><input type="checkbox" checked={batchRightsConfirmed} disabled={batchBusy}
            onChange={(event) => setBatchRightsConfirmed(event.target.checked)} />我已核对选中文章原文，并确认可在本项目中存储、分析和使用正文</label></div>
        {/* 2026-10-24：本次修改原因：统一补齐条件变更时同步刷新每篇缺项。 */}
        {selectedEntries.map(([key, candidate]) => { const missing = candidateMissing(candidate, batchCandidateValue(key, candidate)); return <div key={key} className="libraryBatchRow">
          <span>{candidate.title}</span><span>{missing.length ? `待补齐：${missing.join('、')}` : '可收录'}</span>
          <button type="button" className="secondaryButton" disabled={batchBusy}
            onClick={() => reviewBatchCandidate(candidate)}>核对</button></div> })}
        {batchReviewMessage && <p role="status" className="libraryBatchReviewStatus">{batchReviewMessage}</p>}
        {batchProgress && <p role="status">{batchProgress}</p>}
        {batchResults.length > 0 && <div className="libraryBatchResults" role="status">{batchResults.map((item) =>
          <p key={item.key}>{item.title}：{item.error || '收录成功'}。</p>)}</div>}
      </div>
      <div className="articleDialogActions"><button type="button" className="secondaryButton" disabled={batchBusy}
        onClick={() => setBatchOpen(false)}>关闭</button>
        {/* <button type="button" className="primaryButton" disabled={batchBusy || readyEntries.length === 0}>收录可用 {readyEntries.length} 篇</button> 2026-10-24：原必须逐篇暂存后才能点击的入口留作对照。 */}
        {/* 2026-10-24：本次修改原因：选中候选可直接一键核对或一键收录，缺项文章保留待补齐。 */}
        <button type="button" className="secondaryButton" disabled={batchBusy || selectedEntries.length === 0}
          onClick={() => void reviewSelected()}>一键核对</button>
        <button type="button" className="primaryButton" disabled={batchBusy || selectedEntries.length === 0}
          onClick={() => void collectReadyDrafts()}>{batchBusy ? '正在处理…' : '一键收录'}</button></div>
    </section></div>}
    {/* 2026-10-23：本次修改原因：收录后停留在发现页，标记当前候选并刷新样本管理数据。 */}
    {mode === 'discovery' && editor && <ArticleEditorDialog key={editor.key} mode="create" initial={editor.value}
      options={options} candidate={editor.candidate} issue={editor.issue} onClose={closeEditor}
      onSaveDraft={editor.candidate ? async (value) => {
        await saveCandidateDraft(editor.key, value)
        setCandidateDrafts((current) => ({ ...current, [editor.key]: value }))
        const candidate = Object.values(candidatePages.current).flatMap((page) => page.items)
          .find((item) => candidateKey(item, collectPlatform) === editor.key)
        if (candidate) setSelectedCandidates((current) => ({ ...current, [editor.key]: candidate }))
        closeEditor()
      } : undefined}
      onSave={async (payload) => {
        // 2026-10-24：本次修改原因：单篇收录同样保存候选身份，手动新建不受影响。
        if (editor.candidate) payload.source_data = { ...(payload.source_data as Record<string, unknown>), candidate_key: editor.key }
        await createLibraryArticle(payload)
        // if (editor.candidate) setCollectedIds((current) => [...current, editor.key]) // 2026-10-24：原仅标记已收录留作对照。
        // 2026-10-24：本次修改原因：单篇收录成功也清理候选选择和待收录草稿。
        if (editor.candidate) {
          setCollectedIds((current) => current.includes(editor.key) ? current : [...current, editor.key])
          setSelectedCandidates((current) => { const next = { ...current }; delete next[editor.key]; return next })
          setCandidateDrafts((current) => { const next = { ...current }; delete next[editor.key]; return next })
          try { await deleteCandidateDraft(editor.key) } catch { /* 已入库成功，草稿清理可稍后重试。 */ }
        }
        // setEditor(null) // 2026-10-24：原单篇关闭弹窗逻辑留作对照。
        closeEditor()
        onSaved?.()
      }} />}
  </>
}
