// 2026-10-23：展示可用 LLM 并允许用户设置后续任务的默认模型。
import { useEffect, useState } from 'react'
import { getLLMSettings, updateLLMSettings, type LLMSettings as Settings } from './api'

export default function LLMSettings() {
  const [settings, setSettings] = useState<Settings | null>(null)
  const [selected, setSelected] = useState('')
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    getLLMSettings()
      .then((value) => {
        setSettings(value)
        setSelected(`${value.default_provider}/${value.default_model}`)
      })
      .catch((reason) => setMessage(reason instanceof Error ? reason.message : '设置读取失败'))
  }, [])

  async function save() {
    const option = settings?.options.find((item) => `${item.provider}/${item.model}` === selected)
    if (!option) return
    setBusy(true)
    setMessage('')
    try {
      setSettings(await updateLLMSettings(option.provider, option.model))
      setMessage('默认模型已保存；新任务将使用此模型。')
    } catch (reason) {
      setMessage(reason instanceof Error ? reason.message : '保存失败')
    } finally {
      setBusy(false)
    }
  }

  return <section className="panel">
    <h2>模型设置</h2>
    {/* <p className="note">选择新任务默认使用的模型。密钥只在后端环境变量中配置。</p> 2026-10-23：原提示暂留供对照。 */}
    {/* 2026-10-23：本次修改原因：明确本地密钥文件位置。 */}
    {/* <p className="note">选择新任务默认使用的模型。密钥保存在后端 backend/.env，页面只显示是否已配置。</p> 2026-10-23：原常驻说明保留供对照。 */}
    {/* 2026-10-23：本次修改原因：模型选项已直接标明密钥状态，只有完全未配置时保留操作提示。 */}
    {settings && <div className="settingsRow">
      <select aria-label="默认模型" value={selected} onChange={(event) => setSelected(event.target.value)}>
        {settings.options.map((item) => <option
          key={`${item.provider}/${item.model}`}
          value={`${item.provider}/${item.model}`}
          disabled={!item.configured}
        >{item.label}{item.configured ? '' : '（未配置密钥）'}</option>)}
      </select>
      <button type="button" onClick={save} disabled={busy || !settings.options.some((item) =>
        `${item.provider}/${item.model}` === selected && item.configured
      )}>保存默认模型</button>
    </div>}
    {message && <p role="status">{message}</p>}
    {settings && !settings.options.some((item) => item.configured) &&
      <>
        {/* <p className="note">请先为后端 API 和 Worker 配置 DEEPSEEK_API_KEY。</p> 2026-10-23：原提示暂留供对照。 */}
        {/* 2026-10-23：本次修改原因：提示使用后端 .env 完成模型配置。 */}
        <p className="note">请先在 backend/.env 填写 DEEPSEEK_API_KEY，并重启 API 与 Worker。</p>
      </>}
  </section>
}
