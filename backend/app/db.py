# 2026-10-23：用 SQLite 持久化最小任务流程，后续可替换为 PostgreSQL。
from datetime import datetime, timezone
from pathlib import Path

# 2026-10-23：新增设置和结果表所需的列类型。
# from sqlalchemy import DateTime, String, Text, create_engine  # 2026-10-23：原导入保留供对照。
# from sqlalchemy import DateTime, ForeignKey, Integer, String, Text, create_engine  # 2026-10-23：原导入暂留供对照。
# 2026-10-23：本次修改原因：为可维护选项和审核状态增加布尔字段。
from sqlalchemy import Boolean, DateTime, ForeignKey, Integer, String, Text, create_engine
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, sessionmaker


DATA_DIR = Path(__file__).resolve().parents[1] / "data"
DATA_DIR.mkdir(exist_ok=True)
DATABASE_URL = f"sqlite:///{(DATA_DIR / 'tasks.db').as_posix()}"
engine = create_engine(DATABASE_URL, connect_args={"check_same_thread": False})
SessionLocal = sessionmaker(bind=engine)


class Base(DeclarativeBase):
    pass


class TaskModel(Base):
    __tablename__ = "tasks"

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    status: Mapped[str] = mapped_column(String(20), nullable=False)
    request_json: Mapped[str] = mapped_column(Text, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), nullable=False
    )


# 2026-10-23：保存全局默认模型；密钥始终保留在环境变量中。
class LLMSettingModel(Base):
    __tablename__ = "llm_settings"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    provider: Mapped[str] = mapped_column(String(50), nullable=False)
    model: Mapped[str] = mapped_column(String(100), nullable=False)


# 2026-10-23：将生成结果与原始任务分表，兼容已经存在的 SQLite 任务表。
class TaskResultModel(Base):
    __tablename__ = "task_results"

    task_id: Mapped[str] = mapped_column(ForeignKey("tasks.id"), primary_key=True)
    provider: Mapped[str] = mapped_column(String(50), nullable=False)
    model: Mapped[str] = mapped_column(String(100), nullable=False)
    title: Mapped[str | None] = mapped_column(String(300))
    summary: Mapped[str | None] = mapped_column(Text)
    body_markdown: Mapped[str | None] = mapped_column(Text)
    error: Mapped[str | None] = mapped_column(Text)
    input_tokens: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    output_tokens: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    completed_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), nullable=False
    )


# 2026-10-23：本次修改原因：人工修订稿独立存储，保留 AI 原稿及模型用量供对照。
class TaskDraftModel(Base):
    __tablename__ = "task_drafts"

    task_id: Mapped[str] = mapped_column(ForeignKey("tasks.id"), primary_key=True)
    title: Mapped[str] = mapped_column(String(300), nullable=False)
    summary: Mapped[str] = mapped_column(Text, nullable=False)
    body_markdown: Mapped[str] = mapped_column(Text, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)


# 2026-10-23：本次修改原因：将四组可选项持久化，重命名只改显示名，停用仍保留历史引用。
class ContentOptionModel(Base):
    __tablename__ = "content_options"

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    kind: Mapped[str] = mapped_column(String(20), nullable=False)
    label: Mapped[str] = mapped_column(String(100), nullable=False)
    active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    position: Mapped[int] = mapped_column(Integer, default=0, nullable=False)


# 2026-10-23：本次修改原因：保存经使用权确认的参考样本及其分类，供策略提炼。
class ContentSampleModel(Base):
    __tablename__ = "content_samples"

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    title: Mapped[str] = mapped_column(String(300), nullable=False)
    body_text: Mapped[str] = mapped_column(Text, nullable=False)
    platform_id: Mapped[str] = mapped_column(String(64), nullable=False)
    category_id: Mapped[str] = mapped_column(String(64), nullable=False)
    format_id: Mapped[str | None] = mapped_column(String(64))
    source_url: Mapped[str | None] = mapped_column(String(1000))
    quality_score: Mapped[int] = mapped_column(Integer, nullable=False)
    rights_confirmed: Mapped[bool] = mapped_column(Boolean, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), nullable=False
    )


# 2026-10-23：本次修改原因：版本化保存提炼出的写作策略，经审核发布后才参与生成。
class ContentStrategyModel(Base):
    __tablename__ = "content_strategies"

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    title: Mapped[str] = mapped_column(String(200), nullable=False)
    platform_id: Mapped[str] = mapped_column(String(64), nullable=False)
    category_id: Mapped[str | None] = mapped_column(String(64))
    format_id: Mapped[str | None] = mapped_column(String(64))
    guide_json: Mapped[str] = mapped_column(Text, nullable=False)
    sample_ids_json: Mapped[str] = mapped_column(Text, nullable=False)
    status: Mapped[str] = mapped_column(String(20), default="draft", nullable=False)
    version: Mapped[int] = mapped_column(Integer, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), nullable=False
    )


# 2026-10-23：本次修改原因：将品牌介绍与带来源的事实独立保存，供生成任务选择并冻结版本。
class BrandModel(Base):
    __tablename__ = "brands"

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    name: Mapped[str] = mapped_column(String(120), nullable=False)
    description: Mapped[str] = mapped_column(Text, nullable=False)
    facts_json: Mapped[str] = mapped_column(Text, nullable=False)
    active: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    version: Mapped[int] = mapped_column(Integer, default=1, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), nullable=False
    )


# 2026-10-23：本次修改原因：记录自动提炼策略对应的参考文章，仅存标题和链接，不持久化第三方正文。
class ContentStrategyReferenceModel(Base):
    __tablename__ = "content_strategy_references"

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    strategy_id: Mapped[str] = mapped_column(ForeignKey("content_strategies.id"), nullable=False)
    title: Mapped[str] = mapped_column(String(300), nullable=False)
    source_url: Mapped[str] = mapped_column(String(1000), nullable=False)
    provider: Mapped[str] = mapped_column(String(30), nullable=False)
