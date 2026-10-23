// 2026-10-23：展示生成正文、失败状态与实际模型用量，避免任务只停留在编号。
import { useEffect, useState } from 'react'
import { getTaskResult, type TaskRead, type TaskResult } from './api'

export default function TaskResultPanel({ task }: { task: TaskRead }) {
  const [result, setResult] = useState<TaskResult | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    setResult(null)
    setError('')
    if (task.status === 'completed' || task.status === 'failed') {
      getTaskResult(task.task_id)
        .then(setResult)
        .catch((reason) => setError(reason instanceof Error ? reason.message : '结果读取失败'))
    }
  }, [task.task_id, task.status])

  if (task.status === 'pending' || task.status === 'running') {
    return <p className="note">任务正在排队或生成中。请稍后点击“刷新”。</p>
  }
  if (error) return <p className="error" role="alert">{error}</p>
  if (!result) return <p className="note">正在读取生成结果…</p>
  if (result.error) return <p className="error" role="alert">{result.error}</p>

  return <div className="articleResult">
    <h3>{result.title}</h3>
    <p>{result.summary}</p>
    <pre>{result.body_markdown}</pre>
    <p className="note">模型：{result.provider} / {result.model}；输入 {result.input_tokens} Token，输出 {result.output_tokens} Token。</p>
    {result.review_required && <p className="note">尚未接入知识库与事实核查，发布前需要人工审核。</p>}
  </div>
}
