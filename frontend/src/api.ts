// 2026-10-23：集中封装任务 API，确保页面与后端字段保持一致。
export const contentTypes = [
  'knowledge_article',
  'product_intro',
  'buying_guide',
  'comparison',
  'qa',
  'social_post',
] as const

export type ContentType = (typeof contentTypes)[number]

export interface TaskCreate {
  topic: string
  content_type: ContentType
  audience: string
  channel: string
  // 2026-10-23：任务可选择覆盖全局默认模型。
  llm_provider?: string
  llm_model?: string
}

export interface TaskRead {
  task_id: string
  status: string
  request: TaskCreate
  created_at: string
}

async function taskResponse(response: Response): Promise<TaskRead> {
  if (!response.ok) {
    throw new Error(`请求失败（HTTP ${response.status}）`)
  }
  return (await response.json()) as TaskRead
}

export async function createTask(request: TaskCreate): Promise<TaskRead> {
  return taskResponse(
    await fetch('/api/v1/tasks', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(request),
    }),
  )
}

export async function getTask(taskId: string): Promise<TaskRead> {
  return taskResponse(await fetch(`/api/v1/tasks/${encodeURIComponent(taskId)}`))
}


// 2026-10-23：集中定义模型设置与生成结果接口，页面无需接触密钥。
export interface ModelOption {
  provider: string
  model: string
  label: string
  configured: boolean
}

export interface LLMSettings {
  default_provider: string
  default_model: string
  options: ModelOption[]
}

export interface TaskResult {
  task_id: string
  status: string
  provider: string
  model: string
  title: string | null
  summary: string | null
  body_markdown: string | null
  error: string | null
  input_tokens: number
  output_tokens: number
  review_required: boolean
  completed_at: string
}

async function readResponse<T>(response: Response): Promise<T> {
  if (!response.ok) {
    const body = await response.json().catch(() => null) as { detail?: string } | null
    throw new Error(body?.detail ?? `请求失败（HTTP ${response.status}）`)
  }
  return (await response.json()) as T
}

export async function getLLMSettings(): Promise<LLMSettings> {
  return readResponse<LLMSettings>(await fetch('/api/v1/settings/llm'))
}

export async function updateLLMSettings(provider: string, model: string): Promise<LLMSettings> {
  return readResponse<LLMSettings>(await fetch('/api/v1/settings/llm', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ provider, model }),
  }))
}

export async function getTaskResult(taskId: string): Promise<TaskResult> {
  return readResponse<TaskResult>(await fetch(`/api/v1/tasks/${encodeURIComponent(taskId)}/result`))
}
