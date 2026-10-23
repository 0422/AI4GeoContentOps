# 2026-10-23：定义首期任务输入输出，先固定可验证的 API 契约。
from datetime import datetime
from enum import Enum

from pydantic import BaseModel, Field


class ContentType(str, Enum):
    knowledge_article = "knowledge_article"
    product_intro = "product_intro"
    buying_guide = "buying_guide"
    comparison = "comparison"
    qa = "qa"
    social_post = "social_post"


class TaskCreate(BaseModel):
    topic: str = Field(min_length=1, max_length=200)
    # content_type: ContentType  # 2026-10-23：原固定枚举暂留，历史任务仍按字符串读取。
    # 2026-10-23：本次修改原因：内容形式由可维护选项表决定，支持新增与重命名。
    content_type: str = Field(min_length=1, max_length=100)
    audience: str = Field(min_length=1, max_length=200)
    channel: str = Field(min_length=1, max_length=100)
    brand_id: str | None = None
    # 2026-10-23：本次修改原因：任务提交时固定品牌事实，后续改品牌库不影响已排队文章。
    brand_snapshot: dict | None = None
    product_ids: list[str] = Field(default_factory=list)
    language: str = "zh-CN"
    target_words: int | None = Field(default=None, ge=100, le=10000)
    tone: str | None = None
    knowledge_ids: list[str] = Field(default_factory=list)
    requirements: list[str] = Field(default_factory=list)
    # 2026-10-23：本次修改原因：保存可维护选项 ID、显示快照与用户补充要求，兼容旧任务 JSON。
    category_id: str | None = None
    category_label: str | None = None
    audience_id: str | None = None
    format_id: str | None = None
    platform_id: str | None = None
    extra_prompt: str | None = Field(default=None, max_length=3000)
    strategy_id: str | None = None
    strategy_version: int | None = None
    strategy_guide: dict[str, str] | None = None
    # 2026-10-23：允许任务覆盖全局默认模型，并在创建时固定选择。
    llm_provider: str | None = None
    llm_model: str | None = None


class TaskRead(BaseModel):
    task_id: str
    status: str
    request: TaskCreate
    created_at: datetime


# 2026-10-23：本次修改原因：限制人工修订稿的标题、摘要和正文长度。
class TaskDraftWrite(BaseModel):
    title: str = Field(min_length=1, max_length=300)
    summary: str = Field(max_length=5000)
    body_markdown: str = Field(min_length=1, max_length=30000)


# 2026-10-23：定义可追溯的生成结果；事实核查接入前始终要求人工审核。
class TaskResultRead(BaseModel):
    task_id: str
    status: str
    provider: str
    model: str
    title: str | None
    summary: str | None
    body_markdown: str | None
    error: str | None
    input_tokens: int
    output_tokens: int
    review_required: bool = True
    completed_at: datetime
    # 2026-10-23：本次修改原因：向生成页返回已保存修订稿，同时保留原始 AI 输出。
    edited_title: str | None = None
    edited_summary: str | None = None
    edited_body_markdown: str | None = None
    edited_at: datetime | None = None
