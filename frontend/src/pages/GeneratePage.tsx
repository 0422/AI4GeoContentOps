// 2026-10-23：本次修改原因：提供清晰的内容简报、策略预览与自动刷新的生成结果。
import { useEffect, useState, type FormEvent } from 'react'
import {
  // createWorkspaceTask, getMatchingStrategy, getWorkspaceResult, getWorkspaceTask, // 2026-10-23：原导入保留供对照。
  // 2026-10-23：本次修改原因：生成页保存人工修订稿。
  createWorkspaceTask, getMatchingStrategy, getWorkspaceResult, getWorkspaceTask, saveWorkspaceDraft,
  // 2026-10-23：本次修改原因：读取已审核品牌供生成任务选择。
  getBrands, getStrategies, type Brand,
  type ContentOption, type ContentStrategy, type WorkspaceResult, type WorkspaceTask,
} from '../workspaceApi'

const guideLabels = [
  ['title_rule', '标题方向'],
  ['keyword_rule', '关键词使用'],
  // ['language_rule', '遣词造句'], // 2026-10-23：原标签暂留供对照。
  // ['structure_rule', '行文结构'], // 2026-10-23：原标签暂留供对照。
  // 2026-10-23：本次修改原因：生成页预览与策略提炼维度保持一致。
  ['language_rule', '遣词造句与语气'],
  ['structure_rule', '行文结构与编排'],
  ['avoid_rule', '应避免'],
] as const

function MarkdownPreview({ content }: { content: string }) {
  return <div className="renderedArticle">{content.split(/\n+/).filter(Boolean).map((line, index) => {
    if (line.startsWith('### ')) return <h4 key={index}>{line.slice(4)}</h4>
    if (line.startsWith('## ')) return <h3 key={index}>{line.slice(3)}</h3>
    if (line.startsWith('# ')) return <h2 key={index}>{line.slice(2)}</h2>
    if (/^[-*] /.test(line)) return <p className="bulletLine" key={index}>{line.slice(2)}</p>
    return <p key={index}>{line}</p>
  })}</div>
}

export default function GeneratePage({ options }: { options: ContentOption[] }) {
  const active = (kind: ContentOption['kind']) => options.filter((item) => item.kind === kind && item.active)
  const label = (id: string) => options.find((item) => item.id === id)?.label ?? ''
  const [categoryId, setCategoryId] = useState('')
  const [audienceId, setAudienceId] = useState('')
  const [formatId, setFormatId] = useState('')
  const [platformId, setPlatformId] = useState('')
  const [topic, setTopic] = useState('')
  const [tone, setTone] = useState('专业、自然、易读')
  const [targetWords, setTargetWords] = useState('800')
  const [extraPrompt, setExtraPrompt] = useState('')
  // 2026-10-23：本次修改原因：让品牌信息与风格策略分别选择，并在提交时固定品牌版本。
  const [brands, setBrands] = useState<Brand[]>([])
  const [brandId, setBrandId] = useState('')
  const [brandError, setBrandError] = useState('')
  // 2026-10-23：本次修改原因：用户可在适用的已发布策略中选择具体写法版本。
  const [publishedStrategies, setPublishedStrategies] = useState<ContentStrategy[]>([])
  const [strategyChoice, setStrategyChoice] = useState('')
  const [strategy, setStrategy] = useState<ContentStrategy | null>(null)
  const [strategyLoading, setStrategyLoading] = useState(false)
  const [strategyError, setStrategyError] = useState('')
  const [task, setTask] = useState<WorkspaceTask | null>(null)
  const [result, setResult] = useState<WorkspaceResult | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [copyMessage, setCopyMessage] = useState('')
  // 2026-10-23：本次修改原因：新任务创建后把用户带到状态与稿件区；恢复历史任务时保持当前滚动位置。
  const [focusNewTask, setFocusNewTask] = useState(false)
  // 2026-10-23：本次修改原因：生成后直接编辑标题、摘要和 Markdown 正文，并显示保存状态。
  const [editing, setEditing] = useState(false)
  const [draftTitle, setDraftTitle] = useState('')
  const [draftSummary, setDraftSummary] = useState('')
  const [draftBody, setDraftBody] = useState('')
  const [draftBusy, setDraftBusy] = useState(false)
  const [draftError, setDraftError] = useState('')
  const [draftMessage, setDraftMessage] = useState('')

  useEffect(() => {
    const valid = (kind: ContentOption['kind'], current: string) =>
      active(kind).some((item) => item.id === current) ? current : active(kind)[0]?.id ?? ''
    setCategoryId((current) => valid('category', current))
    setAudienceId((current) => valid('audience', current))
    setFormatId((current) => valid('format', current))
    setPlatformId((current) => valid('platform', current))
  }, [options])

  // 2026-10-23：本次修改原因：仅在下拉框中提供已启用品牌。
  useEffect(() => {
    getBrands(false).then(setBrands).catch((reason) =>
      setBrandError(reason instanceof Error ? reason.message : '品牌读取失败'))
    getStrategies().then((items) => setPublishedStrategies(items.filter((item) => item.status === 'published')))
      .catch((reason) => setStrategyError(reason instanceof Error ? reason.message : '策略列表读取失败'))
  }, [])

  const selectedBrand = brands.find((item) => item.id === brandId)
  // 2026-10-23：本次修改原因：只向用户提供适用于当前平台、类目和内容形式的策略。
  const compatibleStrategies = publishedStrategies.filter((item) =>
    item.platform_id === platformId && (!item.category_id || item.category_id === categoryId) &&
    (!item.format_id || item.format_id === formatId))
  const previewStrategy = strategyChoice
    ? compatibleStrategies.find((item) => item.id === strategyChoice) ?? null : strategy

  useEffect(() => { setStrategyChoice('') }, [platformId, categoryId, formatId])

  useEffect(() => {
    if (!platformId || !categoryId || !formatId) {
      setStrategy(null)
      return
    }
    let current = true
    setStrategyLoading(true)
    setStrategyError('')
    getMatchingStrategy(platformId, categoryId, formatId)
      .then((value) => { if (current) setStrategy(value) })
      .catch((reason) => { if (current) setStrategyError(reason instanceof Error ? reason.message : '策略读取失败') })
      .finally(() => { if (current) setStrategyLoading(false) })
    return () => { current = false }
  }, [platformId, categoryId, formatId])

  // 2026-10-23：本次修改原因：返回生成页时恢复最近任务及其已保存修订稿。
  useEffect(() => {
    const previousId = window.localStorage.getItem('ai4geo.lastTaskId')
    if (!previousId) return
    getWorkspaceTask(previousId).then(setTask).catch(() =>
      window.localStorage.removeItem('ai4geo.lastTaskId'))
  }, [])

  useEffect(() => {
    if (!task || !['pending', 'running'].includes(task.status)) return
    const timer = window.setInterval(() => {
      getWorkspaceTask(task.task_id).then(setTask).catch((reason) =>
        setError(reason instanceof Error ? reason.message : '任务刷新失败'))
    }, 2500)
    return () => window.clearInterval(timer)
  }, [task?.task_id, task?.status])

  useEffect(() => {
    if (!task || !['completed', 'failed'].includes(task.status)) return
    getWorkspaceResult(task.task_id).then(setResult).catch((reason) =>
      setError(reason instanceof Error ? reason.message : '结果读取失败'))
  }, [task?.task_id, task?.status])

  // 2026-10-23：本次修改原因：查询结果时优先载入上次保存的人工修订稿。
  useEffect(() => {
    if (!result) return
    setDraftTitle(result.edited_title ?? result.title ?? '')
    setDraftSummary(result.edited_summary ?? result.summary ?? '')
    setDraftBody(result.edited_body_markdown ?? result.body_markdown ?? '')
    setEditing(false)
    setDraftError('')
  }, [result])

  // 2026-10-23：本次修改原因：在任务卡片真正渲染后再滚动，避免长简报遮住新任务的反馈。
  useEffect(() => {
    if (!focusNewTask || !task) return
    const frame = window.requestAnimationFrame(() => {
      document.getElementById('latest-result')?.scrollIntoView({
        behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth',
        block: 'start',
      })
      setFocusNewTask(false)
    })
    return () => window.cancelAnimationFrame(frame)
  }, [focusNewTask, task?.task_id])

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError('')
    setResult(null)
    setTask(null)
    setBusy(true)
    try {
      const created = await createWorkspaceTask({
        topic: topic.trim(),
        category_id: categoryId,
        audience_id: audienceId,
        format_id: formatId,
        platform_id: platformId,
        content_type: label(formatId),
        audience: label(audienceId),
        channel: label(platformId),
        target_words: Number(targetWords),
        tone: tone.trim() || null,
        extra_prompt: extraPrompt.trim() || null,
        // 2026-10-23：本次修改原因：后端由品牌 ID 读取已启用版本并冻结快照。
        brand_id: brandId || null,
        // 2026-10-23：本次修改原因：将人工选定的策略 ID 交由后端再次校验并冻结。
        strategy_id: strategyChoice || null,
      })
      // 2026-10-23：本次修改原因：记录最近任务以便刷新页面后继续编辑。
      window.localStorage.setItem("ai4geo.lastTaskId", created.task_id)
      setTask(created)
      // 2026-10-23：本次修改原因：任务提交成功后立即呈现进度区域。
      setFocusNewTask(true)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '创建任务失败')
    } finally {
      setBusy(false)
    }
  }

  // 2026-10-23：本次修改原因：编辑内容由后端持久化，保存失败时保留当前输入。
  async function saveDraft(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!result) return
    setDraftError('')
    setDraftMessage('')
    setDraftBusy(true)
    try {
      const saved = await saveWorkspaceDraft(result.task_id, {
        title: draftTitle.trim(), summary: draftSummary.trim(), body_markdown: draftBody.trim(),
      })
      setResult(saved)
      setDraftMessage('修改已保存。AI 原稿仍可在下方查看。')
    } catch (reason) {
      setDraftError(reason instanceof Error ? reason.message : '保存修改失败')
    } finally {
      setDraftBusy(false)
    }
  }

  async function copyArticle() {
    if (!result) return
    try {
      // await navigator.clipboard.writeText([result.title, result.summary, result.body_markdown].filter(Boolean).join('\n\n')) // 2026-10-23：原始复制逻辑保留供对照。
      // 2026-10-23：本次修改原因：复制当前可见版本，编辑中复制尚未保存的文本。
      await navigator.clipboard.writeText([draftTitle, draftSummary, draftBody].filter(Boolean).join('\n\n'))
      setCopyMessage('已复制到剪贴板')
    } catch {
      setCopyMessage('复制失败，请手动选择正文')
    }
  }

  return <>
    <div className="pageHeading">
      {/* <div><p className="kicker">CREATE / 内容生成</p><h1>让每篇内容都有依据可循</h1> 2026-10-23：原装饰性页眉保留供对照。 */}
      {/* 2026-10-23：本次修改原因：页面标题使用明确的任务名称，当前任务有结果时提供直达入口。 */}
      <div><h1>内容生成</h1>
        <p>选择内容定位与目标平台，系统会匹配已审核的写作策略，再生成可编辑初稿。</p></div>
      {/* <span className="headingIndex">01 / 04</span> 2026-10-23：原四页编号暂留供对照。 */}
      {/* 2026-10-23：本次修改原因：导航增加品牌库，更新页面总数。 */}
      <span className="headingIndex">01 / 05</span>
      {/* 2026-10-23：本次修改原因：恢复最近任务后可直接跳到稿件，减少重新滚过简报的操作。 */}
      {task && <a className="secondaryButton pageHeadingAction" href="#latest-result">查看当前稿件</a>}
    </div>

    <div className="editorGrid">
      <section className="card formCard">
        {/* <div className="sectionHeading"><div><span className="stepTag">01</span><h2>填写内容简报</h2></div> 2026-10-23：原分步标题保留供对照。 */}
        {/* 2026-10-23：本次修改原因：简报标题直接表明表单用途，去掉视觉分步装饰。 */}
        <div className="sectionHeading"><div><h2>创作简报</h2></div>
          <p>具体选题决定文章写什么，类目决定它属于哪个领域。</p></div>
        <form className="contentForm" onSubmit={submit}>
          <label className="field full"><span>具体选题 <em>*</em></span>
            <input value={topic} onChange={(event) => setTopic(event.target.value)}
              placeholder="例如：久坐上班族如何安排日常活动" required maxLength={200} />
            {/* <small>写清楚要解决的问题，生成结果会更聚焦。</small> 2026-10-23：原重复提示暂留供对照。 */}
          </label>
          <label className="field"><span>内容类目</span>
            <select value={categoryId} onChange={(event) => setCategoryId(event.target.value)} required>
              {active('category').map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
            </select>
          </label>
          <label className="field"><span>目标读者</span>
            <select value={audienceId} onChange={(event) => setAudienceId(event.target.value)} required>
              {active('audience').map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
            </select>
          </label>
          <label className="field"><span>内容形式</span>
            <select value={formatId} onChange={(event) => setFormatId(event.target.value)} required>
              {active('format').map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
            </select>
          </label>
          <label className="field"><span>目标平台</span>
            <select value={platformId} onChange={(event) => setPlatformId(event.target.value)} required>
              {active('platform').map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
            </select>
          </label>
          <label className="field"><span>期望篇幅 <small>约多少字</small></span>
            <input type="number" min={100} max={10000} step={100} value={targetWords}
              onChange={(event) => setTargetWords(event.target.value)} required />
          </label>
          <label className="field"><span>表达语气</span>
            <input value={tone} onChange={(event) => setTone(event.target.value)}
              placeholder="例如：专业、自然、易读" maxLength={100} />
          </label>
          {/* 2026-10-23：本次修改原因：将经过审核的品牌事实作为可选生成资料。 */}
          <label className="field full"><span>推荐品牌 <small>可选</small></span>
            <select value={brandId} onChange={(event) => setBrandId(event.target.value)}>
              <option value="">不使用品牌资料</option>
              {brands.map((item) => <option key={item.id} value={item.id}>{item.name} · V{item.version}</option>)}
            </select>
            {/* {selectedBrand && <small>{selectedBrand.description.slice(0, 160)} · {selectedBrand.facts.length} 条关键事实</small>} 2026-10-23：原长品牌摘要保留供对照。 */}
            {/* 2026-10-23：本次修改原因：品牌选择后只保留版本与事实数量，详情在品牌库查看。 */}
            {selectedBrand && <small>V{selectedBrand.version} · {selectedBrand.facts.length} 条关键事实</small>}
            {brandError && <small className="alert error">{brandError}</small>}
            <small><a className="inlineLink" href="#/brands">管理品牌资料 ↗</a></small>
          </label>
          {/* 2026-10-23：本次修改原因：提供自动匹配与人工指定策略版本两种使用方式。 */}
          <label className="field full"><span>写作策略</span>
            <select value={strategyChoice} onChange={(event) => setStrategyChoice(event.target.value)}>
              <option value="">自动匹配当前定位</option>
              {compatibleStrategies.map((item) => <option key={item.id} value={item.id}>{item.title} · V{item.version}</option>)}
            </select>
            {/* <small>只显示已审核发布、适用于当前平台与类目的策略。</small> 2026-10-23：原常驻说明暂留供对照，匹配结果在右侧展示。 */}
          </label>
          <label className="field full"><span>补充写作要求 <small>可选</small></span>
            <textarea rows={4} value={extraPrompt} onChange={(event) => setExtraPrompt(event.target.value)}
              placeholder="例如：用三个小标题；结尾给读者一份可执行的清单。" maxLength={3000} />
            {/* <small>补充要求影响表达方式；具体事实仍需要可信资料支持。</small> 2026-10-23：原常驻说明暂留供对照。 */}
          </label>
          <div className="formActions">
            <button className="primaryButton" type="submit" disabled={busy || !categoryId || !audienceId || !formatId || !platformId}>
              {busy ? '正在创建任务…' : '生成内容初稿'} <span aria-hidden="true">↗</span>
            </button>
            <span>生成后仍需人工审核</span>
          </div>
        </form>
      </section>

      <aside className="card strategyPreview">
        {/* <div className="sectionHeading compact"><div><span className="stepTag teal">02</span><h2>本次创作策略</h2></div></div> 2026-10-23：原分步标题保留供对照。 */}
        {/* 2026-10-23：本次修改原因：策略侧栏只展示选择结论，完整规则按需展开。 */}
        <div className="sectionHeading compact"><div><h2>写作策略</h2></div></div>
        <div className="selectionLine">{label(platformId) || '目标平台'} <span>·</span> {label(categoryId) || '内容类目'} <span>·</span> {label(formatId) || '内容形式'}</div>
        {strategyLoading && !strategyChoice ? <p className="muted">正在匹配已发布策略…</p> : strategyError ?
          <p className="alert error" role="alert">{strategyError}</p> : previewStrategy ? <>
            <div className="strategyStatus"><span className="statusDot" /> {strategyChoice ? '已选择' : '已匹配'}审核通过的策略 <strong>V{previewStrategy.version}</strong></div>
            <h3>{previewStrategy.title}</h3>
            {/* <dl className="guideList">{guideLabels.map(([key, title]) => <div key={key}> 2026-10-23：原常驻规则列表保留供对照。 */}
            {/* 2026-10-23：本次修改原因：完整策略只在用户主动查看时展开，保持创作简报的信息密度。 */}
            <details className="strategyDetails"><summary>查看写作规则</summary><dl className="guideList">{guideLabels.map(([key, title]) => <div key={key}>
              <dt>{title}</dt><dd>{previewStrategy.guide[key]}</dd>
            {/* </div>)}</dl> 2026-10-23：原常驻规则列表结束标签保留供对照。 */}
            </div>)}</dl></details>
            {/* <p className="subtle">提交任务时会固定此策略版本；之后修改策略不会改变已提交任务。</p> 2026-10-23：原重复版本说明保留供对照。 */}
          </> : <div className="emptyStrategy"><span className="emptyGlyph">◇</span>
            <h3>暂无匹配的已发布策略</h3><p>本次将使用通用写作规则。可先在“样本库”录入内容，再到“内容策略”提炼并发布。</p>
            <a href="#/strategies" className="inlineLink">前往内容策略 →</a>
          </div>}
      </aside>
    </div>

    {/* {(task || error) && <section className="card taskCard"> 2026-10-23：原稿件容器标签保留供对照。 */}
    {/* 2026-10-23：本次修改原因：为当前稿件提供直达锚点，生成后编辑和预览入口保持原有逻辑。 */}
    {(task || error) && <section className="card taskCard" id="latest-result">
      {/* <div className="sectionHeading compact"><div><span className="stepTag">03</span><h2>生成结果</h2></div> 2026-10-23：原分步标题保留供对照。 */}
      <div className="sectionHeading compact"><div><h2>当前稿件</h2></div>
        {task && <span className={`statusPill ${task.status}`}>{
          { pending: '排队中', running: '生成中', completed: '已完成', failed: '生成失败' }[task.status]
        }</span>}</div>
      {error && <p className="alert error" role="alert">{error}</p>}
      {task && <div className="taskMeta"><span>任务 {task.task_id.slice(0, 8)}</span>
        <span>策略 {task.request.strategy_version ? `V${task.request.strategy_version}` : '通用'}</span>
        {/* 2026-10-23：本次修改原因：显示任务采用的品牌资料版本。 */}
        {task.request.brand_snapshot && <span>品牌 {task.request.brand_snapshot.name} · V{task.request.brand_snapshot.version}</span>}
        <span>{new Date(task.created_at).toLocaleString('zh-CN')}</span></div>}
      {task && (task.status === 'pending' || task.status === 'running') &&
        <p className="progressMessage"><span className="progressSpinner" /> 正在处理任务，状态会自动更新…</p>}
      {result?.error && <p className="alert error" role="alert">{result.error}</p>}
      {result?.body_markdown && <div className="articlePanel">
        {/* 2026-10-23：本次修改原因：在生成结果旁直接提供编辑入口，减少页面切换。 */}
        <div className="articleTop"><span>{result.edited_at ? "人工修订稿" : "AI 生成初稿"}</span>
          <div className="articleActions">
            {!editing && <button type="button" className="secondaryButton" onClick={() => { setEditing(true); setDraftMessage('') }}>编辑内容</button>}
            <button type="button" className="secondaryButton" onClick={() => void copyArticle()}>复制当前内容</button>
          </div></div>
        {editing ? <form className="draftEditor" onSubmit={(event) => void saveDraft(event)}>
          <label className="field"><span>文章标题</span><input value={draftTitle} onChange={(event) => setDraftTitle(event.target.value)} required maxLength={300} /></label>
          <label className="field"><span>内容摘要</span><textarea rows={3} value={draftSummary} onChange={(event) => setDraftSummary(event.target.value)} maxLength={5000} /></label>
          <label className="field"><span>文章正文 · Markdown</span><textarea rows={18} value={draftBody} onChange={(event) => setDraftBody(event.target.value)} required maxLength={30000} /></label>
          <div className="draftEditorActions"><button className="primaryButton" type="submit" disabled={draftBusy}>{draftBusy ? "正在保存…" : "保存修改"}</button>
            <button className="quietButton" type="button" onClick={() => { setDraftTitle(result.edited_title ?? result.title ?? ''); setDraftSummary(result.edited_summary ?? result.summary ?? ''); setDraftBody(result.edited_body_markdown ?? result.body_markdown ?? ''); setEditing(false); setDraftError('') }}>取消</button></div>
        </form> : <>
          <h2>{draftTitle}</h2><p className="articleSummary">{draftSummary}</p>
          <MarkdownPreview content={draftBody} />
        </>}
        {draftError && <p className="alert error" role="alert">{draftError}</p>}
        {draftMessage && <p className="alert success" role="status">{draftMessage}</p>}
        {/* 2026-10-23：本次修改原因：允许查看 AI 原稿，避免人工修订覆盖生成依据。 */}
        {result.edited_at && <details className="originalDraft"><summary>查看 AI 原稿</summary>
          <h3>{result.title}</h3><p>{result.summary}</p><pre>{result.body_markdown}</pre></details>}
        <div className="articleFoot"><span>{result.provider} / {result.model}</span>
          <span>输入 {result.input_tokens} · 输出 {result.output_tokens} Token</span>
          {result.edited_at && <span>人工修改于 {new Date(result.edited_at).toLocaleString("zh-CN")}</span>}</div>
        {result.review_required && <p className="reviewNote">当前未接入事实核查。请核对具体信息后再发布。</p>}
        {copyMessage && <p className="muted" role="status">{copyMessage}</p>}
      </div>}
    </section>}
  </>
}
