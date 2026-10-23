// 2026-10-23：本次修改原因：让用户安全录入、检索和检查各平台的高质量参考样本。
import { useEffect, useState, type FormEvent } from 'react'
// import { addSample, getSamples, type ContentOption, type ContentSample } from '../workspaceApi' // 2026-10-23：原导入保留供对照。
// 2026-10-23：本次修改原因：在样本库中增加 RedFox 公众号候选搜索与按需预览。
// import { addSample, getSamples, getRedFoxStatus, getRedFoxWechatArticle, searchRedFoxWechat, // 2026-10-23：原导入保留供对照。
// 2026-10-23：本次修改原因：样本库增加三种榜单采集请求。
import { addSample, getSamples, getRedFoxStatus, getRedFoxWechatArticle, getRedFoxWechatRank, searchRedFoxWechat,
  type ContentOption, type ContentSample, type RedFoxCandidate, type RedFoxSearchResult } from '../workspaceApi'
// 2026-10-23：本次修改原因：候选文章可直接提炼为待审核策略草稿。
// import { analyzeRedFoxWechatArticle, type ContentStrategy } from '../workspaceApi' // 2026-10-23：原样本库内提炼入口暂留供对照。

// 2026-10-23：本次修改原因：榜单类目以 RedFox 标准类目为准，与项目里可编辑的内容类目分开选择。
const RANK_CATEGORIES = ['总排名', '人文资讯', '知识百科', '健康养生', '时尚潮流', '美食餐饮',
  '乐活生活', '旅游出行', '搞笑幽默', '情感心理', '体育娱乐', '美容美体', '文摘精选',
  '财富理财', '科技数码', '创投商业', '汽车交通', '房产楼市', '职场发展', '教育考试',
  '学术研究', '企业品牌']

// 2026-10-23：本次修改原因：日期控件使用本地日期，避免 UTC 日期跨日使榜单默认范围偏移。
function localDateOffset(days: number): string {
  const value = new Date()
  value.setDate(value.getDate() + days)
  return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`
}

// 2026-10-23：本次修改原因：采集方式包含现有关键词发现和新增的三个榜单。
type CollectMode = 'quality' | 'hot' | 'ten_w' | 'original' | 'growth'

export default function SamplesPage({ options }: { options: ContentOption[] }) {
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
  const [query, setQuery] = useState('')
  const [filterPlatform, setFilterPlatform] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  // 2026-10-23：本次修改原因：参考文章录入只在手动新建或候选填入后展开，样本列表保持主视图。
  const [showSampleForm, setShowSampleForm] = useState(false)
  // 2026-10-23：本次修改原因：搜索结果只是候选；用户选择后才请求全文并填写现有样本表单。
  const [redfoxConfigured, setRedfoxConfigured] = useState<boolean | null>(null)
  const [collectKeyword, setCollectKeyword] = useState('')
  // 2026-10-23：本次修改原因：优质库搜索用于寻找可取全文的文章，热门库用于选题发现。
  // const [searchSource, setSearchSource] = useState<'quality' | 'hot'>('quality') // 2026-10-23：原仅关键词来源状态保留供对照。
  // 2026-10-23：本次修改原因：不同采集方式分别显示关键词、类目与日期参数。
  const [collectMode, setCollectMode] = useState<CollectMode>('ten_w')
  const [rankCategory, setRankCategory] = useState('总排名')
  const [rankStartDate, setRankStartDate] = useState(() => localDateOffset(-2))
  const [rankEndDate, setRankEndDate] = useState(() => localDateOffset(-1))
  const [rankDate, setRankDate] = useState(() => localDateOffset(-1))
  const [collectResult, setCollectResult] = useState<RedFoxSearchResult | null>(null)
  const [collectBusy, setCollectBusy] = useState(false)
  const [collectError, setCollectError] = useState('')
  const [previewUrl, setPreviewUrl] = useState('')
  // 2026-10-23：本次修改原因：跟踪单篇分析状态并在当前页展示策略结果。
  // const [analysisUrl, setAnalysisUrl] = useState('') // 2026-10-23：原样本库分析状态暂留供对照。
  // const [analysisResult, setAnalysisResult] = useState<ContentStrategy | null>(null) // 2026-10-23：原策略结果状态暂留供对照。

  useEffect(() => {
    setPlatformId((current) => active('platform').some((item) => item.id === current) ? current : active('platform')[0]?.id ?? '')
    setCategoryId((current) => active('category').some((item) => item.id === current) ? current : active('category')[0]?.id ?? '')
  }, [options])

  useEffect(() => {
    getSamples().then(setSamples).catch((reason) =>
      setError(reason instanceof Error ? reason.message : '样本读取失败'))
  }, [])

  // 2026-10-23：本次修改原因：策略页取全文失败后回到样本库时，自动填入已知标题与来源，用户只需补正文。
  useEffect(() => {
    const pending = sessionStorage.getItem('ai4geo.sampleImportCandidate')
    if (!pending) return
    sessionStorage.removeItem('ai4geo.sampleImportCandidate')
    try {
      const candidate = JSON.parse(pending) as { title: string; url: string; category_id: string; format_id: string | null }
      setPlatformId('platform_01')
      setTitle(candidate.title)
      setSourceUrl(candidate.url)
      setCategoryId(candidate.category_id)
      setFormatId(candidate.format_id ?? '')
      setBody('')
      setRightsConfirmed(false)
      setMessage('已填入候选标题和来源链接。请核对原文、补入正文并确认使用权限后保存。')
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

  // 2026-10-23：本次修改原因：首轮搜索只取近七天最多十篇候选，以控制接口调用量。
  async function searchCandidates(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setCollectError('')
    setCollectResult(null)
    setCollectBusy(true)
    try {
      // setCollectResult(await searchRedFoxWechat(collectKeyword.trim())) // 2026-10-23：原固定热门库搜索暂留供对照。
      // setCollectResult(await searchRedFoxWechat(collectKeyword.trim(), searchSource)) // 2026-10-23：原二选一关键词采集保留供对照。
      // 2026-10-23：本次修改原因：榜单无需关键词；按类型传送准确的类目和日期参数。
      if (collectMode === 'quality' || collectMode === 'hot') {
        setCollectResult(await searchRedFoxWechat(collectKeyword.trim(), collectMode))
      } else if (collectMode === 'growth') {
        setCollectResult(await getRedFoxWechatRank({ source: 'growth', rank_date: rankDate }))
      } else {
        setCollectResult(await getRedFoxWechatRank({ source: collectMode, category: rankCategory,
          start_date: rankStartDate, end_date: rankEndDate }))
        // 2026-10-23：本次修改原因：榜单标准类目与本地内容类目同名时，预选正确的样本类目。
        const matchedCategory = active('category').find((item) => item.label === rankCategory)
        if (matchedCategory) setCategoryId(matchedCategory.id)
      }
    } catch (reason) {
      setCollectError(reason instanceof Error ? reason.message : '公众号搜索失败')
    } finally {
      setCollectBusy(false)
    }
  }

  // 2026-10-23：本次修改原因：仅在编辑选择某篇文章后拉取详情，并由其自行核对和确认使用权限。
  async function previewCandidate(candidate: RedFoxCandidate) {
    setCollectError('')
    // 2026-10-23：本次修改原因：清除上一次全文错误，并在增长榜已有可用内容时直接填入待核对表单。
    setError('')
    setPreviewUrl(candidate.url)
    try {
      if (candidate.body_text && candidate.body_text.length >= 200) {
        setPlatformId('platform_01')
        setTitle(candidate.title)
        setSourceUrl(candidate.url)
        setBody(candidate.body_text)
        setRightsConfirmed(false)
        // 2026-10-23：本次修改原因：增长榜内容被样本字段上限截断时要求编辑核对并补齐。
        setMessage(candidate.body_truncated
          ? '增长榜内容超过 30000 字，已截断填入；请打开原文核对并补齐，再确认使用权限。'
          : '增长榜返回了文章内容，已填入表单；请打开原文核对是否完整，再确认使用权限。')
        // document.getElementById('sample-import-form')?.scrollIntoView({ behavior: 'smooth', block: 'start' }) // 2026-10-23：原滚动逻辑暂留供对照。
        // 2026-10-23：本次修改原因：榜单提供正文时先展开表单，再定位到待核对内容。
        openSampleForm()
        return
      }
      // 2026-10-23：本次修改原因：候选卡片直接请求后端的 DeepSeek Fetch，保留原文链接供人工核对。
      // 2026-10-23：本次修改原因：同一按钮改由后端启动浏览器取文，编辑仍在本页核对并入库。
      const detail = await getRedFoxWechatArticle(candidate.url)
      setPlatformId('platform_01')
      setTitle(detail.title || candidate.title)
      setSourceUrl(candidate.url)
      setBody(detail.body_text)
      setRightsConfirmed(false)
      // setMessage(detail.body_available ? '已填入文章正文，请核对内容、分类和使用权限后再保存样本。' : '详情已返回，但未识别出正文字段；请在来源文章核对后手动粘贴可用的正文。') // 2026-10-23：原提示逻辑暂留供对照。
      // 2026-10-23：本次修改原因：全文超过样本字段上限时明确告知编辑已截断。
      // setMessage(detail.truncated ? '正文超过 30000 字，已截断填入。请核对内容、分类和使用权限后再保存样本。' : detail.body_available ? '已填入文章正文，请核对内容、分类和使用权限后再保存样本。' : '详情已返回，但未识别出正文字段；请在来源文章核对后手动粘贴可用的正文。') // 2026-10-23：原提示保留供对照。
      // 2026-10-23：本次修改原因：展示正文来源及标题不一致风险，保存前要求人工核对。
      // setMessage(`${detail.origin === 'deepseek_fetch' ? 'DeepSeek 已抓取正文' : '公开原文页已读取正文'}；${detail.truncated ? '内容超过 30000 字，已截断；' : ''}${detail.title && !detail.title.includes(candidate.title) && !candidate.title.includes(detail.title) ? '抓取标题与榜单标题不同，请仔细核对；' : ''}请核对正文完整性、分类和使用权限后保存样本。`) // 2026-10-23：原来源提示保留供对照。
      // 2026-10-23：本次修改原因：向编辑说明正文来自浏览器还是公开页备用读取。
      setMessage(`${detail.origin === 'playwright_browser' ? '浏览器已提取正文' : '公开原文页已读取正文'}；${detail.truncated ? '内容超过 30000 字，已截断；' : ''}${detail.title && !detail.title.includes(candidate.title) && !candidate.title.includes(detail.title) ? '抓取标题与榜单标题不同，请仔细核对；' : ''}请核对正文完整性、分类和使用权限后保存样本。`)
      // document.getElementById('sample-import-form')?.scrollIntoView({ behavior: 'smooth', block: 'start' }) // 2026-10-23：原滚动逻辑暂留供对照。
      // 2026-10-23：本次修改原因：浏览器取文成功后显式展开录入表单。
      openSampleForm()
    } catch (reason) {
      // setCollectError(reason instanceof Error ? reason.message : '文章详情获取失败') // 2026-10-23：原仅报错的回退暂留供对照。
      // 2026-10-23：本次修改原因：全文不可得时保留已知元数据，避免重新填写标题和链接。
      setPlatformId('platform_01')
      setTitle(candidate.title)
      setSourceUrl(candidate.url)
      setBody('')
      setRightsConfirmed(false)
      // setCollectError(reason instanceof Error ? reason.message : '文章详情获取失败') // 2026-10-23：原两处同时报错的处理保留供对照。
      // 2026-10-23：本次修改原因：取文错误随预填表单展示一次，避免候选区和录入区重复报错。
      // 2026-10-23：本次修改原因：滚动至手动表单后仍能看见具体接口错误，不再只有“全文未取得”通用文案。
      setError(reason instanceof Error ? reason.message : '文章详情获取失败')
      // setMessage('全文未取得。已填写标题和链接；可从原文补入正文，保存后在内容策略页选样提炼。') // 2026-10-23：原失败说明误用绿色成功样式，暂留供对照。
      // 2026-10-23：本次修改原因：失败信息统一显示为红色，不再把未取得正文标成成功。
      setMessage('')
      // document.getElementById('sample-import-form')?.scrollIntoView({ behavior: 'smooth', block: 'start' }) // 2026-10-23：原滚动逻辑暂留供对照。
      // 2026-10-23：本次修改原因：取文失败时直接展示已预填的标题和链接供人工补正文。
      openSampleForm()
    } finally {
      setPreviewUrl('')
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
      const saved = await addSample({
        title: title.trim(), body_text: body.trim(), platform_id: platformId,
        category_id: categoryId, format_id: formatId || null,
        source_url: sourceUrl.trim() || null, quality_score: qualityScore, rights_confirmed: rightsConfirmed,
      })
      setSamples((current) => [saved, ...current])
      setTitle('')
      setBody('')
      setSourceUrl('')
      setRightsConfirmed(false)
      // setMessage('样本已加入库中。现在可以在“内容策略”中使用它。') // 2026-10-23：原提示保留供对照。
      // 2026-10-23：本次修改原因：明确从已入库样本进入策略提取的下一步。
      setMessage('样本已保存。请到“内容策略”页勾选它，与其他样本一起提炼写法。')
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '样本保存失败')
    } finally {
      setBusy(false)
    }
  }

  const filtered = samples.filter((item) =>
    (!filterPlatform || item.platform_id === filterPlatform) &&
    (!query.trim() || [item.title, item.body_text, label(item.category_id)].some((value) =>
      value.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())))
  )

  return <>
    <div className="pageHeading">
      {/* <div><p className="kicker">LIBRARY / 样本库</p><h1>把好内容沉淀为可用样本</h1> 2026-10-23：原装饰性页眉保留供对照。 */}
      {/* 2026-10-23：本次修改原因：用模块名称作为稳定页面标题。 */}
      <div><h1>样本库</h1>
        <p>记录平台、领域和质量判断，让策略提炼有可追溯的依据。</p></div>
      {/* <span className="headingIndex">02 / 04</span> 2026-10-23：原四页编号暂留供对照。 */}
      {/* 2026-10-23：本次修改原因：导航增加品牌库，更新页面总数。 */}
      <span className="headingIndex">02 / 05</span>
    </div>
    <div className="infoBanner"><span className="bannerIcon">i</span>
      {/* 当前支持录入已确认使用权限的文章。自动采集需按各平台的数据接口与授权范围单独接入。 2026-10-23：原提示暂留供对照。 */}
      {/* 公众号接口搜索结果仅作候选参考；取得全文不会自动入库，保存样本前仍需确认使用权限。 2026-10-23：原仅搜索说明保留供对照。 */}
      {/* 2026-10-23：本次修改原因：榜单与关键词结果都只作为候选，不在查询时自动保存样本。 */}
      公众号榜单和关键词结果仅作候选参考；取得内容不会自动入库，保存样本前仍需核对原文与使用权限。
    </div>
    {/* 2026-10-23：本次修改原因：在样本库首屏提供限量搜索、候选预览和清晰的下一步操作。 */}
    <section className="card redfoxPilot">
      {/* <div className="sectionHeading"><div><span className="stepTag teal">试</span><h2>公众号候选采集</h2></div> 2026-10-23：原试验标记保留供对照。 */}
      {/* 2026-10-23：本次修改原因：采集入口名称直接描述操作，弱化装饰性标记。 */}
      <div className="sectionHeading"><div><h2>发现公众号文章</h2></div>
        {/* <p>RedFox · 近 7 天 · 最多 10 篇 / 次</p> 2026-10-23：原提示暂留供对照。 */}
        {/* <p>RedFox · 近 7 天 · 最多 10 篇 / 次 · 搜索与取全文均按接口计费</p> 2026-10-23：原提示暂留供对照。 */}
        {/* <p>RedFox · 近 7 天热门文章（文档标注阅读量 5000+）· 最多 10 篇 / 次 · 按接口计费</p> 2026-10-23：原固定来源说明暂留供对照。 */}
        {/* 2026-10-23：本次修改原因：按搜索来源展示实际数据范围。 */}
        {/* <p>RedFox · 每次最多显示 10 篇候选 · 搜索与取全文可能计费</p> 2026-10-23：原统一数量说明保留供对照。 */}
        {/* 2026-10-23：本次修改原因：榜单显示上限为 20 篇，关键词搜索仍沿用原上限。 */}
        {/* <p>RedFox · {collectMode === 'quality' || collectMode === 'hot' ? '关键词最多显示 10 篇' : '榜单最多显示 20 篇'} · 查询与取全文可能计费</p> 2026-10-23：原长说明保留供对照。 */}
        {/* 2026-10-23：本次修改原因：外部查询费用保留为精简的可见提示。 */}
        <span className="externalCost">RedFox 查询可能计费</span></div>
      {/* <form className="redfoxSearch" onSubmit={searchCandidates}> 2026-10-23：原二项关键词表单保留供对照。 */}
      {/* 2026-10-23：本次修改原因：采集方式决定表单字段，避免榜单用户被要求填写无关关键词。 */}
      <form className="redfoxSearch redfoxCollectForm" onSubmit={searchCandidates}>
        {/* <label className="field"><span>搜索关键词</span><input value={collectKeyword} onChange={(event) => setCollectKeyword(event.target.value)} minLength={2} maxLength={80} required placeholder="例如：久坐健康、职场沟通" /></label> 2026-10-23：原关键词固定显示保留供对照。 */}
        <label className="field"><span>采集方式</span><select value={collectMode} onChange={(event) => {
          setCollectMode(event.target.value as CollectMode)
          setCollectResult(null)
          setCollectError('')
        }}>
          <option value="ten_w">10W+ 文章</option><option value="original">原创爆款文章</option>
          {/* <option value="growth">阅读增长榜</option><option value="quality">优质库关键词</option> 2026-10-23：原选项行保留供对照。 */}
          {/* 2026-10-23：本次修改原因：接口没有类目筛选，直接在选项名称中说明。 */}
          <option value="growth">阅读增长榜（无类目筛选）</option><option value="quality">优质库关键词</option>
          <option value="hot">近期热门关键词</option>
        </select></label>
        {/* 2026-10-23：本次修改原因：区分可尝试获取全文的优质库与选题发现用的热门库。 */}
        {/* <label className="field"><span>搜索来源</span><select value={searchSource} onChange={(event) => setSearchSource(event.target.value as 'quality' | 'hot')}><option value="quality">公众号作品优质库</option><option value="hot">近期热门文章</option></select></label> 2026-10-23：原来源选择保留供对照。 */}
        {/* 2026-10-23：本次修改原因：关键词、分类和日期字段仅在对应接口需要时出现。 */}
        {(collectMode === 'quality' || collectMode === 'hot') && <label className="field"><span>搜索关键词</span>
          <input value={collectKeyword} onChange={(event) => setCollectKeyword(event.target.value)}
            minLength={2} maxLength={80} required placeholder="例如：久坐健康、职场沟通" /></label>}
        {(collectMode === 'ten_w' || collectMode === 'original') && <>
          <label className="field"><span>榜单类目</span><select value={rankCategory} onChange={(event) => setRankCategory(event.target.value)}>
            {RANK_CATEGORIES.map((item) => <option key={item} value={item}>{item}</option>)}
          </select></label>
          <label className="field"><span>开始日期</span><input type="date" value={rankStartDate} max={rankEndDate}
            onChange={(event) => setRankStartDate(event.target.value)} required /></label>
          <label className="field"><span>结束日期</span><input type="date" value={rankEndDate} min={rankStartDate}
            onChange={(event) => setRankEndDate(event.target.value)} required /></label>
        </>}
        {collectMode === 'growth' && <label className="field"><span>榜单日期</span>
          <input type="date" value={rankDate} min={localDateOffset(-30)} max={localDateOffset(0)}
            onChange={(event) => setRankDate(event.target.value)} required /></label>}
        <button className="primaryButton" type="submit" disabled={collectBusy || !redfoxConfigured}>
          {/* {collectBusy ? '正在搜索…' : '搜索候选文章'} 2026-10-23：原按钮文案保留供对照。 */}
          {collectBusy ? '正在查询…' : (collectMode === 'quality' || collectMode === 'hot' ? '搜索候选文章' : '查询榜单')}</button>
      </form>
      {/* 2026-10-23：本次修改原因：提前说明增长榜是账号榜且未提供类目过滤，避免误解采集范围。 */}
      {collectMode === 'growth' && <p className="redfoxModeNote">阅读增长榜按公众号增长率排序，展示账号的最高、最低阅读文章；RedFox 接口没有类目筛选。</p>}
      {(collectMode === 'ten_w' || collectMode === 'original') && <p className="redfoxModeNote">榜单返回的是数据快照；摘要不等于全文。选中文章后可单独尝试取全文。</p>}
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
        <p className="redfoxSummary">{({ quality: '公众号作品优质库', hot: '近期热门文章', ten_w: '10W+ 文章榜',
          original: '原创爆款文章榜', growth: '公众号阅读增长榜' } as const)[collectResult.source]}
          {collectResult.category ? ` · ${collectResult.category}` : ''}
          {collectResult.rank_date ? ` · ${collectResult.rank_date}` : collectResult.start_date && collectResult.end_date
            ? ` · ${collectResult.start_date} 至 ${collectResult.end_date}` : ''}
          {` · ${collectResult.items.length} 篇候选`}
          {collectResult.source === 'growth' ? `（来自 ${collectResult.total_count ?? 0} 个账号）` : ''}。指标为 RedFox 返回时的快照。</p>
        {/* 2026-10-23：本次修改原因：部分条目未返回时保留已取得文章，同时就地显示缺失说明。 */}
        {collectResult.warnings?.map((warning) => <p className="alert warning" role="status" key={warning}>{warning}</p>)}
        {/* {collectResult.items.length === 0 ? <div className="emptyState"><h3>没有匹配的候选文章</h3><p>可尝试更具体的关键词。</p></div> : 2026-10-23：原统一空状态保留供对照。 */}
        {collectResult.items.length === 0 ? <div className="emptyState"><h3>本次没有可显示的文章</h3>
          <p>{collectResult.source === 'growth' ? '该日期暂无上榜账号或代表文章；可换近 30 天内的日期。'
            : collectResult.source === 'ten_w' || collectResult.source === 'original'
              ? '所选类目与日期暂无榜单文章；可调整类目或日期范围。' : '可尝试更具体的关键词。'}</p></div> :
          <div className="redfoxResults">{collectResult.items.map((candidate) => <article className="redfoxItem" key={candidate.id}>
            {/* <div className="redfoxItemHead"><h3>{candidate.title}</h3><span>{candidate.read_count == null ? '阅读量未提供' : `阅读 ${candidate.read_count}`}</span></div> 2026-10-23：原仅显示阅读数的卡片标题保留供对照。 */}
            {/* 2026-10-23：本次修改原因：标题、阅读与互动数据逐项标出缺失状态，保留 10w+ 等原始读数。 */}
            <div className="redfoxItemHead"><h3>{candidate.title || 'RedFox 未提供标题'}</h3>
              {candidate.work_role && <span>{candidate.work_role}</span>}</div>
            <div className="redfoxMetrics"><span>阅读 {candidate.read_count ?? '未提供'}</span>
              <span>点赞 {candidate.like_count ?? '未提供'}</span><span>在看 {candidate.watch_count ?? '未提供'}</span>
              <span>分享 {candidate.share_count ?? '未提供'}</span><span>评论 {candidate.comment_count ?? '未提供'}</span>
              {candidate.growth_rate != null && <span>账号增长率 {candidate.growth_rate}%</span>}</div>
            {/* <p>{candidate.summary || '暂无摘要'}</p> 2026-10-23：原摘要提示保留供对照。 */}
            <p>{candidate.summary || '接口未提供摘要。'}</p>
            {/* 2026-10-23：本次修改原因：榜单摘要与待核对正文明确区分，并说明缺少原文链接时的操作限制。 */}
            {['ten_w', 'original', 'growth'].includes(collectResult.source) && <p className="redfoxAvailability">
              {/* {candidate.body_truncated ? '榜单内容超过 30000 字，填写样本时会截断，需核对原文。' : candidate.body_status === 'rank_content_unverified' ? '榜单返回了文章内容，需核对原文是否完整。' : '榜单未提供可直接入库的全文，可单独尝试取全文。'} 2026-10-23：原长提示保留供对照。 */}
              {/* 2026-10-23：本次修改原因：候选卡片只呈现差异和下一步，避免每篇重复完整说明。 */}
              {candidate.body_truncated ? '正文超长，入库前请核对。'
                : candidate.body_status === 'rank_content_unverified' ? '榜单正文待核对。'
                : '未提供全文。'}
              {/* {!candidate.url && ' 原文链接缺失，无法自动取全文或送往策略提取。'} 2026-10-23：原长提示保留供对照。 */}
              {!candidate.url && ' 缺少原文链接，需手动录入。'}</p>}
            <div className="redfoxItemFoot"><span>{candidate.author || '未知公众号'} · {candidate.published_at || '时间未知'}</span>
              <div>{/* <a className="textButton" href={candidate.url} target="_blank" rel="noreferrer">打开原文 ↗</a> 2026-10-23：原始链接按钮保留供对照。 */}
                {/* 2026-10-23：本次修改原因：RedFox 未给出原文链接时不渲染无效跳转。 */}
                {candidate.url && <a className="textButton" href={candidate.url} target="_blank" rel="noreferrer">打开原文 ↗</a>}
                {/* 2026-10-23：本次修改原因：将一键分析作为候选文章的主要操作。 */}
                {/* <button className="primaryButton" type="button" disabled={Boolean(analysisUrl || previewUrl || !categoryId)} onClick={() => void analyzeCandidate(candidate)}>{analysisUrl === candidate.url ? '正在分析…' : '分析写法'}</button> 2026-10-23：原样本库内提炼按钮暂留供对照。 */}
                {/* 2026-10-23：本次修改原因：点击候选只将其交给策略页分析，职责不在样本库内。 */}
                {/* <button className="primaryButton" type="button" disabled={!categoryId} onClick={() => sendToStrategies(candidate)}>送往策略提取</button> 2026-10-23：原操作保留供对照。 */}
                {/* 2026-10-23：本次修改原因：链接或标题缺失时禁止提交无效策略任务。 */}
                {/* <button className="primaryButton" type="button" disabled={!categoryId || !candidate.url || !candidate.title} onClick={() => sendToStrategies(candidate)}>送往策略提取</button> 2026-10-23：原候选直达策略按钮保留供对照。 */}
                {/* 2026-10-23：本次修改原因：先获取并保存样本，再去策略页勾选已入库样本。 */}
                {/* <button className="secondaryButton" type="button" disabled={Boolean(previewUrl)} onClick={() => void previewCandidate(candidate)}>取全文并填写样本</button> 2026-10-23：原按钮保留供对照。 */}
                {/* <button className="secondaryButton" type="button" disabled={Boolean(previewUrl) || !candidate.url} 2026-10-23：原按钮样式保留供对照。 */}
                <button className="primaryButton" type="button" disabled={Boolean(previewUrl) || !candidate.url}
                  onClick={() => void previewCandidate(candidate)}>
                  {/* {previewUrl === candidate.url ? '正在获取…' : candidate.body_text ? '填写内容到样本' : 'DeepSeek 取全文并填写样本'} 2026-10-23：原按钮文案保留供对照。 */}
                  {/* 2026-10-23：本次修改原因：明确按需调用本机浏览器取得公众号正文。 */}
                  {previewUrl === candidate.url ? '正在获取…' : candidate.body_text ? '填写内容到样本' : '浏览器取全文并填写样本'}</button></div></div>
          </article>)}</div>}
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
    <div className={showSampleForm ? 'twoColumnLayout' : 'singleColumnLayout'}>
      {/* <section className="card"> 2026-10-23：原开头暂留供对照。 */}
      {showSampleForm && <section className="card" id="sample-import-form">
        {/* <div className="sectionHeading"><div><span className="stepTag">01</span><h2>录入参考文章</h2></div></div> 2026-10-23：原标题保留供对照。 */}
        {/* 2026-10-23：本次修改原因：明确手动录入是可选的备用路径。 */}
        {/* <div className="sectionHeading"><div><span className="stepTag">01</span><h2>手动录入参考文章 <small>可选</small></h2></div></div> 2026-10-23：原冗余“可选”标题保留供对照。 */}
        {/* 2026-10-23：本次修改原因：展开后表单标题保持简短。 */}
        <div className="sectionHeading"><div><h2>录入参考文章</h2></div></div>
        <form className="contentForm" onSubmit={submit}>
          <label className="field full"><span>文章标题 <em>*</em></span>
            <input value={title} onChange={(event) => setTitle(event.target.value)} maxLength={300} required
              placeholder="输入参考文章的原标题" />
          </label>
          <label className="field"><span>来源平台</span>
            <select value={platformId} onChange={(event) => setPlatformId(event.target.value)} required>
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
          <label className="field full"><span>来源链接 <small>可选</small></span>
            <input type="url" value={sourceUrl} onChange={(event) => setSourceUrl(event.target.value)}
              placeholder="https://…" maxLength={1000} />
          </label>
          <label className="field full"><span>文章正文 <em>*</em></span>
            <textarea rows={9} value={body} onChange={(event) => setBody(event.target.value)}
              placeholder="粘贴可用于分析的正文；至少 50 字。" required minLength={50} maxLength={30000} />
            {/* <small>标题和正文会用于策略提炼；系统不会直接照搬到生成结果。</small> 2026-10-23：原重复说明暂留供对照。 */}
          </label>
          <label className="checkField full"><input type="checkbox" checked={rightsConfirmed}
            onChange={(event) => setRightsConfirmed(event.target.checked)} required />
            <span>我确认拥有该样本在本项目中存储、分析与使用的权限。</span>
          </label>
          <div className="formActions"><button className="primaryButton" type="submit"
            disabled={busy || !platformId || !categoryId || !rightsConfirmed}>{busy ? '正在保存…' : '保存样本'}</button></div>
        </form>
        {error && <p className="alert error" role="alert">{error}</p>}
        {message && <p className="alert success" role="status">{message}</p>}
      {/* </section> 2026-10-23：原常驻录入区结束标签保留供对照。 */}
      </section>}

      <section className="card libraryCard">
        {/* <div className="sectionHeading"><div><span className="stepTag teal">02</span><h2>已录入样本 <span className="countBadge">{samples.length}</span></h2></div></div> 2026-10-23：原无操作的列表标题保留供对照。 */}
        {/* 2026-10-23：本次修改原因：列表标题提供录入表单的明确开关，候选预填仍自动展开。 */}
        <div className="sectionHeading"><div><h2>已录入样本 <span className="countBadge">{samples.length}</span></h2></div>
          {/* 2026-10-23：本次修改原因：折叠时不引用尚未渲染的表单节点。 */}
          <button className="secondaryButton" type="button" aria-expanded={showSampleForm}
            aria-controls={showSampleForm ? 'sample-import-form' : undefined}
            onClick={() => showSampleForm ? setShowSampleForm(false) : openSampleForm()}>
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
      </section>
    </div>
  </>
}
