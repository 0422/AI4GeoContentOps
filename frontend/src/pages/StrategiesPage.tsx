// 2026-10-23：本次修改原因：让样本提炼结果经过编辑审核和版本发布后再指导生成。
import { useEffect, useState, type FormEvent } from 'react'
import {
  // archiveStrategy, createStrategy, extractStrategy, getStrategies, publishStrategy, updateStrategy, // 2026-10-23：原导入保留供对照。
  // 2026-10-23：本次修改原因：支持草稿重提炼和策略版本删除。
  archiveStrategy, createStrategy, deleteStrategy, extractStrategy, getStrategies, publishStrategy,
  regenerateStrategy, updateStrategy,
  type ContentOption, type ContentStrategy, type StrategyGuide,
} from '../workspaceApi'
// 2026-10-23：本次修改原因：策略页直接列出可勾选的已录入样本。
import { getSamples, type ContentSample } from '../workspaceApi'
// 2026-10-23：本次修改原因：由内容策略页处理样本库移交的候选文章和全文分析。
import { analyzeStrategyCandidate, type StrategyCandidateInput } from '../workspaceApi'

const emptyGuide: StrategyGuide = {
  title_rule: '', keyword_rule: '', language_rule: '', structure_rule: '', avoid_rule: '',
}
const guideFields: { key: keyof StrategyGuide; label: string; hint: string }[] = [
  { key: 'title_rule', label: '标题方向', hint: '标题如何呈现信息价值或阅读入口' },
  { key: 'keyword_rule', label: '关键词使用', hint: '围绕选题自然安排，不堆砌热词' },
  // { key: 'language_rule', label: '遣词造句', hint: '语气、句长、术语解释与读者距离' }, // 2026-10-23：原标签暂留供对照。
  // { key: 'structure_rule', label: '行文结构', hint: '开头、段落、小标题和结尾安排' }, // 2026-10-23：原标签暂留供对照。
  // 2026-10-23：本次修改原因：让语气和内容编排在策略编辑中明确可见。
  { key: 'language_rule', label: '遣词造句与语气', hint: '语气、句长、术语解释与读者距离' },
  { key: 'structure_rule', label: '行文结构与编排', hint: '开头、段落、小标题和结尾安排' },
  { key: 'avoid_rule', label: '应避免', hint: '套话、夸张表达或不适合该平台的写法' },
]

export default function StrategiesPage({ options }: { options: ContentOption[] }) {
  const active = (kind: ContentOption['kind']) => options.filter((item) => item.kind === kind && item.active)
  const label = (id: string | null) => options.find((item) => item.id === id)?.label ?? '通用'
  const [strategies, setStrategies] = useState<ContentStrategy[]>([])
  // 2026-10-23：本次修改原因：一至六篇样本由用户明确选定，不再由后端暗中挑选。
  const [samples, setSamples] = useState<ContentSample[]>([])
  const [sampleIds, setSampleIds] = useState<string[]>([])
  const [platformId, setPlatformId] = useState('')
  const [categoryId, setCategoryId] = useState('')
  const [formatId, setFormatId] = useState('')
  const [selected, setSelected] = useState<ContentStrategy | null>(null)
  const [title, setTitle] = useState('')
  const [guide, setGuide] = useState<StrategyGuide>(emptyGuide)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  // 2026-10-23：本次修改原因：删除动作和反馈都放在策略版本列表，避免反馈落到编辑表单。
  const [listNotice, setListNotice] = useState('')
  const [listError, setListError] = useState('')
  // 2026-10-23：本次修改原因：自动分析失败时保留候选，支持重试或回样本库补正文。
  const [pendingCandidate, setPendingCandidate] = useState<StrategyCandidateInput | null>(null)

  useEffect(() => {
    setPlatformId((current) => active('platform').some((item) => item.id === current) ? current : active('platform')[0]?.id ?? '')
  }, [options])

  useEffect(() => {
    // getStrategies().then(setStrategies).catch((reason) => setError(reason instanceof Error ? reason.message : '策略读取失败')) // 2026-10-23：原异步列表加载暂留供对照。
    // 2026-10-23：本次修改原因：候选分析可能先于列表请求完成；合并列表避免新草稿被旧响应覆盖。
    getStrategies().then((items) => setStrategies((current) => {
      const received = new Set(items.map((item) => item.id))
      return [...current.filter((item) => !received.has(item.id)), ...items]
    })).catch((reason) =>
      setError(reason instanceof Error ? reason.message : '策略读取失败'))
    // 2026-10-23：本次修改原因：页面打开时读取现有样本供勾选。
    getSamples().then(setSamples).catch((reason) =>
      setError(reason instanceof Error ? reason.message : '样本读取失败'))
  }, [])

  // 2026-10-23：本次修改原因：样本库候选进入本页后再按需获取全文、提炼策略。
  useEffect(() => {
    const pending = sessionStorage.getItem('ai4geo.strategyCandidate')
    if (!pending) return
    sessionStorage.removeItem('ai4geo.strategyCandidate')
    try {
      const candidate = JSON.parse(pending) as StrategyCandidateInput
      setPendingCandidate(candidate)
      setPlatformId('platform_01')
      setCategoryId(candidate.category_id)
      setFormatId(candidate.format_id ?? '')
      void runCandidate(candidate)
    } catch {
      setError('候选信息无法读取，请从样本库重新选择。')
    }
  }, [])

  function useStrategy(item: ContentStrategy) {
    // 2026-10-23：本次修改原因：查看已有策略时同步显示其来源样本选择。
    setSampleIds(item.sample_ids)
    setSelected(item)
    setPlatformId(item.platform_id)
    setCategoryId(item.category_id ?? '')
    setFormatId(item.format_id ?? '')
    setTitle(item.title)
    setGuide(item.guide)
    setError('')
    setMessage('')
    // 2026-10-23：本次修改原因：选中其他版本时清理上一条删除反馈。
    setListNotice('')
    setListError('')
  }

  function startNew() {
    // 2026-10-23：本次修改原因：新策略不沿用上一版本的样本勾选。
    setSampleIds([])
    setSelected(null)
    setTitle('')
    setGuide(emptyGuide)
    setError('')
    setMessage('')
    // 2026-10-23：本次修改原因：新建策略时清理列表中的旧操作提示。
    setListNotice('')
    setListError('')
  }

  function changeScope(field: 'platform' | 'category' | 'format', value: string) {
    startNew()
    if (field === 'platform') setPlatformId(value)
    if (field === 'category') setCategoryId(value)
    if (field === 'format') setFormatId(value)
  }

  function remember(item: ContentStrategy) {
    setStrategies((current) => [item, ...current.filter((row) => row.id !== item.id)])
    useStrategy(item)
  }

  // 2026-10-23：本次修改原因：候选分析只在策略模块执行；成功后直接展示草稿供审核。
  async function runCandidate(candidate: StrategyCandidateInput) {
    setBusy(true)
    setError('')
    setMessage('')
    try {
      const item = await analyzeStrategyCandidate(candidate)
      remember(item)
      setPendingCandidate(null)
      setMessage('已从候选文章提炼待审核草稿。单篇结论请仔细核对，再决定是否发布。')
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '候选文章分析失败')
    } finally {
      setBusy(false)
    }
  }

  // 2026-10-23：本次修改原因：取全文失败时只移交标题、链接和类目，回样本库手动核对正文。
  function returnToSample(candidate: StrategyCandidateInput) {
    sessionStorage.setItem('ai4geo.sampleImportCandidate', JSON.stringify(candidate))
    window.location.hash = '#/samples'
  }

  async function extract() {
    // if (!platformId) return // 2026-10-23：原平台校验暂留供对照。
    // 2026-10-23：本次修改原因：明确要求至少勾选一篇符合当前范围的样本。
    if (!platformId || sampleIds.length === 0) return
    setBusy(true)
    setError('')
    setMessage('')
    try {
      // const item = await extractStrategy({ platform_id: platformId, category_id: categoryId || null, format_id: formatId || null, sample_ids: sampleIds }) // 2026-10-23：原始始终新建草稿的流程保留供对照。
      // remember(item) // 2026-10-23：原结果处理调用保留供对照。
      // setMessage(`已从 ${item.sample_ids.length} 篇样本提炼候选策略。请检查并编辑，再发布。`) // 2026-10-23：原提示保留供对照。
      // 2026-10-23：本次修改原因：选中草稿时覆盖当前规则；已发布或停用版本只创建新草稿。
      if (selected?.status === "draft") {
        const unsaved = title !== selected.title || JSON.stringify(guide) !== JSON.stringify(selected.guide)
        if (!window.confirm(unsaved
          ? "编辑区有未保存的规则。重新提炼会覆盖当前草稿与这些修改，继续吗？"
          : "重新提炼会覆盖当前草稿的五项规则，继续吗？")) return
      }
      const item = selected?.status === "draft"
        ? await regenerateStrategy(selected.id, sampleIds)
        : await extractStrategy({
            platform_id: platformId, category_id: categoryId || null, format_id: formatId || null,
            sample_ids: sampleIds,
          })
      remember(item)
      setMessage(selected?.status === "draft"
        ? `当前草稿已按 ${item.sample_ids.length} 篇样本重新提炼，请检查规则后发布。`
        : `已从 ${item.sample_ids.length} 篇样本创建新草稿，请检查规则后发布。`)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '提炼失败')
    } finally {
      setBusy(false)
    }
  }

  // 2026-10-23：本次修改原因：只展示当前范围内、已确认使用权且评分合格的样本。
  const eligibleSamples = samples.filter((sample) => sample.platform_id === platformId &&
    (!categoryId || sample.category_id === categoryId) &&
    (!formatId || sample.format_id === null || sample.format_id === formatId) &&
    sample.rights_confirmed && sample.quality_score >= 4)

  function toggleSample(id: string) {
    setSampleIds((current) => current.includes(id) ? current.filter((value) => value !== id) : [...current, id])
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setBusy(true)
    setError('')
    setMessage('')
    try {
      const item = selected
        ? await updateStrategy(selected.id, title.trim(), guide)
        : await createStrategy({
            title: title.trim(), platform_id: platformId,
            category_id: categoryId || null, format_id: formatId || null, guide,
          })
      remember(item)
      setMessage('草稿已保存。检查无误后可发布。')
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '保存策略失败')
    } finally {
      setBusy(false)
    }
  }

  async function publish() {
    if (!selected || selected.status !== 'draft') return
    setBusy(true)
    setError('')
    setMessage('')
    try {
      const saved = await updateStrategy(selected.id, title.trim(), guide)
      const item = await publishStrategy(saved.id)
      remember(item)
      setMessage(`策略 V${item.version} 已发布，匹配的新任务会使用它。`)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '发布失败')
    } finally {
      setBusy(false)
    }
  }

  async function archive() {
    if (!selected || selected.status !== 'published') return
    if (!window.confirm('停用此策略版本？后续任务将匹配其他已发布版本或通用规则。')) return
    setBusy(true)
    setError('')
    try {
      const item = await archiveStrategy(selected.id)
      remember(item)
      setMessage('策略已停用。已有任务仍保留原策略快照。')
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '停用失败')
    } finally {
      setBusy(false)
    }
  }

  // 2026-10-23：本次修改原因：删除策略后从列表移除，并保持已提交任务的策略快照。
  async function remove() {
    if (!selected || busy) return
    const item = selected
    const impact = item.status === "published"
      ? "已发布策略将立即停止用于新任务；已提交任务仍保留原策略快照。"
      : "此版本会从策略列表移除；已提交任务仍保留原策略快照。"
    if (!window.confirm(`确定删除「${item.title}」V${item.version}？${impact}`)) return
    setBusy(true)
    setError('')
    // 2026-10-23：本次修改原因：清理版本列表中的上次删除反馈。
    setListError('')
    setListNotice('')
    try {
      await deleteStrategy(item.id)
      setStrategies((current) => current.filter((row) => row.id !== item.id))
      startNew()
      // setMessage('已从策略列表删除该版本。') // 2026-10-23：原反馈位置保留供对照。
      // 2026-10-23：本次修改原因：删除成功提示紧邻版本列表。
      setListNotice('已从策略列表删除该版本。')
    } catch (reason) {
      // setError(reason instanceof Error ? reason.message : '删除策略失败') // 2026-10-23：原错误位置保留供对照。
      // 2026-10-23：本次修改原因：删除失败也在版本列表就地说明。
      setListError(reason instanceof Error ? reason.message : '删除策略失败')
    } finally {
      setBusy(false)
    }
  }

  return <>
    <div className="pageHeading">
      {/* <div><p className="kicker">PLAYBOOK / 内容策略</p><h1>把样本经验变成可审核的规则</h1> 2026-10-23：原装饰性页眉保留供对照。 */}
      {/* 2026-10-23：本次修改原因：统一五个页面的标题层级。 */}
      <div><h1>内容策略</h1>
        <p>模型先提炼候选写法；你编辑确认并发布后，生成任务才会调用。</p></div>
      {/* <span className="headingIndex">03 / 04</span> 2026-10-23：原四页编号暂留供对照。 */}
      {/* 2026-10-23：本次修改原因：导航增加品牌库，更新页面总数。 */}
      <span className="headingIndex">03 / 05</span>
    </div>
    <div className="infoBanner"><span className="bannerIcon">i</span>
      {/* “从样本提炼”会调用当前默认模型并消耗额度。每组范围至少需要两篇匹配且编辑评分不低于 4 分的样本；样本正文不会直接作为生成提示词。 2026-10-23：原两篇门槛暂留供对照。 */}
      {/* 2026-10-23：本次修改原因：如实说明单篇样本也能提炼草稿及其代表性限制。 */}
      从下方勾选 1–6 篇已确认使用权、评分至少 4 分的样本，再调用默认模型提炼。单篇只能提供初步写法参考；草稿审核发布后才参与生成。
    </div>
    {/* 2026-10-23：本次修改原因：候选获取与分析过程及失败回退集中展示在策略页。 */}
    {pendingCandidate && <section className="card candidateHandoff">
      <div><strong>正在处理候选：{pendingCandidate.title}</strong>
        <p className="subtle">先获取文章全文，再生成待审核的写法草稿。搜索结果中的摘要不会被当作全文。</p></div>
      <div className="scopeActions">
        <button type="button" className="secondaryButton" onClick={() => void runCandidate(pendingCandidate)} disabled={busy}>
          {busy ? '正在获取与分析…' : '重试全文分析'}</button>
        <button type="button" className="textButton" onClick={() => returnToSample(pendingCandidate)} disabled={busy}>回样本库补正文</button>
      </div>
      {error && <p className="alert error" role="alert">{error}</p>}
    </section>}
    <div className="strategyLayout">
      <section className="card">
        {/* <div className="sectionHeading"><div><span className="stepTag">01</span><h2>选择策略适用范围</h2></div></div> 2026-10-23：原分步标题保留供对照。 */}
        {/* 2026-10-23：本次修改原因：把范围与选样表述成同一件事，降低表单理解成本。 */}
        <div className="sectionHeading"><div><h2>范围与参考样本</h2></div></div>
        <div className="scopeGrid">
          <label className="field"><span>目标平台</span>
            <select value={platformId} onChange={(event) => changeScope('platform', event.target.value)}>
              {active('platform').map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
            </select>
          </label>
          <label className="field"><span>内容类目</span>
            <select value={categoryId} onChange={(event) => changeScope('category', event.target.value)}>
              <option value="">平台通用</option>
              {active('category').map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
            </select>
          </label>
          <label className="field"><span>内容形式</span>
            <select value={formatId} onChange={(event) => changeScope('format', event.target.value)}>
              <option value="">形式通用</option>
              {active('format').map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
            </select>
          </label>
        </div>
        {/* 2026-10-23：本次修改原因：在策略适用范围下直接列出可用样本，避免隐藏的自动筛选。 */}
        <div className="sampleChooser"><div className="sampleChooserHead"><strong>选择参考样本</strong><span>已选 {sampleIds.length} / 6 篇</span></div>
          {/* {eligibleSamples.length === 0 ? <p className="subtle">当前范围没有可选样本。可调整类目和形式，或先到样本库录入评分至少 4 分的文章。</p> : 2026-10-23：原空状态文案保留供对照。 */}
          {/* 2026-10-23：本次修改原因：空状态直接说明选样门槛，避免在页面顶部长期占用提示区域。 */}
          {eligibleSamples.length === 0 ? <p className="subtle">暂无可选样本。请调整范围，或录入已确认使用权且评分至少 4 分的文章。</p> :
            <div className="sampleChooserList">{eligibleSamples.map((sample) => <label className="sampleChooserItem" key={sample.id}>
              <input type="checkbox" checked={sampleIds.includes(sample.id)}
                disabled={sampleIds.length >= 6 && !sampleIds.includes(sample.id)} onChange={() => toggleSample(sample.id)} />
              <span><strong>{sample.title}</strong><small>{label(sample.category_id)} · {label(sample.format_id)} · {sample.quality_score} / 5 分</small></span>
            </label>)}</div>}
          {sampleIds.length === 1 && <p className="subtle">单篇策略应重点检查是否过度概括。</p>}
          {/* 2026-10-23：本次修改原因：解释改变参考样本后当前草稿或已发布版本分别会发生什么。 */}
          {selected && <p className="subtle">当前版本依据 {selected.sample_ids.length} 篇入库样本。
            {selected.status === "draft" ? "增减勾选后可重新提炼当前草稿。" : "增减勾选后会创建新草稿，当前版本保持原样。"}</p>}
        </div>
        <div className="scopeActions">
          {/* <button type="button" className="secondaryButton" onClick={() => void extract()} disabled={busy || !platformId}>{busy ? '处理中…' : '从匹配样本提炼'}</button> 2026-10-23：原按钮暂留供对照。 */}
          {/* 2026-10-23：本次修改原因：按钮明确作用于已勾选样本。 */}
          <button type="button" className="secondaryButton" onClick={() => void extract()} disabled={busy || !platformId || sampleIds.length === 0}>
            {/* {busy ? '处理中…' : `从所选 ${sampleIds.length} 篇样本提炼`} 2026-10-23：原按钮文案保留供对照。 */}
            {/* 2026-10-23：本次修改原因：按钮直接说明是覆盖当前草稿还是新建版本。 */}
            {busy ? "处理中…" : selected?.status === "draft"
              ? `按 ${sampleIds.length} 篇样本重新提炼当前草稿`
              : `以 ${sampleIds.length} 篇样本创建新草稿`}
          </button>
          <button type="button" className="textButton" onClick={startNew}>新建空白策略</button>
        </div>
        <div className="divider" />
        <div className="sectionHeading compact"><div><span className="stepTag teal">02</span><h2>策略版本</h2></div>
          {/* <span className="countBadge">{strategies.length}</span> 2026-10-23：原独立计数保留供对照。 */}
          {/* 2026-10-23：本次修改原因：选中列表项后在同一区域直接删除，按钮文案明确作用对象。 */}
          <div className="strategyListHeaderActions"><span className="countBadge">{strategies.length}</span>
            <button type="button" className="dangerButton compact" disabled={!selected || busy}
              title={selected ? `删除「${selected.title}」V${selected.version}` : "请先选择策略版本"}
              onClick={() => void remove()}>删除选中版本</button></div></div>
        {strategies.length === 0 ? <div className="emptyState"><span>◇</span><h3>还没有内容策略</h3>
          <p>先录入样本，或者直接写一份平台通用策略。</p></div> :
          <div className="strategyList">{strategies.map((item) => <button type="button" key={item.id}
            className={selected?.id === item.id ? 'strategyListItem selected' : 'strategyListItem'}
            onClick={() => useStrategy(item)}>
            <span className="strategyListTop"><strong>{item.title}</strong><em className={`miniStatus ${item.status}`}>{
              { draft: '草稿', published: '已发布', archived: '已停用' }[item.status]
            }</em></span>
            {/* <span className="strategyListMeta">{label(item.platform_id)} · {label(item.category_id)} · {label(item.format_id)} · V{item.version}</span> 2026-10-23：原版本信息保留供对照。 */}
            {/* 2026-10-23：本次修改原因：列表直接显示每条策略的参考样本数量。 */}
            <span className="strategyListMeta">{label(item.platform_id)} · {label(item.category_id)} · {label(item.format_id)} · V{item.version} · 样本 {item.sample_ids.length} 篇</span>
          </button>)}</div>}
        {/* 2026-10-23：本次修改原因：删除操作的结果直接显示在策略版本列表下方。 */}
        {listError && <p className="alert error" role="alert">{listError}</p>}
        {listNotice && <p className="alert success" role="status">{listNotice}</p>}
      </section>

      <section className="card strategyEditor">
        <div className="sectionHeading"><div><span className="stepTag">03</span><h2>{selected ? `编辑策略 V${selected.version}` : '编写新策略'}</h2></div>
          {selected && <span className={`statusPill ${selected.status}`}>{
            { draft: '待审核', published: '已发布', archived: '已停用' }[selected.status]
          }</span>}</div>
        <form className="guideForm" onSubmit={save}>
          <label className="field"><span>策略名称</span>
            <input value={title} onChange={(event) => setTitle(event.target.value)}
              placeholder="例如：公众号 · 健康科普" maxLength={200} required disabled={selected !== null && selected.status !== 'draft'} />
          </label>
          {guideFields.map((field) => <label className="field" key={field.key}><span>{field.label}</span>
            <textarea rows={3} value={guide[field.key]} onChange={(event) =>
              setGuide((current) => ({ ...current, [field.key]: event.target.value }))}
              placeholder={field.hint} maxLength={1500} required
              disabled={selected !== null && selected.status !== 'draft'} />
          </label>)}
          <div className="guideActions">
            {(!selected || selected.status === 'draft') && <button type="submit" className="secondaryButton" disabled={busy}>保存草稿</button>}
            {selected?.status === 'draft' && <button type="button" className="primaryButton" disabled={busy}
              onClick={() => void publish()}>审核通过并发布</button>}
            {selected?.status === 'published' && <button type="button" className="quietButton" disabled={busy}
              onClick={() => void archive()}>停用此版本</button>}
            {/* 2026-10-23：原删除按钮位于 03 编辑区，按用户使用路径移至 02 策略版本区。
            {selected && <button type="button" className="dangerButton" disabled={busy}
              onClick={() => void remove()}>删除此版本</button>}
            */}
          </div>
        </form>
        {/* {selected && <p className="subtle">来源样本 {selected.sample_ids.length} 篇 · 创建于 {new Date(selected.created_at).toLocaleString('zh-CN')}</p>} 2026-10-23：原展示仅统计手动样本，暂留供对照。 */}
        {/* 2026-10-23：本次修改原因：显示自动分析的文章来源，方便审核者回看原文。 */}
        {/* {selected && <p className="subtle">来源样本 {selected.sample_ids.length} 篇 · 自动分析文章 {selected.references.length} 篇 · 创建于 {new Date(selected.created_at).toLocaleString('zh-CN')}</p>} 2026-10-23：原重复元数据保留供对照，列表与来源展开区已提供所需信息。 */}
        {/* 2026-10-23：本次修改原因：来源清单改为按需展开，复杂策略表单默认聚焦规则内容。 */}
        {selected && (selected.sample_ids.length > 0 || selected.references.length > 0) && <details className="referenceDetails">
          <summary>查看参考来源（{selected.sample_ids.length + selected.references.length}）</summary>
        {/* 2026-10-23：本次修改原因：编辑区列出当前版本引用的样本，便于检查重提炼依据。 */}
        {selected && selected.sample_ids.length > 0 && <div className="strategyReferences">
          <strong>当前版本参考样本</strong>{selected.sample_ids.map((id) =>
            <span key={id}>{samples.find((sample) => sample.id === id)?.title ?? `样本 ${id.slice(0, 8)}`}</span>)}
        </div>}
        {selected && selected.references.length > 0 && <div className="strategyReferences">
          <strong>参考原文</strong>{selected.references.map((reference) =>
            <a key={reference.source_url} href={reference.source_url} target="_blank" rel="noreferrer">{reference.title} ↗</a>)}
        </div>}
        </details>}
        {error && <p className="alert error" role="alert">{error}</p>}
        {message && <p className="alert success" role="status">{message}</p>}
      </section>
    </div>
  </>
}
