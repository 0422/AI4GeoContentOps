// 2026-10-23：提供最小任务提交与查询页面，验证前后端骨架连通。
import { useState, type FormEvent } from 'react'
import { contentTypes, createTask, getTask, type ContentType, type TaskRead } from './api'
// 2026-10-23：加入默认模型设置和生成结果展示。
import LLMSettings from './LLMSettings'
import TaskResultPanel from './TaskResultPanel'

const labels: Record<ContentType, string> = {
  knowledge_article: '知识科普',
  product_intro: '产品介绍',
  buying_guide: '选购指南',
  comparison: '对比文章',
  qa: '问答内容',
  social_post: '社交平台内容',
}

export default function App() {
  const [topic, setTopic] = useState('')
  const [audience, setAudience] = useState('')
  const [channel, setChannel] = useState('website_blog')
  const [contentType, setContentType] = useState<ContentType>('knowledge_article')
  const [task, setTask] = useState<TaskRead | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setBusy(true)
    setError('')
    try {
      setTask(await createTask({ topic, audience, channel, content_type: contentType }))
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '提交失败')
    } finally {
      setBusy(false)
    }
  }

  async function refresh() {
    if (!task) return
    setBusy(true)
    setError('')
    try {
      setTask(await getTask(task.task_id))
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '查询失败')
    } finally {
      setBusy(false)
    }
  }

  return (
    <main className="workspace">
      <header>
        <p className="eyebrow">AI CONTENTOPS · 项目骨架</p>
        <h1>内容任务工作台</h1>
        <p>提交并查询内容任务。模型生成、知识检索与质量检查将在后续接入。</p>
      </header>

      {/* 2026-10-23：先选择默认模型，再提交内容任务。 */}
      <LLMSettings />

      <section className="panel">
        <h2>创建任务</h2>
        <form onSubmit={submit}>
          <label>主题<input value={topic} onChange={(event) => setTopic(event.target.value)} required maxLength={200} /></label>
          <label>目标读者<input value={audience} onChange={(event) => setAudience(event.target.value)} required maxLength={200} /></label>
          <label>内容类型
            <select value={contentType} onChange={(event) => setContentType(event.target.value as ContentType)}>
              {contentTypes.map((type) => <option key={type} value={type}>{labels[type]}</option>)}
            </select>
          </label>
          <label>目标渠道<input value={channel} onChange={(event) => setChannel(event.target.value)} required maxLength={100} /></label>
          <button type="submit" disabled={busy}>{busy ? '处理中…' : '创建任务'}</button>
        </form>
      </section>

      {error && <p className="error" role="alert">{error}</p>}

      {task && <section className="panel result">
        <div className="resultHeading"><h2>任务状态</h2><button type="button" onClick={refresh} disabled={busy}>刷新</button></div>
        <dl>
          <dt>任务编号</dt><dd>{task.task_id}</dd>
          <dt>状态</dt><dd>{task.status}</dd>
          <dt>主题</dt><dd>{task.request.topic}</dd>
          <dt>创建时间</dt><dd>{new Date(task.created_at).toLocaleString('zh-CN')}</dd>
        </dl>
        {/* <p className="note">当前仅保存任务；尚未开始生成文章。</p> 2026-10-23：原占位说明暂保留供对照。 */}
        {/* 2026-10-23：根据任务状态展示真实生成结果。 */}
        <TaskResultPanel task={task} />
      </section>}
    </main>
  )
}
