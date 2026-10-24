// 2026-10-24：本次修改原因：Stage 2C 让候选补齐、手动录入和已入库编辑共用目标文章库字段表单。
import { useState, type FormEvent } from 'react'
import type { ContentOption } from '../workspaceApi'
import type { V2ArticleEditable, V2RightsScope } from '../articleLibraryV2Api'

type Mode = 'candidate' | 'manual' | 'edit'
type Props = {
  mode: Mode
  initial: Partial<V2ArticleEditable>
  options: ContentOption[]
  initialScope?: V2RightsScope
  sourceData?: unknown
  provenance?: unknown
  warnings?: string[]
  onSave: (value: V2ArticleEditable, scope: V2RightsScope, evidence: string) => Promise<void>
  onSaveDraft?: (value: V2ArticleEditable) => Promise<void>
  onClose: () => void
}

// 2026-10-24：本次修改原因：收录按钮本身确认本地保存；清洗、第三方模型和生成引用权限留待对应流程单独授权。
const blankScope = (): V2RightsScope => ({ store: null, local_clean: null,
  third_party_llm: null, generation_reference: null })
// const blankScope = (): V2RightsScope => ({ store: false, local_clean: false, third_party_llm: false, generation_reference: false }) // 2026-10-24：原逐项默认拒绝状态留作权限流程对照。

function editable(value: Partial<V2ArticleEditable>, options: ContentOption[]): V2ArticleEditable {
  const platform = options.find((item) => item.kind === 'platform' && item.active &&
    ['微信公众号', '微信公众平台', '公众号'].includes(item.label))?.id || 'platform_01'
  let category = value.category_id || ''
  const matchedCategory = options.find((item) => item.kind === 'category' &&
    (item.id === category || item.label === category))
  if (matchedCategory) category = matchedCategory.id
  return { platform_id: value.platform_id || platform, category_id: category || null,
    content_format_id: value.content_format_id || null, genre_id: value.genre_id || null,
    audience_id: value.audience_id || null, topic: value.topic || null, tags: value.tags || [],
    title: value.title || '', summary: value.summary || '', body_text: value.body_text || '',
    author_name: value.author_name || '', published_at: value.published_at || '',
    article_url: value.article_url || '', review_status: value.review_status || 'pending',
    content_status: value.content_status || 'unknown', quality_score: value.quality_score ?? null }
}

export default function V2ArticleEditorDialog({ mode, initial, options, initialScope,
  sourceData, provenance, warnings = [], onSave, onSaveDraft, onClose }: Props) {
  const [value, setValue] = useState(() => editable(initial, options))
  const scope = initialScope || blankScope()
  // const [scope, setScope] = useState(initialScope || blankScope()) // 2026-10-24：收录表单不再要求重复逐项勾选处理权限。
  // const [evidence, setEvidence] = useState('') // 2026-10-24：收录动作的保存确认不再要求重复填写权限备注。
  const evidence = ''
  // const [tagText, setTagText] = useState((initial.tags || []).join('、')) // 2026-10-24：候选表单不再要求手工提供未被接口稳定返回的标签。
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const categoryOptions = options.filter((item) => item.kind === 'category' && item.active)
  const platformOptions = options.filter((item) => item.kind === 'platform' && item.active)
  const missing = [!value.title.trim() && '标题', !value.category_id && '内容类目',
    (value.body_text || '').trim().length < 50 && '正文至少 50 字']
    .filter(Boolean) as string[]
  const canCollect = missing.length === 0

  function set<K extends keyof V2ArticleEditable>(key: K, next: V2ArticleEditable[K]) {
    setValue((current) => ({ ...current, [key]: next }))
  }

  async function submit(event: FormEvent<HTMLFormElement>, action: 'save' | 'draft') {
    event.preventDefault()
    if (action === 'draft' && onSaveDraft) {
      setBusy(true); setError('')
      try { await onSaveDraft(value) }
      catch (reason) { setError(reason instanceof Error ? reason.message : '草稿保存失败') }
      finally { setBusy(false) }
      return
    }
    if (mode !== 'edit' && missing.length) { setError(`请补齐：${missing.join('、')}`); return }
    // if (mode !== 'edit' && scope.store !== true) { setError('请明确确认允许将文章保存到样本管理。'); return } // 2026-10-24：旧权限勾选区已移除，避免阻止默认允许的收录动作。
    // 2026-10-24：本次修改原因：点击“收录到样本管理”即确认本地保存，权限勾选不再作为收录前置条件。
    setBusy(true); setError('')
    try {
      await onSave(value, { ...scope, store: true }, evidence)
    } catch (reason) { setError(reason instanceof Error ? reason.message : '保存失败') }
    finally { setBusy(false) }
  }

  async function saveDraft() {
    if (!onSaveDraft) return
    setBusy(true); setError('')
    try { await onSaveDraft(value) }
    catch (reason) { setError(reason instanceof Error ? reason.message : '草稿保存失败') }
    finally { setBusy(false) }
  }

  const title = mode === 'candidate' ? '核对候选文章' : mode === 'edit' ? '查看与修改文章' : '手动录入文章'
  return <div className="v2DialogBackdrop" onMouseDown={(event) => {
    if (event.target === event.currentTarget && !busy) onClose()
  }}>
    <section className="v2ArticleDialog" role="dialog" aria-modal="true" aria-label={title}>
      <header><h2>{title}</h2><button type="button" aria-label="关闭" onClick={onClose} disabled={busy}>×</button></header>
      <form onSubmit={(event) => void submit(event, 'save')}>
        <div className="v2EditorFields">
          <label className="v2Wide">标题<input maxLength={300} value={value.title}
            onChange={(event) => set('title', event.target.value)} /></label>
          <label>内容平台<select value={value.platform_id} disabled={mode === 'edit'}
            onChange={(event) => set('platform_id', event.target.value)}>
            {platformOptions.length ? platformOptions.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)
              : <option value="platform_01">微信公众号</option>}
          </select></label>
          <label>内容类目<select value={value.category_id || ''} onChange={(event) => set('category_id', event.target.value || null)}>
            <option value="">选择类目</option>{categoryOptions.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
            {value.category_id && !categoryOptions.some((item) => item.id === value.category_id) &&
              <option value={value.category_id}>{value.category_id}</option>}
          </select></label>
          <label>作者<input value={value.author_name || ''} onChange={(event) => set('author_name', event.target.value)} /></label>
          <label>发布时间<input type="date" value={(value.published_at || '').slice(0, 10)}
            onChange={(event) => set('published_at', event.target.value || null)} /></label>
          <label className="v2Wide">原文链接<input type="url" value={value.article_url || ''}
            onChange={(event) => set('article_url', event.target.value || null)} /></label>
          <label className="v2Wide">摘要<textarea rows={3} value={value.summary || ''}
            onChange={(event) => set('summary', event.target.value || null)} /></label>
          <label className="v2Wide">正文<textarea rows={12} value={value.body_text || ''}
            onChange={(event) => set('body_text', event.target.value || null)} /></label>
          {/* 标签编辑暂缓：RedFox 候选未稳定提供标签，后续由清洗与分析流程生成并写明来源。 */}
          {/* <label className="v2Wide">标签（顿号或逗号分隔）<input value={tagText} onChange={(event) => setTagText(event.target.value)} /></label> 2026-10-24：原手工标签输入留作对照。 */}
          <label>内容审核状态<select value={value.review_status || 'pending'}
            onChange={(event) => set('review_status', event.target.value)}>
            <option value="pending">待核对</option><option value="ready">已核对</option><option value="excluded">已排除</option>
          </select></label>
          <label>正文完整性<select value={value.content_status || 'unknown'}
            onChange={(event) => set('content_status', event.target.value as V2ArticleEditable['content_status'])}>
            <option value="unknown">待确认</option><option value="complete">完整</option>
            <option value="partial">部分正文</option><option value="missing">缺少正文</option>
          </select></label>
        </div>

        {mode !== 'edit' && <p className="v2RightsNotice">点击收录即确认保存到样本管理。清洗、第三方模型分析和生成引用权限暂不授予，相关流程启用时再单独确认。</p>}
        {/* 原权限勾选区保留供后续各处理流程接入时对照；收录只授权本地存储，其他范围保持未知。
        {mode !== 'edit' && <fieldset className="v2RightsFields"><legend>权限确认</legend>
          <label><input type="checkbox" checked={scope.store === true} onChange={(event) => setScope({ ...scope, store: event.target.checked })} />允许保存到样本管理（收录必选）</label>
          <label><input type="checkbox" checked={scope.local_clean === true} onChange={(event) => setScope({ ...scope, local_clean: event.target.checked })} />允许本地清洗与格式处理</label>
          <label><input type="checkbox" checked={scope.third_party_llm === true} onChange={(event) => setScope({ ...scope, third_party_llm: event.target.checked })} />允许发送给第三方模型分析</label>
          <label><input type="checkbox" checked={scope.generation_reference === true} onChange={(event) => setScope({ ...scope, generation_reference: event.target.checked })} />允许作为内容生成参考</label>
        </fieldset>}
        */}

        {warnings.length > 0 && <div className="v2EditorWarnings"><strong>采集提示</strong>
          {warnings.map((warning) => <p key={warning}>{warning}</p>)}</div>}
        {(sourceData != null || provenance != null) && <details className="v2SourceDetails">
          <summary>抓取来源字段汇总</summary>
          {sourceData != null && <><strong>来源原始字段</strong><pre>{JSON.stringify(sourceData, null, 2)}</pre></>}
          {provenance != null && <><strong>字段来源与转换</strong><pre>{JSON.stringify(provenance, null, 2)}</pre></>}
        </details>}
        {mode === 'candidate' && <p className="v2FormHint">收录前需补齐标题、内容类目和至少 50 字正文。内容类目可由榜单筛选类目预填，请核对文章实际内容。</p>}
        {error && <div className="v2FormError" role="alert">{error}</div>}
        <footer>
          <button type="button" className="secondaryButton" onClick={onClose} disabled={busy}>取消</button>
          {mode === 'candidate' && onSaveDraft && <button type="button" className="secondaryButton"
            disabled={busy} onClick={() => void saveDraft()}>
            {busy ? '保存中…' : '保存补充'}</button>}
          <button className="primaryButton" type="submit" disabled={busy || (mode !== 'edit' && !canCollect)}>
            {busy ? '保存中…' : mode === 'candidate' ? '收录到样本管理' : mode === 'manual' ? '保存样本' : '保存修改'}
          </button>
        </footer>
      </form>
    </section>
  </div>
}
