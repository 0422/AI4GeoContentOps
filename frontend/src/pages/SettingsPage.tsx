// 2026-10-23：本次修改原因：让业务人员维护四组选项，同时保留独立的模型设置入口。
import { useState, type FormEvent } from 'react'
import LLMSettings from '../LLMSettings'
import {
  addOption, renameOption, setOptionActive, type ContentOption, type OptionKind,
} from '../workspaceApi'

const groups: { kind: OptionKind; label: string; description: string }[] = [
  { kind: 'category', label: '内容类目', description: '文章所属的领域，具体选题仍由生成者填写。' },
  { kind: 'audience', label: '目标读者', description: '帮助模型选择解释深度与表达方式。' },
  { kind: 'format', label: '内容形式', description: '决定文章的主要叙述与组织方式。' },
  { kind: 'platform', label: '目标平台', description: '关联平台策略；新增平台后可手工配置策略。' },
]

export default function SettingsPage({
  options, onOptionsChange,
}: { options: ContentOption[]; onOptionsChange: () => Promise<void> }) {
  const [kind, setKind] = useState<OptionKind>('category')
  const [newLabel, setNewLabel] = useState('')
  const [editingId, setEditingId] = useState('')
  const [editingLabel, setEditingLabel] = useState('')
  const [busyId, setBusyId] = useState('')
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')

  const group = groups.find((item) => item.kind === kind) ?? groups[0]
  const rows = options.filter((item) => item.kind === kind)

  // 2026-10-23：本次修改原因：仅在保存成功后清空用户输入，失败时保留待修改内容。
  async function run(id: string, action: () => Promise<unknown>, success: string): Promise<boolean> {
    setBusyId(id)
    setError('')
    setMessage('')
    try {
      await action()
      await onOptionsChange()
      setMessage(success)
      return true
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '操作失败')
      return false
    } finally {
      setBusyId('')
    }
  }

  async function add(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const label = newLabel.trim()
    if (!label) return
    if (await run('new', () => addOption(kind, label), '选项已新增。')) setNewLabel('')
  }

  async function rename(item: ContentOption) {
    const label = editingLabel.trim()
    if (!label || label === item.label) {
      setEditingId('')
      return
    }
    if (await run(item.id, () => renameOption(item.id, label), '名称已更新；已有任务仍保留原名称快照。')) setEditingId('')
  }

  async function toggle(item: ContentOption) {
    if (item.active && !window.confirm(`删除“${item.label}”？它会从新任务中移除，历史任务仍保留记录。`)) return
    await run(item.id, () => setOptionActive(item.id, !item.active),
      item.active ? '选项已删除，可随时恢复。' : '选项已恢复。')
  }

  return <>
    <div className="pageHeading">
      {/* <div><p className="kicker">PREFERENCES / 工作台设置</p><h1>让分类体系适应你的业务</h1> 2026-10-23：原装饰性页眉保留供对照。 */}
      {/* 2026-10-23：本次修改原因：配置页标题与导航使用同一名称，去掉营销式文案。 */}
      <div><h1>工作台设置</h1>
        <p>管理生成页面的可选项与默认模型。选项名称可以调整，历史任务始终保留提交时的记录。</p></div>
      {/* <span className="headingIndex">04 / 04</span> 2026-10-23：原四页编号暂留供对照。 */}
      {/* 2026-10-23：本次修改原因：导航增加品牌库，更新页面总数。 */}
      <span className="headingIndex">05 / 05</span>
    </div>
    <section className="card settingsCard">
      <div className="sectionHeading"><div><span className="stepTag">01</span><h2>内容选项</h2></div></div>
      <div className="tabBar" role="tablist" aria-label="选项类型">
        {groups.map((item) => <button type="button" role="tab" key={item.kind}
          aria-selected={kind === item.kind} className={kind === item.kind ? 'tab active' : 'tab'}
          onClick={() => { setKind(item.kind); setEditingId(''); setNewLabel(''); setMessage(''); setError('') }}>
          {item.label} <small>{options.filter((option) => option.kind === item.kind && option.active).length}</small>
        </button>)}
      </div>
      <div className="settingIntro"><h3>{group.label}</h3><p>{group.description}</p></div>
      <form className="addOptionRow" onSubmit={(event) => void add(event)}>
        <input aria-label={`新增${group.label}`} value={newLabel} onChange={(event) => setNewLabel(event.target.value)}
          placeholder={`输入新的${group.label}名称`} maxLength={100} />
        <button type="submit" className="primaryButton" disabled={busyId === 'new' || !newLabel.trim()}>新增选项</button>
      </form>
      <div className="optionList">{rows.map((item) => <div className={item.active ? 'optionRow' : 'optionRow inactive'} key={item.id}>
        <span className="optionOrder">{String(item.position).padStart(2, '0')}</span>
        {editingId === item.id ? <input className="optionEdit" aria-label="修改选项名称"
          value={editingLabel} onChange={(event) => setEditingLabel(event.target.value)}
          onKeyDown={(event) => { if (event.key === 'Enter') void rename(item); if (event.key === 'Escape') setEditingId('') }}
          autoFocus maxLength={100} /> : <strong>{item.label}</strong>}
        {!item.active && <span className="miniStatus archived">已删除</span>}
        <div className="optionActions">
          {editingId === item.id ? <>
            <button type="button" className="textButton" onClick={() => void rename(item)} disabled={!!busyId}>保存</button>
            <button type="button" className="textButton mutedButton" onClick={() => setEditingId('')}>取消</button>
          </> : <>
            <button type="button" className="textButton" onClick={() => { setEditingId(item.id); setEditingLabel(item.label) }}>重命名</button>
            <button type="button" className="textButton mutedButton" onClick={() => void toggle(item)} disabled={!!busyId}>
              {item.active ? '删除' : '恢复'}
            </button>
          </>}</div>
      </div>)}</div>
      <p className="subtle">删除后的选项不会出现在新任务中，历史记录保留，可随时恢复。新增平台后，可在“内容策略”创建对应策略。</p>
      {error && <p className="alert error" role="alert">{error}</p>}
      {message && <p className="alert success" role="status">{message}</p>}
    </section>
    <div className="modelSettings"><div className="modelSectionTitle"><span className="stepTag teal">02</span><h2>模型配置</h2></div>
      <LLMSettings /></div>
  </>
}
