# 2026-10-23：用 SQLite 持久化最小任务流程，后续可替换为 PostgreSQL。
from datetime import datetime, timezone
from pathlib import Path

# 2026-10-23：新增设置和结果表所需的列类型。
# from sqlalchemy import DateTime, String, Text, create_engine  # 2026-10-23：原导入保留供对照。
# from sqlalchemy import DateTime, ForeignKey, Integer, String, Text, create_engine  # 2026-10-23：原导入暂留供对照。
# 2026-10-23：本次修改原因：为可维护选项和审核状态增加布尔字段。
# from sqlalchemy import Boolean, DateTime, ForeignKey, Integer, String, Text, create_engine  # 2026-10-24：原导入保留供对照。
# 2026-10-24：本次修改原因：为已存在的 SQLite 指标表补充在看数和原始展示值列。
from sqlalchemy import Boolean, DateTime, ForeignKey, Integer, String, Text, create_engine, inspect
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


# 2026-10-23：本次修改原因：以关联表扩展旧样本，避免现有 SQLite 文章表增加字段后无法直接迁移。
class ArticleMetadataModel(Base):
    __tablename__ = "article_metadata"

    sample_id: Mapped[str] = mapped_column(ForeignKey("content_samples.id"), primary_key=True)
    author_id: Mapped[str | None] = mapped_column(String(200))
    # 2026-10-23：本次修改原因：传播表现仅与账号规模相近的文章比较，缺失时保持未分组。
    account_followers: Mapped[int | None] = mapped_column(Integer)
    published_at: Mapped[str | None] = mapped_column(String(10))
    audience_id: Mapped[str | None] = mapped_column(String(64))
    topic: Mapped[str | None] = mapped_column(String(200))
    tags_json: Mapped[str] = mapped_column(Text, default="[]", nullable=False)
    usage_rights_note: Mapped[str | None] = mapped_column(Text)
    # 2026-10-24：本次修改原因：保存 RedFox 三种公众号接口的查询条件和原始非正文返回字段。
    source_data_json: Mapped[str] = mapped_column(Text, default="{}", nullable=False)
    review_status: Mapped[str] = mapped_column(String(20), default="ready", nullable=False)
    content_hash: Mapped[str] = mapped_column(String(64), nullable=False)
    collected_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), nullable=False
    )


# 2026-10-24：本次修改原因：候选文章补齐后先持久化为待收录草稿，供跨页批量确认入库。
class CandidateDraftModel(Base):
    __tablename__ = "candidate_drafts"

    candidate_key: Mapped[str] = mapped_column(String(1200), primary_key=True)
    value_json: Mapped[str] = mapped_column(Text, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)


# 2026-10-23：本次修改原因：互动数据按采集时间保存快照，避免覆盖历史读数和混用缺失指标。
class ArticleMetricModel(Base):
    __tablename__ = "article_metrics"

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    sample_id: Mapped[str] = mapped_column(ForeignKey("content_samples.id"), nullable=False)
    captured_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    source: Mapped[str] = mapped_column(String(100), nullable=False)
    impressions: Mapped[int | None] = mapped_column(Integer)
    clicks: Mapped[int | None] = mapped_column(Integer)
    reads: Mapped[int | None] = mapped_column(Integer)
    likes: Mapped[int | None] = mapped_column(Integer)
    # 2026-10-24：本次修改原因：公众号“在看”有独立含义，不混入点赞或收藏。
    watch_count: Mapped[int | None] = mapped_column(Integer)
    saves: Mapped[int | None] = mapped_column(Integer)
    # 2026-10-24：本次修改原因：关键词打赏和榜单互动量与其他指标分开保存。
    reward_count: Mapped[int | None] = mapped_column(Integer)
    interactive_count: Mapped[int | None] = mapped_column(Integer)
    comments: Mapped[int | None] = mapped_column(Integer)
    shares: Mapped[int | None] = mapped_column(Integer)
    # 2026-10-24：本次修改原因：保留“10W+”等原始读数供核对，不将其伪装成精确整数。
    raw_counts_json: Mapped[str] = mapped_column(Text, default="{}", nullable=False)


# 2026-10-24：本次修改原因：create_all 不会给旧表加列，启动时只补缺失的指标列。
def ensure_article_metric_columns() -> None:
    columns = {column["name"] for column in inspect(engine).get_columns("article_metrics")}
    with engine.begin() as connection:
        if "watch_count" not in columns:
            connection.exec_driver_sql("ALTER TABLE article_metrics ADD COLUMN watch_count INTEGER")
        if "raw_counts_json" not in columns:
            connection.exec_driver_sql("ALTER TABLE article_metrics ADD COLUMN raw_counts_json TEXT NOT NULL DEFAULT '{}'")
        # 2026-10-24：本次修改原因：旧数据库保留原有快照并补充两项公众号专有读数。
        if "reward_count" not in columns:
            connection.exec_driver_sql("ALTER TABLE article_metrics ADD COLUMN reward_count INTEGER")
        if "interactive_count" not in columns:
            connection.exec_driver_sql("ALTER TABLE article_metrics ADD COLUMN interactive_count INTEGER")


# 2026-10-24：本次修改原因：旧文章元数据表无需重建即可保存来源接口字段。
def ensure_article_source_columns() -> None:
    columns = {column["name"] for column in inspect(engine).get_columns("article_metadata")}
    if "source_data_json" not in columns:
        with engine.begin() as connection:
            connection.exec_driver_sql("ALTER TABLE article_metadata ADD COLUMN source_data_json TEXT NOT NULL DEFAULT '{}'")


# 2026-10-23：本次修改原因：原文与可重算的单篇特征分开存储，并记录算法及输入正文版本。
class ArticleFeatureModel(Base):
    __tablename__ = "article_features"

    sample_id: Mapped[str] = mapped_column(ForeignKey("content_samples.id"), primary_key=True)
    algorithm_version: Mapped[str] = mapped_column(String(40), nullable=False)
    content_hash: Mapped[str] = mapped_column(String(64), nullable=False)
    features_json: Mapped[str] = mapped_column(Text, nullable=False)
    analyzed_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)


# 2026-10-23：本次修改原因：记录每次画像分析的范围、方法和结果，供用户核对失败或重分析原因。
class ArticleAnalysisRunModel(Base):
    __tablename__ = "article_analysis_runs"

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    scope_json: Mapped[str] = mapped_column(Text, nullable=False)
    status: Mapped[str] = mapped_column(String(20), nullable=False)
    method: Mapped[str] = mapped_column(String(80), nullable=False)
    error: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


# 2026-10-23：本次修改原因：保存同类文章聚合画像的不可变版本和所依据的样本范围。
class StyleProfileModel(Base):
    __tablename__ = "style_profiles"

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    platform_id: Mapped[str] = mapped_column(String(64), nullable=False)
    category_id: Mapped[str] = mapped_column(String(64), nullable=False)
    format_id: Mapped[str | None] = mapped_column(String(64))
    audience_id: Mapped[str | None] = mapped_column(String(64))
    version: Mapped[int] = mapped_column(Integer, nullable=False)
    sample_count: Mapped[int] = mapped_column(Integer, nullable=False)
    profile_json: Mapped[str] = mapped_column(Text, nullable=False)
    method: Mapped[str] = mapped_column(String(80), nullable=False)
    model_name: Mapped[str | None] = mapped_column(String(100))
    run_id: Mapped[str] = mapped_column(ForeignKey("article_analysis_runs.id"), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)


# 2026-10-23：本次修改原因：画像和策略均保留来源关系，不依赖可被后续修改的临时筛选结果。
class StyleProfileArticleModel(Base):
    __tablename__ = "style_profile_articles"

    profile_id: Mapped[str] = mapped_column(ForeignKey("style_profiles.id"), primary_key=True)
    sample_id: Mapped[str] = mapped_column(ForeignKey("content_samples.id"), primary_key=True)
    # 2026-10-23：本次修改原因：画像固定创建时的正文版本，后续文章修改不能悄悄改变策略依据。
    content_hash: Mapped[str] = mapped_column(String(64), nullable=False)


class StrategyProfileLinkModel(Base):
    __tablename__ = "strategy_profile_links"

    strategy_id: Mapped[str] = mapped_column(ForeignKey("content_strategies.id"), primary_key=True)
    profile_id: Mapped[str] = mapped_column(ForeignKey("style_profiles.id"), nullable=False)
