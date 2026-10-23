// 2026-10-23：本次修改原因：候选收录、手动录入和样本复核共用同一张字段确认弹窗。
import { useEffect, useState, type FormEvent } from 'react'
import type { ContentOption } from '../workspaceApi'
import type { ArticleMetric } from '../articleLibraryApi'

// 2026-10-24：本次修改原因：发现、收录确认和样本编辑使用同一组来源文章指标名称。
const sourceMetricLabels = { reads: '阅读', likes: '点赞', watch_count: '在看',
  comments: '评论', shares: '分享', saves: '收藏', reward_count: '打赏',
  interactive_count: '互动量' } as const
const sourceMetricKeys = Object.keys(sourceMetricLabels) as (keyof typeof sourceMetricLabels)[]

export interface ArticleEditorValue {
  title: string
  body_text: string
  platform_id: string
  category_id: string
  format_id: string
  source_url: string
  quality_score: number
  rights_confirmed: boolean
  author_id: string
  account_followers: string
  published_at: string
  audience_id: string
  topic: string
  tags: string
  usage_rights_note: string
  review_status: 'pending' | 'ready' | 'excluded'
  metric_source: string
  // 2026-10-24：本次修改原因：关键词接口 syncTime 作为该次指标观测时间保存。
  metric_captured_at: string
  reads: string
  likes: string
  // 2026-10-24：本次修改原因：候选的在看数和近似原始值随文章保存供后续复核。
  watch_count: string
  comments: string
  shares: string
  // 2026-10-24：本次修改原因：关键词收藏/打赏及榜单互动量与其他已显示读数一起确认和保存。
  saves: string
  reward_count: string
  interactive_count: string
  raw_counts: Record<string, string>
  source_data: Record<string, unknown>
}

export function blankArticleEditor(platformId = '', categoryId = ''): ArticleEditorValue {
  return { title: '', body_text: '', platform_id: platformId, category_id: categoryId,
    format_id: '', source_url: '', quality_score: 4, rights_confirmed: false,
    author_id: '', account_followers: '', published_at: '', audience_id: '', topic: '', tags: '',
    usage_rights_note: '', review_status: 'pending', metric_source: '人工录入', metric_captured_at: '',
    // reads: '', likes: '', comments: '', shares: '' 2026-10-24：原指标字段保留供对照。
    // 2026-10-24：本次修改原因：为在看及原始展示值提供初始状态。
    // reads: '', likes: '', watch_count: '', comments: '', shares: '', raw_counts: {}  // 2026-10-24：原指标初始状态留作对照。
    // 2026-10-24：本次修改原因：为三种公众号查询补充来源数据及专属互动字段。
    reads: '', likes: '', watch_count: '', comments: '', shares: '', saves: '', reward_count: '',
    interactive_count: '', raw_counts: {}, source_data: {} }
}

export function editorPayload(value: ArticleEditorValue, create: boolean): Record<string, unknown> {
  // const metric = { source: value.metric_source, reads: value.reads === '' ? null : Number(value.reads),
  //   likes: value.likes === '' ? null : Number(value.likes), comments: value.comments === '' ? null : Number(value.comments),
  //   shares: value.shares === '' ? null : Number(value.shares) } 2026-10-24：原四项精确读数映射留作对照。
  // 2026-10-24：本次修改原因：保存独立在看数，并保留“10W+”等不能计算的原始展示值。
  const metric = { source: value.metric_source,
    captured_at: value.metric_captured_at || null,
    reads: value.reads === '' ? null : Number(value.reads),
    likes: value.likes === '' ? null : Number(value.likes),
    watch_count: value.watch_count === '' ? null : Number(value.watch_count),
    comments: value.comments === '' ? null : Number(value.comments),
    shares: value.shares === '' ? null : Number(value.shares),
    // 2026-10-24：本次修改原因：保存关键词收藏/打赏及榜单互动量的精确值。
    saves: value.saves === '' ? null : Number(value.saves),
    reward_count: value.reward_count === '' ? null : Number(value.reward_count),
    interactive_count: value.interactive_count === '' ? null : Number(value.interactive_count),
    raw_counts: value.raw_counts }
  // 2026-10-24：本次修改原因：手动录入与样本编辑使用同一组读数输入，编辑时有值才新增快照。
  const hasMetric = [value.reads, value.likes, value.watch_count, value.comments, value.shares,
    value.saves, value.reward_count, value.interactive_count].some(Boolean) ||
    Object.keys(value.raw_counts).length > 0
  return { title: value.title.trim(), body_text: value.body_text.trim(), platform_id: value.platform_id,
    category_id: value.category_id, format_id: value.format_id || null,
    source_url: value.source_url.trim() || null, quality_score: value.quality_score,
    rights_confirmed: value.rights_confirmed, author_id: value.author_id.trim() || null,
    account_followers: value.account_followers === '' ? null : Number(value.account_followers),
    published_at: value.published_at || null, audience_id: value.audience_id || null,
    topic: value.topic.trim() || null,
    tags: value.tags.split(/[、,，]/).map((item) => item.trim()).filter(Boolean),
    usage_rights_note: value.usage_rights_note.trim() || null, review_status: value.review_status,
    // ...(create ? { initial_metric: [value.reads, value.likes, value.comments, value.shares].some(Boolean) ? metric : null } : {}), 2026-10-24：原仅四项精确数值的判断留作对照。
    // 2026-10-24：本次修改原因：只有近似读数或粉丝数时也保留来源快照。
    // ...(create ? { initial_metric: [value.reads, value.likes, value.watch_count, value.comments, value.shares]
    //   .some(Boolean) || Object.keys(value.raw_counts).length > 0 ? metric : null } : {}),  // 2026-10-24：原快照范围留作对照。
    // 2026-10-24：本次修改原因：来源字段和所有公众号返回读数在一次请求中共同保存。
    // 2026-10-24：原仅在新建时提供互动读数快照的展开式表达留作对照。
    ...(create ? { source_data: value.source_data, initial_metric: hasMetric ? metric : null }
      : { new_metric: hasMetric ? metric : null }),
  }
}

type Props = {
  mode: 'create' | 'edit'
  initial: ArticleEditorValue
  options: ContentOption[]
  metrics?: ArticleMetric[]
  onClose: () => void
  onSave: (payload: Record<string, unknown>) => Promise<void>
  // 2026-10-24：本次修改原因：候选可先保留人工补齐内容，之后再与其他候选批量收录。
  onSaveDraft?: (value: ArticleEditorValue) => Promise<void>
  candidate?: boolean
  issue?: string
}

// export default function ArticleEditorDialog({ mode, initial, options, metrics = [], onClose, onSave, candidate = false, issue = '' }: Props) { // 2026-10-24：原参数列表留作对照。
// 2026-10-24：本次修改原因：录入弹窗在正式收录之外提供暂存待处理草稿。
export default function ArticleEditorDialog({ mode, initial, options, metrics = [], onClose, onSave, onSaveDraft, candidate = false, issue = '' }: Props) {
  const [draft, setDraft] = useState(initial)
  const [expanded, setExpanded] = useState(mode === 'edit' || !candidate)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const optionsFor = (kind: ContentOption['kind'], selected: string) =>
    options.filter((item) => item.kind === kind && (item.active || item.id === selected))
  const label = (id: string) => options.find((item) => item.id === id)?.label || '未填写'
  // 2026-10-24：本次修改原因：只读展示 RedFox 实际返回的字段，人工表单不覆盖其原始值。
  const sourceRequest = draft.source_data.request as Record<string, unknown> | undefined
  const sourceResponse = draft.source_data.response as Record<string, unknown> | undefined
  const missing = [!draft.title.trim() && '标题', draft.body_text.trim().length < 50 && '正文（至少 50 字）',
    !draft.platform_id && '来源平台', !draft.category_id && '内容类目',
    mode === 'create' && !draft.rights_confirmed && '使用权限确认'].filter(Boolean) as string[]

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === 'Escape' && !busy) onClose() }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [busy, onClose])

  async function save() {
    if (missing.length) {
      setExpanded(true)
      setError(`请补齐：${missing.join('、')}`)
      return
    }
    setBusy(true); setError('')
    try { await onSave(editorPayload(draft, mode === 'create')) }
    catch (reason) { setError(reason instanceof Error ? reason.message : '保存失败') }
    finally { setBusy(false) }
  }

  // 2026-10-24：本次修改原因：草稿允许字段暂未齐全，正式入库仍由原有校验约束。
  async function saveDraft() {
    if (!onSaveDraft) return
    setBusy(true); setError('')
    try { await onSaveDraft(draft) }
    catch (reason) { setError(reason instanceof Error ? reason.message : '暂存失败') }
    finally { setBusy(false) }
  }

  function submit(event: FormEvent<HTMLFormElement>) { event.preventDefault(); void save() }

  const update = <K extends keyof ArticleEditorValue,>(key: K, value: ArticleEditorValue[K]) =>
    setDraft((current) => ({ ...current, [key]: value }))
  // 2026-10-24：本次修改原因：确认正文可用于本项目时同步完成复核；取消确认则恢复待核对。
  function confirmRights(checked: boolean) {
    setDraft((current) => ({ ...current, rights_confirmed: checked,
      review_status: checked ? (current.review_status === 'excluded' ? 'excluded' : 'ready') : 'pending' }))
  }
  return <div className="articleDialogBackdrop" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) onClose() }}>
    <section className="articleDialog" role="dialog" aria-modal="true" aria-label={mode === 'edit' ? '查看和修改文章' : '确认收录文章'}>
      <div className="articleDialogHead"><h2>{mode === 'edit' ? '查看与修改' : candidate ? '确认收录' : '手动录入'}</h2>
        <button type="button" aria-label="关闭" className="articleDialogClose" onClick={onClose} disabled={busy}>×</button></div>
      {issue && <p className="alert warning articleDialogIssue">{issue}</p>}
      {candidate && !expanded && <div className="articleDialogReview">
        {missing.length > 0 && <div className="articleDialogMissing"><strong>待补齐</strong><span>{missing.join('、')}</span></div>}
        <dl><div><dt>标题</dt><dd>{draft.title || '未采到'}</dd></div>
          <div><dt>平台 / 类目</dt><dd>{label(draft.platform_id)} / {label(draft.category_id)}</dd></div>
          {/* <div><dt>作者 / 发布时间</dt><dd>{draft.author_id || '未采到'} / {draft.published_at || '未采到'}</dd></div> 2026-10-24：原作者行留作对照。 */}
          {/* 2026-10-24：本次修改原因：收录确认时同时核对账号粉丝数。 */}
          <div><dt>作者 / 发布</dt><dd>{draft.author_id || '未采到'} / {draft.published_at || '未采到'}
            {' · 粉丝 '}{draft.account_followers || draft.raw_counts.followers || '未采到'}</dd></div>
          <div><dt>原文</dt><dd>{draft.source_url ? <a href={draft.source_url} target="_blank" rel="noreferrer">打开来源 ↗</a> : '未采到'}</dd></div>
          <div><dt>正文</dt><dd>{draft.body_text ? `${draft.body_text.length} 字 · ${draft.body_text.slice(0, 120)}` : '未采到'}</dd></div>
          {/* 2026-10-24：本次修改原因：关键词和榜单实际返回的摘要也出现在收录确认清单。 */}
          {sourceResponse?.summary != null && <div><dt>摘要</dt><dd>{String(sourceResponse.summary)}</dd></div>}
          {/* <div><dt>指标</dt><dd>{(['reads', 'likes', 'comments', 'shares'] as const).filter((key) => draft[key] !== '')
            .map((key) => `${({ reads: '阅读', likes: '点赞', comments: '评论', shares: '分享' })[key]} ${draft[key]}`).join(' · ') || '未采到'}</dd></div> 2026-10-24：原四项精确指标预览留作对照。 */}
          {/* 2026-10-24：本次修改原因：候选原始近似值和在看数也出现在保存前确认清单。 */}
          {/* <div><dt>来源读数</dt><dd>{(['reads', 'likes', 'watch_count', 'comments', 'shares'] as const)  // 2026-10-24：原五项指标范围留作对照。 */}
          <div><dt>来源读数</dt><dd>{sourceMetricKeys
            .filter((key) => draft[key] !== '' || draft.raw_counts[key])
            .map((key) => `${sourceMetricLabels[key]} ${draft[key] || draft.raw_counts[key]}`)
            .join(' · ') || '未采到'}</dd></div></dl>
        {/* <label className="libraryCheck"><input type="checkbox" checked={draft.rights_confirmed} onChange={(event) => update('rights_confirmed', event.target.checked)} /> 2026-10-24：原仅更新权限状态的做法留作对照。 */}
        {/* 2026-10-24：本次修改原因：候选简表确认后，入库复核状态同步为可分析。 */}
        <label className="libraryCheck"><input type="checkbox" checked={draft.rights_confirmed} onChange={(event) => confirmRights(event.target.checked)} />
          我确认本项目可存储、分析和使用该正文</label>
      </div>}
      {expanded && <form id="article-editor-form" className="libraryEditForm articleDialogForm" onSubmit={(event) => void submit(event)}>
        <label>标题<input required maxLength={300} value={draft.title} onChange={(event) => update('title', event.target.value)} /></label>
        <div className="libraryFieldPair"><label>平台<select required value={draft.platform_id} onChange={(event) => update('platform_id', event.target.value)}>
          <option value="">选择平台</option>{optionsFor('platform', draft.platform_id).map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}</select></label>
          <label>类目<select required value={draft.category_id} onChange={(event) => update('category_id', event.target.value)}>
            <option value="">选择类目</option>{optionsFor('category', draft.category_id).map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}</select></label></div>
        <div className="libraryFieldPair"><label>体裁<select value={draft.format_id} onChange={(event) => update('format_id', event.target.value)}>
          <option value="">未分类</option>{optionsFor('format', draft.format_id).map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}</select></label>
          <label>目标受众<select value={draft.audience_id} onChange={(event) => update('audience_id', event.target.value)}>
            <option value="">未填写</option>{optionsFor('audience', draft.audience_id).map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}</select></label></div>
        <div className="libraryFieldPair"><label>作者或账号<input maxLength={200} value={draft.author_id} onChange={(event) => update('author_id', event.target.value)} /></label>
          <label>账号粉丝数<input type="number" min="0" value={draft.account_followers} onChange={(event) => update('account_followers', event.target.value)} />
            {/* 2026-10-24：本次修改原因：近似粉丝数留作核对，不写成精确整数。 */}
            {draft.raw_counts.followers && !draft.account_followers && <small>发现时：{draft.raw_counts.followers}</small>}</label></div>
        <div className="libraryFieldPair"><label>发布时间<input type="date" value={draft.published_at} onChange={(event) => update('published_at', event.target.value)} /></label>
          <label>主题<input maxLength={200} value={draft.topic} onChange={(event) => update('topic', event.target.value)} /></label></div>
        <label>标签（顿号或逗号分隔）<input value={draft.tags} onChange={(event) => update('tags', event.target.value)} /></label>
        <label>来源链接<input type="url" maxLength={1000} value={draft.source_url} onChange={(event) => update('source_url', event.target.value)} /></label>
        <label>正文<textarea rows={10} required minLength={50} maxLength={30000} value={draft.body_text} onChange={(event) => update('body_text', event.target.value)} /></label>
        {/* 2026-10-24：本次修改原因：接口的非正文字段随样本保存，并在同一查看/编辑弹窗里原样核对。 */}
        {sourceResponse && Object.keys(sourceResponse).length > 0 && <details className="articleSourceFields">
          {/* 2026-10-24：本次修改原因：名称与样本详情中的抓取来源字段汇总保持一致。 */}
          <summary>抓取来源字段汇总</summary>
          {sourceRequest && <><strong>请求条件</strong><dl>{Object.entries(sourceRequest).map(([key, value]) =>
            <div key={key}><dt>{key}</dt><dd>{value == null ? '未提供' : String(value)}</dd></div>)}</dl></>}
          <strong>返回字段</strong><dl>{Object.entries(sourceResponse).map(([key, value]) =>
            <div key={key}><dt>{key}</dt><dd>{value == null ? '未提供' : String(value)}</dd></div>)}</dl>
        </details>}
        <div className="libraryFieldPair"><label>编辑质量<select value={draft.quality_score} onChange={(event) => update('quality_score', Number(event.target.value))}>
          {[1, 2, 3, 4, 5].map((score) => <option key={score} value={score}>{score}/5</option>)}</select></label>
          <label>复核状态<select value={draft.review_status} onChange={(event) => update('review_status', event.target.value as ArticleEditorValue['review_status'])}>
            <option value="pending">待核对</option><option value="ready" disabled={!draft.rights_confirmed}>可分析</option>
            {mode === 'edit' && <option value="excluded">已排除</option>}</select></label></div>
        <label>使用权限说明<textarea rows={2} maxLength={2000} value={draft.usage_rights_note} onChange={(event) => update('usage_rights_note', event.target.value)} /></label>
        {/* <label className="libraryCheck"><input type="checkbox" checked={draft.rights_confirmed} onChange={(event) => setDraft((current) => ({ ...current,
          rights_confirmed: event.target.checked, review_status: event.target.checked ? current.review_status : 'pending' }))} /> 2026-10-24：原确认权限后仍保持待核对的做法留作对照。 */}
        {/* 2026-10-24：本次修改原因：完整表单和候选简表按相同规则同步复核状态。 */}
        <label className="libraryCheck"><input type="checkbox" checked={draft.rights_confirmed} onChange={(event) => confirmRights(event.target.checked)} />
          已确认本项目可存储、分析和使用该正文</label>
        {/* {mode === 'create' && <div className="articleDialogMetrics"><strong>互动数据快照</strong><span>{draft.metric_source}</span>
          <div className="libraryMetricInputs">{(['reads', 'likes', 'comments', 'shares'] as const).map((key) =>
            <label key={key}>{({ reads: '阅读', likes: '点赞', comments: '评论', shares: '分享' })[key]}
              <input type="number" min="0" value={draft[key]} onChange={(event) => update(key, event.target.value)} /></label>)}</div></div>} 2026-10-24：原四项精确读数表单留作对照。 */}
        {/* 2026-10-24：本次修改原因：明确这里保存来源文章的抓取读数，原始近似值可核对。 */}
        {/* {mode === 'create' && <div className="articleDialogMetrics">来源文章互动读数</div>} 2026-10-24：原只在录入时显示读数输入的条件留作对照。 */}
        {/* 2026-10-24：本次修改原因：手动录入和样本编辑呈现相同的可编辑读数字段，已入库文章通过新增快照保存。 */}
        <div className="articleDialogMetrics"><strong>来源读数（可选）</strong>
          <div className="libraryFieldPair"><label>数据来源<input maxLength={100} value={draft.metric_source}
            onChange={(event) => update('metric_source', event.target.value)} /></label>
            <label>观测时间<input type="datetime-local" value={draft.metric_captured_at}
              onChange={(event) => update('metric_captured_at', event.target.value)} /></label></div>
          {/* <div className="libraryMetricInputs">{(['reads', 'likes', 'watch_count', 'comments', 'shares'] as const).map((key) =>  // 2026-10-24：原五项指标表单范围留作对照。 */}
          <div className="libraryMetricInputs">{sourceMetricKeys.map((key) =>
            <label key={key}>{sourceMetricLabels[key]}
              <input type="number" min="0" value={draft[key]} onChange={(event) => update(key, event.target.value)} />
              {draft.raw_counts[key] && !draft[key] && <small>发现时：{draft.raw_counts[key]}</small>}</label>)}</div></div>
        {/* 2026-10-24：本次修改原因：样本编辑弹窗明确展示的是来源文章读数。 */}
        {/* {mode === 'edit' && metrics.length > 0 && <div className="articleDialogMetrics"><strong>已保存的来源读数</strong></div>} 2026-10-24：原常驻历史读数块留作对照。 */}
        {/* 2026-10-24：本次修改原因：历史读数按需展开，可编辑字段在录入和编辑弹窗中保持一致。 */}
        {mode === 'edit' && metrics.length > 0 && <details className="articleDialogMetrics"><summary>已保存来源读数（{metrics.length}）</summary>
          {metrics.map((item) => <div key={item.id}>{item.source} · {item.captured_at.slice(0, 10)} ·
            {/* 2026-10-24：本次修改原因：样本编辑弹窗回显关键词收藏/打赏和榜单互动量。 */}
            {sourceMetricKeys.map((key) => `${sourceMetricLabels[key]} ${item[key] ?? item.raw_counts?.[key] ?? '—'}`).join(' / ')}</div>)}</details>}
      </form>}
      {expanded && missing.length > 0 && <div className="articleDialogMissing"><strong>待补齐</strong><span>{missing.join('、')}</span></div>}
      {error && <p className="alert error" role="alert">{error}</p>}
      <div className="articleDialogActions">{candidate && <button type="button" className="secondaryButton" onClick={() => { setExpanded((value) => !value); setError('') }}>
        {expanded ? '收起字段' : missing.length ? '查看并补齐' : '查看全部字段'}</button>}
        {/* 2026-10-24：本次修改原因：缺字段时也能保存待收录草稿，方便跨页集中补齐。 */}
        {candidate && onSaveDraft && <button type="button" className="secondaryButton" disabled={busy}
          onClick={() => void saveDraft()}>保存待收录</button>}
        <button type="button" className="secondaryButton" onClick={onClose} disabled={busy}>取消</button>
        <button type={expanded ? 'submit' : 'button'} form={expanded ? 'article-editor-form' : undefined} className="primaryButton"
          disabled={busy || missing.length > 0} onClick={expanded ? undefined : () => { void save() }}>
          {busy ? '正在保存…' : mode === 'edit' ? '保存修改' : candidate ? '确认收录' : '保存样本'}</button></div>
    </section>
  </div>
}
