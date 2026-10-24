# 2026-10-24：本次修改原因：建立与 Alembic 冻结 DDL 对应的 Stage 2A 领域 ORM，不复用旧库 Base。
"""Stage 2A target ORM. Classes are grouped by their domain docstrings."""
from sqlalchemy import ForeignKey, ForeignKeyConstraint, Integer, Text, UniqueConstraint, Index, text
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column

class TargetBase(DeclarativeBase):
    pass

# 2026-10-24：本次修改原因：Infrastructure 目标实体字段与约束采用统一数据库契约。
class ContentOptions(TargetBase):
    __tablename__ = 'content_options'
    __doc__ = 'Infrastructure'
    id: Mapped[str] = mapped_column(Text, primary_key=True, nullable=False)
    kind: Mapped[str] = mapped_column(Text, primary_key=False, nullable=False)
    label: Mapped[str] = mapped_column(Text, primary_key=False, nullable=False)
    active: Mapped[int] = mapped_column(Integer, primary_key=False, nullable=False)
    position: Mapped[int] = mapped_column(Integer, primary_key=False, nullable=False)

# 2026-10-24：本次修改原因：Brand Library 目标实体字段与约束采用统一数据库契约。
class Brands(TargetBase):
    __tablename__ = 'brands'
    __doc__ = 'Brand Library'
    id: Mapped[str] = mapped_column(Text, primary_key=True, nullable=False)
    name: Mapped[str] = mapped_column(Text, primary_key=False, nullable=False)
    description: Mapped[str] = mapped_column(Text, primary_key=False, nullable=False)
    facts_json: Mapped[str] = mapped_column(Text, primary_key=False, nullable=False)
    active: Mapped[int] = mapped_column(Integer, primary_key=False, nullable=False)
    version: Mapped[int] = mapped_column(Integer, primary_key=False, nullable=False)
    created_at: Mapped[str] = mapped_column(Text, primary_key=False, nullable=False)

# 2026-10-24：本次修改原因：Infrastructure 目标实体字段与约束采用统一数据库契约。
class LlmSettings(TargetBase):
    __tablename__ = 'llm_settings'
    __doc__ = 'Infrastructure'
    id: Mapped[int] = mapped_column(Integer, primary_key=True, nullable=False)
    provider: Mapped[str] = mapped_column(Text, primary_key=False, nullable=False)
    model: Mapped[str] = mapped_column(Text, primary_key=False, nullable=False)

# 2026-10-24：本次修改原因：Reference Library 目标实体字段与约束采用统一数据库契约。
class DiscoverySessions(TargetBase):
    __tablename__ = 'discovery_sessions'
    __doc__ = 'Reference Library'
    id: Mapped[str] = mapped_column(Text, primary_key=True, nullable=False)
    platform_id: Mapped[str] = mapped_column(Text, primary_key=False, nullable=False)
    provider: Mapped[str] = mapped_column(Text, primary_key=False, nullable=False)
    endpoint: Mapped[str] = mapped_column(Text, primary_key=False, nullable=False)
    request_params_json: Mapped[str] = mapped_column(Text, primary_key=False, nullable=False)
    status: Mapped[str] = mapped_column(Text, primary_key=False, nullable=False)
    result_count: Mapped[int | None] = mapped_column(Integer, primary_key=False, nullable=True)
    pinned: Mapped[int] = mapped_column(Integer, primary_key=False, nullable=False, server_default=text('0'))
    created_at: Mapped[str] = mapped_column(Text, primary_key=False, nullable=False)
    expires_at: Mapped[str] = mapped_column(Text, primary_key=False, nullable=False)
    last_viewed_at: Mapped[str | None] = mapped_column(Text, primary_key=False, nullable=True)

# 2026-10-24：本次修改原因：Reference Library 目标实体字段与约束采用统一数据库契约。
class Articles(TargetBase):
    __tablename__ = 'articles'
    __doc__ = 'Reference Library'
    __table_args__ = (ForeignKeyConstraint(['id', 'current_revision_id'], ['article_revisions.article_id', 'article_revisions.id']),)
    id: Mapped[str] = mapped_column(Text, primary_key=True, nullable=False)
    platform_id: Mapped[str] = mapped_column(Text, primary_key=False, nullable=False)
    category_id: Mapped[str | None] = mapped_column(Text, primary_key=False, nullable=True)
    content_format_id: Mapped[str | None] = mapped_column(Text, primary_key=False, nullable=True)
    genre_id: Mapped[str | None] = mapped_column(Text, primary_key=False, nullable=True)
    audience_id: Mapped[str | None] = mapped_column(Text, primary_key=False, nullable=True)
    topic: Mapped[str | None] = mapped_column(Text, primary_key=False, nullable=True)
    tags_json: Mapped[str] = mapped_column(Text, primary_key=False, nullable=False)
    title: Mapped[str] = mapped_column(Text, primary_key=False, nullable=False)
    summary: Mapped[str | None] = mapped_column(Text, primary_key=False, nullable=True)
    body_text: Mapped[str | None] = mapped_column(Text, primary_key=False, nullable=True)
    author_name: Mapped[str | None] = mapped_column(Text, primary_key=False, nullable=True)
    published_at: Mapped[str | None] = mapped_column(Text, primary_key=False, nullable=True)
    article_url: Mapped[str | None] = mapped_column(Text, primary_key=False, nullable=True)
    canonical_url: Mapped[str | None] = mapped_column(Text, primary_key=False, nullable=True)
    review_status: Mapped[str] = mapped_column(Text, primary_key=False, nullable=False)
    content_status: Mapped[str] = mapped_column(Text, primary_key=False, nullable=False)
    rights_status: Mapped[str] = mapped_column(Text, primary_key=False, nullable=False)
    rights_scope_json: Mapped[str] = mapped_column(Text, primary_key=False, nullable=False)
    rights_evidence: Mapped[str | None] = mapped_column(Text, primary_key=False, nullable=True)
    quality_score: Mapped[int | None] = mapped_column(Integer, primary_key=False, nullable=True)
    current_revision_no: Mapped[int] = mapped_column(Integer, primary_key=False, nullable=False)
    current_revision_id: Mapped[str | None] = mapped_column(Text, primary_key=False, nullable=True)
    field_provenance_json: Mapped[str] = mapped_column(Text, primary_key=False, nullable=False)
    row_version: Mapped[int] = mapped_column(Integer, primary_key=False, nullable=False, server_default=text('1'))
    collected_at: Mapped[str | None] = mapped_column(Text, primary_key=False, nullable=True)
    deleted_at: Mapped[str | None] = mapped_column(Text, primary_key=False, nullable=True)
    created_at: Mapped[str] = mapped_column(Text, primary_key=False, nullable=False)
    updated_at: Mapped[str] = mapped_column(Text, primary_key=False, nullable=False)

# 2026-10-24：本次修改原因：Reference Library 目标实体字段与约束采用统一数据库契约。
class DiscoveryFetches(TargetBase):
    __tablename__ = 'discovery_fetches'
    __doc__ = 'Reference Library'
    id: Mapped[str] = mapped_column(Text, primary_key=True, nullable=False)
    session_id: Mapped[str] = mapped_column(Text, ForeignKey('discovery_sessions.id'), primary_key=False, nullable=False)
    request_params_json: Mapped[str] = mapped_column(Text, primary_key=False, nullable=False)
    raw_response_json: Mapped[str] = mapped_column(Text, primary_key=False, nullable=False)
    upstream_cursor: Mapped[str | None] = mapped_column(Text, primary_key=False, nullable=True)
    result_count: Mapped[int | None] = mapped_column(Integer, primary_key=False, nullable=True)
    has_more: Mapped[int | None] = mapped_column(Integer, primary_key=False, nullable=True)
    fetched_at: Mapped[str] = mapped_column(Text, primary_key=False, nullable=False)

# 2026-10-24：本次修改原因：Reference Library 目标实体字段与约束采用统一数据库契约。
class DiscoveryCandidates(TargetBase):
    __tablename__ = 'discovery_candidates'
    __doc__ = 'Reference Library'
    __table_args__ = (UniqueConstraint('session_id', 'candidate_key'),)
    id: Mapped[str] = mapped_column(Text, primary_key=True, nullable=False)
    session_id: Mapped[str] = mapped_column(Text, ForeignKey('discovery_sessions.id'), primary_key=False, nullable=False)
    fetch_id: Mapped[str] = mapped_column(Text, ForeignKey('discovery_fetches.id'), primary_key=False, nullable=False)
    candidate_kind: Mapped[str] = mapped_column(Text, primary_key=False, nullable=False)
    provider: Mapped[str] = mapped_column(Text, primary_key=False, nullable=False)
    endpoint: Mapped[str] = mapped_column(Text, primary_key=False, nullable=False)
    external_id: Mapped[str | None] = mapped_column(Text, primary_key=False, nullable=True)
    candidate_key: Mapped[str] = mapped_column(Text, primary_key=False, nullable=False)
    raw_item_json: Mapped[str] = mapped_column(Text, primary_key=False, nullable=False)
    normalized_json: Mapped[str] = mapped_column(Text, primary_key=False, nullable=False)
    field_provenance_json: Mapped[str] = mapped_column(Text, primary_key=False, nullable=False)
    edit_draft_json: Mapped[str | None] = mapped_column(Text, primary_key=False, nullable=True)
    row_version: Mapped[int] = mapped_column(Integer, primary_key=False, nullable=False, server_default=text('1'))
    parser_version: Mapped[str] = mapped_column(Text, primary_key=False, nullable=False)
    warnings_json: Mapped[str] = mapped_column(Text, primary_key=False, nullable=False)
    content_status: Mapped[str] = mapped_column(Text, primary_key=False, nullable=False)
    pinned: Mapped[int] = mapped_column(Integer, primary_key=False, nullable=False, server_default=text('0'))
    collected_article_id: Mapped[str | None] = mapped_column(Text, ForeignKey('articles.id'), primary_key=False, nullable=True)
    discovered_at: Mapped[str] = mapped_column(Text, primary_key=False, nullable=False)
    updated_at: Mapped[str] = mapped_column(Text, primary_key=False, nullable=False)

# 2026-10-24：本次修改原因：Reference Library 目标实体字段与约束采用统一数据库契约。
class ArticleSources(TargetBase):
    __tablename__ = 'article_sources'
    __doc__ = 'Reference Library'
    id: Mapped[str] = mapped_column(Text, primary_key=True, nullable=False)
    article_id: Mapped[str] = mapped_column(Text, ForeignKey('articles.id'), primary_key=False, nullable=False)
    discovery_candidate_id: Mapped[str | None] = mapped_column(Text, ForeignKey('discovery_candidates.id', ondelete='SET NULL'), primary_key=False, nullable=True)
    acquisition_method: Mapped[str] = mapped_column(Text, primary_key=False, nullable=False)
    provider: Mapped[str] = mapped_column(Text, primary_key=False, nullable=False)
    endpoint: Mapped[str | None] = mapped_column(Text, primary_key=False, nullable=True)
    external_id: Mapped[str | None] = mapped_column(Text, primary_key=False, nullable=True)
    source_url: Mapped[str | None] = mapped_column(Text, primary_key=False, nullable=True)
    source_category: Mapped[str | None] = mapped_column(Text, primary_key=False, nullable=True)
    request_params_json: Mapped[str] = mapped_column(Text, primary_key=False, nullable=False)
    response_meta_json: Mapped[str] = mapped_column(Text, primary_key=False, nullable=False)
    field_mapping_json: Mapped[str] = mapped_column(Text, primary_key=False, nullable=False)
    raw_item_hash: Mapped[str | None] = mapped_column(Text, primary_key=False, nullable=True)
    raw_content_hash: Mapped[str | None] = mapped_column(Text, primary_key=False, nullable=True)
    content_format: Mapped[str] = mapped_column(Text, primary_key=False, nullable=False)
    raw_complete: Mapped[int] = mapped_column(Integer, primary_key=False, nullable=False)
    parser_version: Mapped[str] = mapped_column(Text, primary_key=False, nullable=False)
    warnings_json: Mapped[str] = mapped_column(Text, primary_key=False, nullable=False)
    fetched_at: Mapped[str] = mapped_column(Text, primary_key=False, nullable=False)

# 2026-10-24：本次修改原因：Reference Library 目标实体字段与约束采用统一数据库契约。
class ArticleSourcePayloads(TargetBase):
    __tablename__ = 'article_source_payloads'
    __doc__ = 'Reference Library'
    source_id: Mapped[str] = mapped_column(Text, ForeignKey('article_sources.id'), primary_key=True, nullable=False)
    raw_item_json: Mapped[str] = mapped_column(Text, primary_key=False, nullable=False)
    raw_content: Mapped[str | None] = mapped_column(Text, primary_key=False, nullable=True)
    stored_at: Mapped[str] = mapped_column(Text, primary_key=False, nullable=False)
    retain_until: Mapped[str | None] = mapped_column(Text, primary_key=False, nullable=True)

# 2026-10-24：本次修改原因：Reference Library 目标实体字段与约束采用统一数据库契约。
class RightsDecisions(TargetBase):
    __tablename__ = 'rights_decisions'
    __doc__ = 'Reference Library'
    id: Mapped[str] = mapped_column(Text, primary_key=True, nullable=False)
    article_id: Mapped[str] = mapped_column(Text, ForeignKey('articles.id'), primary_key=False, nullable=False)
    source_id: Mapped[str | None] = mapped_column(Text, ForeignKey('article_sources.id'), primary_key=False, nullable=True)
    status: Mapped[str] = mapped_column(Text, primary_key=False, nullable=False)
    scope_json: Mapped[str] = mapped_column(Text, primary_key=False, nullable=False)
    evidence: Mapped[str | None] = mapped_column(Text, primary_key=False, nullable=True)
    policy_version: Mapped[str] = mapped_column(Text, primary_key=False, nullable=False)
    supersedes_id: Mapped[str | None] = mapped_column(Text, ForeignKey('rights_decisions.id'), primary_key=False, nullable=True)
    effective_at: Mapped[str] = mapped_column(Text, primary_key=False, nullable=False)
    expires_at: Mapped[str | None] = mapped_column(Text, primary_key=False, nullable=True)
    recorded_at: Mapped[str] = mapped_column(Text, primary_key=False, nullable=False)

# 2026-10-24：本次修改原因：Reference Library 目标实体字段与约束采用统一数据库契约。
class ArticleMetrics(TargetBase):
    __tablename__ = 'article_metrics'
    __doc__ = 'Reference Library'
    id: Mapped[str] = mapped_column(Text, primary_key=True, nullable=False)
    article_id: Mapped[str] = mapped_column(Text, ForeignKey('articles.id'), primary_key=False, nullable=False)
    source_id: Mapped[str | None] = mapped_column(Text, ForeignKey('article_sources.id'), primary_key=False, nullable=True)
    source_label: Mapped[str] = mapped_column(Text, primary_key=False, nullable=False)
    observed_at: Mapped[str] = mapped_column(Text, primary_key=False, nullable=False)
    read_raw: Mapped[str | None] = mapped_column(Text, primary_key=False, nullable=True)
    read_exact: Mapped[int | None] = mapped_column(Integer, primary_key=False, nullable=True)
    read_lower_bound: Mapped[int | None] = mapped_column(Integer, primary_key=False, nullable=True)
    likes: Mapped[int | None] = mapped_column(Integer, primary_key=False, nullable=True)
    watch_count: Mapped[int | None] = mapped_column(Integer, primary_key=False, nullable=True)
    comments: Mapped[int | None] = mapped_column(Integer, primary_key=False, nullable=True)
    shares: Mapped[int | None] = mapped_column(Integer, primary_key=False, nullable=True)
    saves: Mapped[int | None] = mapped_column(Integer, primary_key=False, nullable=True)
    rewards: Mapped[int | None] = mapped_column(Integer, primary_key=False, nullable=True)
    fans_count: Mapped[int | None] = mapped_column(Integer, primary_key=False, nullable=True)
    interactive_count: Mapped[int | None] = mapped_column(Integer, primary_key=False, nullable=True)
    impressions: Mapped[int | None] = mapped_column(Integer, primary_key=False, nullable=True)
    clicks: Mapped[int | None] = mapped_column(Integer, primary_key=False, nullable=True)
    extra_metrics_json: Mapped[str] = mapped_column(Text, primary_key=False, nullable=False)
    parse_warnings_json: Mapped[str] = mapped_column(Text, primary_key=False, nullable=False)
    field_provenance_json: Mapped[str] = mapped_column(Text, primary_key=False, nullable=False)

# 2026-10-24：本次修改原因：Reference Library 目标实体字段与约束采用统一数据库契约。
class ArticleRevisions(TargetBase):
    __tablename__ = 'article_revisions'
    __doc__ = 'Reference Library'
    __table_args__ = (UniqueConstraint('article_id', 'id'), UniqueConstraint('article_id', 'revision_number'),)
    id: Mapped[str] = mapped_column(Text, primary_key=True, nullable=False)
    article_id: Mapped[str] = mapped_column(Text, ForeignKey('articles.id'), primary_key=False, nullable=False)
    revision_number: Mapped[int] = mapped_column(Integer, primary_key=False, nullable=False)
    title: Mapped[str] = mapped_column(Text, primary_key=False, nullable=False)
    summary: Mapped[str | None] = mapped_column(Text, primary_key=False, nullable=True)
    body_text: Mapped[str | None] = mapped_column(Text, primary_key=False, nullable=True)
    author_name: Mapped[str | None] = mapped_column(Text, primary_key=False, nullable=True)
    published_at: Mapped[str | None] = mapped_column(Text, primary_key=False, nullable=True)
    category_id: Mapped[str | None] = mapped_column(Text, primary_key=False, nullable=True)
    content_format_id: Mapped[str | None] = mapped_column(Text, primary_key=False, nullable=True)
    genre_id: Mapped[str | None] = mapped_column(Text, primary_key=False, nullable=True)
    article_url: Mapped[str | None] = mapped_column(Text, primary_key=False, nullable=True)
    snapshot_json: Mapped[str] = mapped_column(Text, primary_key=False, nullable=False)
    field_provenance_json: Mapped[str] = mapped_column(Text, primary_key=False, nullable=False)
    edited_fields_json: Mapped[str] = mapped_column(Text, primary_key=False, nullable=False)
    editor_note: Mapped[str | None] = mapped_column(Text, primary_key=False, nullable=True)
    created_at: Mapped[str] = mapped_column(Text, primary_key=False, nullable=False)

# 2026-10-24：本次修改原因：Reference Library 目标实体字段与约束采用统一数据库契约。
class PreparedArticles(TargetBase):
    __tablename__ = 'prepared_articles'
    __doc__ = 'Reference Library'
    __table_args__ = (UniqueConstraint('article_id', 'input_origin', 'input_ref_id', 'input_hash', 'preparation_config_hash', 'cleaner_version'),)
    id: Mapped[str] = mapped_column(Text, primary_key=True, nullable=False)
    article_id: Mapped[str] = mapped_column(Text, ForeignKey('articles.id'), primary_key=False, nullable=False)
    article_revision_id: Mapped[str | None] = mapped_column(Text, ForeignKey('article_revisions.id'), primary_key=False, nullable=True)
    source_id: Mapped[str | None] = mapped_column(Text, ForeignKey('article_sources.id'), primary_key=False, nullable=True)
    input_origin: Mapped[str] = mapped_column(Text, primary_key=False, nullable=False)
    input_ref_id: Mapped[str] = mapped_column(Text, primary_key=False, nullable=False)
    input_format: Mapped[str] = mapped_column(Text, primary_key=False, nullable=False)
    input_hash: Mapped[str] = mapped_column(Text, primary_key=False, nullable=False)
    content_hash: Mapped[str] = mapped_column(Text, primary_key=False, nullable=False)
    preparation_config_hash: Mapped[str] = mapped_column(Text, primary_key=False, nullable=False)
    cleaner_version: Mapped[str] = mapped_column(Text, primary_key=False, nullable=False)
    reused_from_prepared_id: Mapped[str | None] = mapped_column(Text, ForeignKey('prepared_articles.id'), primary_key=False, nullable=True)
    clean_title: Mapped[str | None] = mapped_column(Text, primary_key=False, nullable=True)
    clean_text: Mapped[str | None] = mapped_column(Text, primary_key=False, nullable=True)
    blocks_json: Mapped[str] = mapped_column(Text, primary_key=False, nullable=False)
    keywords_json: Mapped[str] = mapped_column(Text, primary_key=False, nullable=False)
    quality_flags_json: Mapped[str] = mapped_column(Text, primary_key=False, nullable=False)
    content_status: Mapped[str] = mapped_column(Text, primary_key=False, nullable=False)
    status: Mapped[str] = mapped_column(Text, primary_key=False, nullable=False)
    created_at: Mapped[str] = mapped_column(Text, primary_key=False, nullable=False)
    completed_at: Mapped[str | None] = mapped_column(Text, primary_key=False, nullable=True)
    error_code: Mapped[str | None] = mapped_column(Text, primary_key=False, nullable=True)

# 2026-10-24：本次修改原因：Content Intelligence 目标实体字段与约束采用统一数据库契约。
class ArticleFeatures(TargetBase):
    __tablename__ = 'article_features'
    __doc__ = 'Content Intelligence'
    __table_args__ = (UniqueConstraint('prepared_article_id', 'feature_group', 'analysis_input_hash', 'analysis_config_hash', 'analyzer_version'),)
    id: Mapped[str] = mapped_column(Text, primary_key=True, nullable=False)
    article_id: Mapped[str] = mapped_column(Text, ForeignKey('articles.id'), primary_key=False, nullable=False)
    prepared_article_id: Mapped[str] = mapped_column(Text, ForeignKey('prepared_articles.id'), primary_key=False, nullable=False)
    feature_group: Mapped[str] = mapped_column(Text, primary_key=False, nullable=False)
    analysis_input_hash: Mapped[str] = mapped_column(Text, primary_key=False, nullable=False)
    analysis_config_hash: Mapped[str] = mapped_column(Text, primary_key=False, nullable=False)
    analyzer_version: Mapped[str] = mapped_column(Text, primary_key=False, nullable=False)
    skill_version: Mapped[str] = mapped_column(Text, primary_key=False, nullable=False)
    reused_from_feature_id: Mapped[str | None] = mapped_column(Text, ForeignKey('article_features.id'), primary_key=False, nullable=True)
    model_id: Mapped[str | None] = mapped_column(Text, primary_key=False, nullable=True)
    prompt_version: Mapped[str | None] = mapped_column(Text, primary_key=False, nullable=True)
    features_json: Mapped[str] = mapped_column(Text, primary_key=False, nullable=False)
    evidence_json: Mapped[str] = mapped_column(Text, primary_key=False, nullable=False)
    uncertainty_json: Mapped[str] = mapped_column(Text, primary_key=False, nullable=False)
    status: Mapped[str] = mapped_column(Text, primary_key=False, nullable=False)
    created_at: Mapped[str] = mapped_column(Text, primary_key=False, nullable=False)
    completed_at: Mapped[str | None] = mapped_column(Text, primary_key=False, nullable=True)

# 2026-10-24：本次修改原因：Reference Library 目标实体字段与约束采用统一数据库契约。
class ArticleCollections(TargetBase):
    __tablename__ = 'article_collections'
    __doc__ = 'Reference Library'
    id: Mapped[str] = mapped_column(Text, primary_key=True, nullable=False)
    name: Mapped[str] = mapped_column(Text, primary_key=False, nullable=False)
    filter_json: Mapped[str] = mapped_column(Text, primary_key=False, nullable=False)
    selection_mode: Mapped[str] = mapped_column(Text, primary_key=False, nullable=False)
    version: Mapped[int] = mapped_column(Integer, primary_key=False, nullable=False)
    row_version: Mapped[int] = mapped_column(Integer, primary_key=False, nullable=False, server_default=text('1'))
    created_at: Mapped[str] = mapped_column(Text, primary_key=False, nullable=False)
    updated_at: Mapped[str] = mapped_column(Text, primary_key=False, nullable=False)

# 2026-10-24：本次修改原因：Reference Library 目标实体字段与约束采用统一数据库契约。
class ArticleCollectionItems(TargetBase):
    __tablename__ = 'article_collection_items'
    __doc__ = 'Reference Library'
    collection_id: Mapped[str] = mapped_column(Text, ForeignKey('article_collections.id'), primary_key=True, nullable=False)
    article_id: Mapped[str] = mapped_column(Text, ForeignKey('articles.id'), primary_key=True, nullable=False)
    added_at: Mapped[str] = mapped_column(Text, primary_key=False, nullable=False)

# 2026-10-24：本次修改原因：Reference Library 目标实体字段与约束采用统一数据库契约。
class ArticleCollectionSnapshots(TargetBase):
    __tablename__ = 'article_collection_snapshots'
    __doc__ = 'Reference Library'
    __table_args__ = (UniqueConstraint('collection_id', 'version_number'),)
    id: Mapped[str] = mapped_column(Text, primary_key=True, nullable=False)
    collection_id: Mapped[str] = mapped_column(Text, ForeignKey('article_collections.id'), primary_key=False, nullable=False)
    version_number: Mapped[int] = mapped_column(Integer, primary_key=False, nullable=False)
    collection_version: Mapped[int] = mapped_column(Integer, primary_key=False, nullable=False)
    filter_json: Mapped[str] = mapped_column(Text, primary_key=False, nullable=False)
    sampling_config_json: Mapped[str] = mapped_column(Text, primary_key=False, nullable=False)
    random_seed: Mapped[str | None] = mapped_column(Text, primary_key=False, nullable=True)
    candidate_count: Mapped[int] = mapped_column(Integer, primary_key=False, nullable=False)
    included_count: Mapped[int] = mapped_column(Integer, primary_key=False, nullable=False)
    excluded_count: Mapped[int] = mapped_column(Integer, primary_key=False, nullable=False)
    frozen_at: Mapped[str | None] = mapped_column(Text, primary_key=False, nullable=True)
    status: Mapped[str] = mapped_column(Text, primary_key=False, nullable=False, server_default=text("'selection_building'"))
    sealed_at: Mapped[str | None] = mapped_column(Text, primary_key=False, nullable=True)
    row_version: Mapped[int] = mapped_column(Integer, primary_key=False, nullable=False, server_default=text('1'))

# 2026-10-24：本次修改原因：Reference Library 目标实体字段与约束采用统一数据库契约。
class ArticleCollectionSnapshotItems(TargetBase):
    __tablename__ = 'article_collection_snapshot_items'
    __doc__ = 'Reference Library'
    __table_args__ = (UniqueConstraint('snapshot_id', 'article_id'),)
    id: Mapped[str] = mapped_column(Text, primary_key=True, nullable=False)
    snapshot_id: Mapped[str] = mapped_column(Text, ForeignKey('article_collection_snapshots.id'), primary_key=False, nullable=False)
    article_id: Mapped[str] = mapped_column(Text, ForeignKey('articles.id'), primary_key=False, nullable=False)
    article_revision_id: Mapped[str | None] = mapped_column(Text, ForeignKey('article_revisions.id'), primary_key=False, nullable=True)
    prepared_article_id: Mapped[str | None] = mapped_column(Text, ForeignKey('prepared_articles.id'), primary_key=False, nullable=True)
    stratum_json: Mapped[str] = mapped_column(Text, primary_key=False, nullable=False)
    included: Mapped[int] = mapped_column(Integer, primary_key=False, nullable=False)
    exclusion_reason: Mapped[str | None] = mapped_column(Text, primary_key=False, nullable=True)

# 2026-10-24：本次修改原因：Reference Library 目标实体字段与约束采用统一数据库契约。
class ArticleCollectionSnapshotFeatures(TargetBase):
    __tablename__ = 'article_collection_snapshot_features'
    __doc__ = 'Reference Library'
    snapshot_item_id: Mapped[str] = mapped_column(Text, ForeignKey('article_collection_snapshot_items.id'), primary_key=True, nullable=False)
    feature_id: Mapped[str] = mapped_column(Text, ForeignKey('article_features.id'), primary_key=True, nullable=False)

# 2026-10-24：本次修改原因：Content Intelligence 目标实体字段与约束采用统一数据库契约。
class StyleProfiles(TargetBase):
    __tablename__ = 'style_profiles'
    __doc__ = 'Content Intelligence'
    id: Mapped[str] = mapped_column(Text, primary_key=True, nullable=False)
    name: Mapped[str] = mapped_column(Text, primary_key=False, nullable=False)
    platform_id: Mapped[str | None] = mapped_column(Text, primary_key=False, nullable=True)
    genre_id: Mapped[str | None] = mapped_column(Text, primary_key=False, nullable=True)
    current_version_id: Mapped[str | None] = mapped_column(Text, primary_key=False, nullable=True)
    created_at: Mapped[str] = mapped_column(Text, primary_key=False, nullable=False)
    updated_at: Mapped[str] = mapped_column(Text, primary_key=False, nullable=False)

# 2026-10-24：本次修改原因：Content Intelligence 目标实体字段与约束采用统一数据库契约。
class StyleProfileVersions(TargetBase):
    __tablename__ = 'style_profile_versions'
    __doc__ = 'Content Intelligence'
    __table_args__ = (UniqueConstraint('profile_id', 'version_number'),)
    id: Mapped[str] = mapped_column(Text, primary_key=True, nullable=False)
    profile_id: Mapped[str] = mapped_column(Text, ForeignKey('style_profiles.id'), primary_key=False, nullable=False)
    version_number: Mapped[int] = mapped_column(Integer, primary_key=False, nullable=False)
    collection_snapshot_id: Mapped[str] = mapped_column(Text, ForeignKey('article_collection_snapshots.id'), primary_key=False, nullable=False)
    profile_json: Mapped[str] = mapped_column(Text, primary_key=False, nullable=False)
    sample_count: Mapped[int] = mapped_column(Integer, primary_key=False, nullable=False)
    valid_sample_count: Mapped[int] = mapped_column(Integer, primary_key=False, nullable=False)
    exclusion_reasons_json: Mapped[str] = mapped_column(Text, primary_key=False, nullable=False)
    sample_distribution_json: Mapped[str] = mapped_column(Text, primary_key=False, nullable=False)
    outlier_method_json: Mapped[str] = mapped_column(Text, primary_key=False, nullable=False)
    evidence_coverage_json: Mapped[str] = mapped_column(Text, primary_key=False, nullable=False)
    uncertainty_json: Mapped[str] = mapped_column(Text, primary_key=False, nullable=False)
    analyzer_version: Mapped[str] = mapped_column(Text, primary_key=False, nullable=False)
    status: Mapped[str] = mapped_column(Text, primary_key=False, nullable=False)
    reviewer_note: Mapped[str | None] = mapped_column(Text, primary_key=False, nullable=True)
    reviewed_at: Mapped[str | None] = mapped_column(Text, primary_key=False, nullable=True)
    created_at: Mapped[str] = mapped_column(Text, primary_key=False, nullable=False)

# 2026-10-24：本次修改原因：Content Intelligence 目标实体字段与约束采用统一数据库契约。
class StyleProfileInputs(TargetBase):
    __tablename__ = 'style_profile_inputs'
    __doc__ = 'Content Intelligence'
    profile_version_id: Mapped[str] = mapped_column(Text, ForeignKey('style_profile_versions.id'), primary_key=True, nullable=False)
    snapshot_item_id: Mapped[str] = mapped_column(Text, ForeignKey('article_collection_snapshot_items.id'), primary_key=False, nullable=False)
    feature_id: Mapped[str] = mapped_column(Text, ForeignKey('article_features.id'), primary_key=True, nullable=False)

# 2026-10-24：本次修改原因：Content Intelligence 目标实体字段与约束采用统一数据库契约。
class PerformanceAnalyses(TargetBase):
    __tablename__ = 'performance_analyses'
    __doc__ = 'Content Intelligence'
    __table_args__ = (UniqueConstraint('collection_snapshot_id', 'analysis_config_hash', 'method_version'),)
    id: Mapped[str] = mapped_column(Text, primary_key=True, nullable=False)
    collection_snapshot_id: Mapped[str] = mapped_column(Text, ForeignKey('article_collection_snapshots.id'), primary_key=False, nullable=False)
    analysis_config_hash: Mapped[str] = mapped_column(Text, primary_key=False, nullable=False)
    method_version: Mapped[str] = mapped_column(Text, primary_key=False, nullable=False)
    result_json: Mapped[str] = mapped_column(Text, primary_key=False, nullable=False)
    valid_sample_count: Mapped[int] = mapped_column(Integer, primary_key=False, nullable=False)
    missing_count: Mapped[int] = mapped_column(Integer, primary_key=False, nullable=False)
    censored_count: Mapped[int] = mapped_column(Integer, primary_key=False, nullable=False)
    exclusion_reasons_json: Mapped[str] = mapped_column(Text, primary_key=False, nullable=False)
    status: Mapped[str] = mapped_column(Text, primary_key=False, nullable=False)
    reviewer_note: Mapped[str | None] = mapped_column(Text, primary_key=False, nullable=True)
    reviewed_at: Mapped[str | None] = mapped_column(Text, primary_key=False, nullable=True)
    created_at: Mapped[str] = mapped_column(Text, primary_key=False, nullable=False)

# 2026-10-24：本次修改原因：Content Intelligence 目标实体字段与约束采用统一数据库契约。
class PerformanceAnalysisSamples(TargetBase):
    __tablename__ = 'performance_analysis_samples'
    __doc__ = 'Content Intelligence'
    analysis_id: Mapped[str] = mapped_column(Text, ForeignKey('performance_analyses.id'), primary_key=True, nullable=False)
    snapshot_item_id: Mapped[str] = mapped_column(Text, ForeignKey('article_collection_snapshot_items.id'), primary_key=True, nullable=False)
    metric_id: Mapped[str | None] = mapped_column(Text, ForeignKey('article_metrics.id'), primary_key=False, nullable=True)
    value_semantics: Mapped[str] = mapped_column(Text, primary_key=False, nullable=False)
    group_json: Mapped[str] = mapped_column(Text, primary_key=False, nullable=False)
    inclusion_reason: Mapped[str | None] = mapped_column(Text, primary_key=False, nullable=True)
    exclusion_reason: Mapped[str | None] = mapped_column(Text, primary_key=False, nullable=True)

# 2026-10-24：本次修改原因：Content Strategy 目标实体字段与约束采用统一数据库契约。
class ContentStrategies(TargetBase):
    __tablename__ = 'content_strategies'
    __doc__ = 'Content Strategy'
    id: Mapped[str] = mapped_column(Text, primary_key=True, nullable=False)
    name: Mapped[str] = mapped_column(Text, primary_key=False, nullable=False)
    platform_id: Mapped[str | None] = mapped_column(Text, primary_key=False, nullable=True)
    category_id: Mapped[str | None] = mapped_column(Text, primary_key=False, nullable=True)
    content_format_id: Mapped[str | None] = mapped_column(Text, primary_key=False, nullable=True)
    audience_id: Mapped[str | None] = mapped_column(Text, primary_key=False, nullable=True)
    genre_id: Mapped[str | None] = mapped_column(Text, primary_key=False, nullable=True)
    current_version_id: Mapped[str | None] = mapped_column(Text, primary_key=False, nullable=True)
    created_at: Mapped[str] = mapped_column(Text, primary_key=False, nullable=False)
    updated_at: Mapped[str] = mapped_column(Text, primary_key=False, nullable=False)

# 2026-10-24：本次修改原因：Content Strategy 目标实体字段与约束采用统一数据库契约。
class ContentStrategyVersions(TargetBase):
    __tablename__ = 'content_strategy_versions'
    __doc__ = 'Content Strategy'
    __table_args__ = (UniqueConstraint('strategy_id', 'version_number'),)
    id: Mapped[str] = mapped_column(Text, primary_key=True, nullable=False)
    strategy_id: Mapped[str] = mapped_column(Text, ForeignKey('content_strategies.id'), primary_key=False, nullable=False)
    version_number: Mapped[int] = mapped_column(Integer, primary_key=False, nullable=False)
    style_profile_version_id: Mapped[str | None] = mapped_column(Text, ForeignKey('style_profile_versions.id'), primary_key=False, nullable=True)
    performance_analysis_id: Mapped[str | None] = mapped_column(Text, ForeignKey('performance_analyses.id'), primary_key=False, nullable=True)
    rules_json: Mapped[str] = mapped_column(Text, primary_key=False, nullable=False)
    source_snapshot_json: Mapped[str] = mapped_column(Text, primary_key=False, nullable=False)
    skill_version: Mapped[str | None] = mapped_column(Text, primary_key=False, nullable=True)
    prompt_version: Mapped[str | None] = mapped_column(Text, primary_key=False, nullable=True)
    status: Mapped[str] = mapped_column(Text, primary_key=False, nullable=False)
    reviewer_note: Mapped[str | None] = mapped_column(Text, primary_key=False, nullable=True)
    published_at: Mapped[str | None] = mapped_column(Text, primary_key=False, nullable=True)
    created_at: Mapped[str] = mapped_column(Text, primary_key=False, nullable=False)

# 2026-10-24：本次修改原因：Content Strategy 目标实体字段与约束采用统一数据库契约。
class StrategyArticleRefs(TargetBase):
    __tablename__ = 'strategy_article_refs'
    __doc__ = 'Content Strategy'
    id: Mapped[str] = mapped_column(Text, primary_key=True, nullable=False)
    strategy_version_id: Mapped[str] = mapped_column(Text, ForeignKey('content_strategy_versions.id'), primary_key=False, nullable=False)
    article_id: Mapped[str | None] = mapped_column(Text, ForeignKey('articles.id'), primary_key=False, nullable=True)
    legacy_article_id: Mapped[str | None] = mapped_column(Text, primary_key=False, nullable=True)
    title_snapshot: Mapped[str] = mapped_column(Text, primary_key=False, nullable=False)
    url_snapshot: Mapped[str | None] = mapped_column(Text, primary_key=False, nullable=True)
    source_provider: Mapped[str | None] = mapped_column(Text, primary_key=False, nullable=True)

# 2026-10-24：本次修改原因：Infrastructure 目标实体字段与约束采用统一数据库契约。
class ProcessingJobs(TargetBase):
    __tablename__ = 'processing_jobs'
    __doc__ = 'Infrastructure'
    id: Mapped[str] = mapped_column(Text, primary_key=True, nullable=False)
    job_type: Mapped[str] = mapped_column(Text, primary_key=False, nullable=False)
    target_type: Mapped[str] = mapped_column(Text, primary_key=False, nullable=False)
    target_id: Mapped[str | None] = mapped_column(Text, primary_key=False, nullable=True)
    status: Mapped[str] = mapped_column(Text, primary_key=False, nullable=False)
    progress: Mapped[int] = mapped_column(Integer, primary_key=False, nullable=False, server_default=text('0'))
    attempt_count: Mapped[int] = mapped_column(Integer, primary_key=False, nullable=False, server_default=text('0'))
    max_attempts: Mapped[int] = mapped_column(Integer, primary_key=False, nullable=False)
    idempotency_key: Mapped[str | None] = mapped_column(Text, primary_key=False, nullable=True)
    input_hash: Mapped[str | None] = mapped_column(Text, primary_key=False, nullable=True)
    config_hash: Mapped[str | None] = mapped_column(Text, primary_key=False, nullable=True)
    input_versions_json: Mapped[str] = mapped_column(Text, primary_key=False, nullable=False)
    input_json: Mapped[str] = mapped_column(Text, primary_key=False, nullable=False)
    result_json: Mapped[str | None] = mapped_column(Text, primary_key=False, nullable=True)
    lease_owner: Mapped[str | None] = mapped_column(Text, primary_key=False, nullable=True)
    lease_until: Mapped[str | None] = mapped_column(Text, primary_key=False, nullable=True)
    heartbeat_at: Mapped[str | None] = mapped_column(Text, primary_key=False, nullable=True)
    row_version: Mapped[int] = mapped_column(Integer, primary_key=False, nullable=False, server_default=text('1'))
    error_code: Mapped[str | None] = mapped_column(Text, primary_key=False, nullable=True)
    error_message: Mapped[str | None] = mapped_column(Text, primary_key=False, nullable=True)
    created_at: Mapped[str] = mapped_column(Text, primary_key=False, nullable=False)
    started_at: Mapped[str | None] = mapped_column(Text, primary_key=False, nullable=True)
    completed_at: Mapped[str | None] = mapped_column(Text, primary_key=False, nullable=True)

# 2026-10-24：本次修改原因：Content Studio 目标实体字段与约束采用统一数据库契约。
class GeneratedDocuments(TargetBase):
    __tablename__ = 'generated_documents'
    __doc__ = 'Content Studio'
    id: Mapped[str] = mapped_column(Text, primary_key=True, nullable=False)
    generation_job_id: Mapped[str | None] = mapped_column(Text, ForeignKey('processing_jobs.id'), primary_key=False, nullable=True)
    strategy_version_id: Mapped[str | None] = mapped_column(Text, ForeignKey('content_strategy_versions.id'), primary_key=False, nullable=True)
    brand_id: Mapped[str | None] = mapped_column(Text, ForeignKey('brands.id'), primary_key=False, nullable=True)
    brand_version: Mapped[int | None] = mapped_column(Integer, primary_key=False, nullable=True)
    target_platform_id: Mapped[str] = mapped_column(Text, primary_key=False, nullable=False)
    topic: Mapped[str] = mapped_column(Text, primary_key=False, nullable=False)
    audience_id: Mapped[str | None] = mapped_column(Text, primary_key=False, nullable=True)
    requirements_json: Mapped[str] = mapped_column(Text, primary_key=False, nullable=False)
    strategy_snapshot_json: Mapped[str] = mapped_column(Text, primary_key=False, nullable=False)
    brand_snapshot_json: Mapped[str] = mapped_column(Text, primary_key=False, nullable=False)
    created_at: Mapped[str] = mapped_column(Text, primary_key=False, nullable=False)

# 2026-10-24：本次修改原因：Content Studio 目标实体字段与约束采用统一数据库契约。
class GeneratedRevisions(TargetBase):
    __tablename__ = 'generated_revisions'
    __doc__ = 'Content Studio'
    __table_args__ = (UniqueConstraint('document_id', 'revision_number'),)
    id: Mapped[str] = mapped_column(Text, primary_key=True, nullable=False)
    document_id: Mapped[str] = mapped_column(Text, ForeignKey('generated_documents.id'), primary_key=False, nullable=False)
    revision_number: Mapped[int] = mapped_column(Integer, primary_key=False, nullable=False)
    origin: Mapped[str] = mapped_column(Text, primary_key=False, nullable=False)
    title: Mapped[str] = mapped_column(Text, primary_key=False, nullable=False)
    summary: Mapped[str | None] = mapped_column(Text, primary_key=False, nullable=True)
    body_markdown: Mapped[str] = mapped_column(Text, primary_key=False, nullable=False)
    provider: Mapped[str | None] = mapped_column(Text, primary_key=False, nullable=True)
    model_id: Mapped[str | None] = mapped_column(Text, primary_key=False, nullable=True)
    prompt_version: Mapped[str | None] = mapped_column(Text, primary_key=False, nullable=True)
    input_tokens: Mapped[int | None] = mapped_column(Integer, primary_key=False, nullable=True)
    output_tokens: Mapped[int | None] = mapped_column(Integer, primary_key=False, nullable=True)
    created_at: Mapped[str] = mapped_column(Text, primary_key=False, nullable=False)

# 2026-10-24：本次修改原因：Evaluation 目标实体字段与约束采用统一数据库契约。
class EvaluationRuns(TargetBase):
    __tablename__ = 'evaluation_runs'
    __doc__ = 'Evaluation'
    id: Mapped[str] = mapped_column(Text, primary_key=True, nullable=False)
    generated_revision_id: Mapped[str] = mapped_column(Text, ForeignKey('generated_revisions.id'), primary_key=False, nullable=False)
    profile_version_id: Mapped[str | None] = mapped_column(Text, ForeignKey('style_profile_versions.id'), primary_key=False, nullable=True)
    evaluator_version: Mapped[str] = mapped_column(Text, primary_key=False, nullable=False)
    dimensions_json: Mapped[str] = mapped_column(Text, primary_key=False, nullable=False)
    evidence_json: Mapped[str] = mapped_column(Text, primary_key=False, nullable=False)
    uncertainty_json: Mapped[str] = mapped_column(Text, primary_key=False, nullable=False)
    human_decision: Mapped[str | None] = mapped_column(Text, primary_key=False, nullable=True)
    status: Mapped[str] = mapped_column(Text, primary_key=False, nullable=False)
    created_at: Mapped[str] = mapped_column(Text, primary_key=False, nullable=False)

# 2026-10-24：本次修改原因：Infrastructure 目标实体字段与约束采用统一数据库契约。
class LegacyIdMap(TargetBase):
    __tablename__ = 'legacy_id_map'
    __doc__ = 'Infrastructure'
    legacy_table: Mapped[str] = mapped_column(Text, primary_key=True, nullable=False)
    legacy_id: Mapped[str] = mapped_column(Text, primary_key=True, nullable=False)
    target_table: Mapped[str] = mapped_column(Text, primary_key=True, nullable=False)
    target_id: Mapped[str] = mapped_column(Text, primary_key=False, nullable=False)
    migrated_at: Mapped[str] = mapped_column(Text, primary_key=False, nullable=False)
    checksum: Mapped[str] = mapped_column(Text, primary_key=False, nullable=False)

# 2026-10-24：本次修改原因：Infrastructure 目标实体字段与约束采用统一数据库契约。
class LegacyPayloadArchive(TargetBase):
    __tablename__ = 'legacy_payload_archive'
    __doc__ = 'Infrastructure'
    legacy_table: Mapped[str] = mapped_column(Text, primary_key=True, nullable=False)
    legacy_id: Mapped[str] = mapped_column(Text, primary_key=True, nullable=False)
    payload_json: Mapped[str] = mapped_column(Text, primary_key=False, nullable=False)
    payload_hash: Mapped[str] = mapped_column(Text, primary_key=False, nullable=False)
    migration_status: Mapped[str] = mapped_column(Text, primary_key=False, nullable=False)
    archived_at: Mapped[str] = mapped_column(Text, primary_key=False, nullable=False)
    retain_until: Mapped[str | None] = mapped_column(Text, primary_key=False, nullable=True)
    redacted_at: Mapped[str | None] = mapped_column(Text, primary_key=False, nullable=True)

# 2026-10-24：本次修改原因：Infrastructure 目标实体字段与约束采用统一数据库契约。
class DataDispositionEvents(TargetBase):
    __tablename__ = 'data_disposition_events'
    __doc__ = 'Infrastructure'
    id: Mapped[str] = mapped_column(Text, primary_key=True, nullable=False)
    target_type: Mapped[str] = mapped_column(Text, primary_key=False, nullable=False)
    target_id: Mapped[str] = mapped_column(Text, primary_key=False, nullable=False)
    article_id: Mapped[str | None] = mapped_column(Text, ForeignKey('articles.id'), primary_key=False, nullable=True)
    source_id: Mapped[str | None] = mapped_column(Text, ForeignKey('article_sources.id'), primary_key=False, nullable=True)
    reason: Mapped[str] = mapped_column(Text, primary_key=False, nullable=False)
    scope_json: Mapped[str] = mapped_column(Text, primary_key=False, nullable=False)
    status: Mapped[str] = mapped_column(Text, primary_key=False, nullable=False)
    requested_at: Mapped[str] = mapped_column(Text, primary_key=False, nullable=False)
    completed_at: Mapped[str | None] = mapped_column(Text, primary_key=False, nullable=True)
    error_summary: Mapped[str | None] = mapped_column(Text, primary_key=False, nullable=True)

Index('ix_discovery_session_expiry', DiscoverySessions.expires_at, DiscoverySessions.pinned)
Index('ix_discovery_fetch_session', DiscoveryFetches.session_id, DiscoveryFetches.fetched_at)
Index('ix_candidate_collected', DiscoveryCandidates.collected_article_id)
Index('ux_source_candidate', ArticleSources.discovery_candidate_id, unique=True, sqlite_where=text('discovery_candidate_id IS NOT NULL'), postgresql_where=text('discovery_candidate_id IS NOT NULL'))
Index('ix_article_filter', Articles.platform_id, Articles.category_id, Articles.genre_id, Articles.deleted_at)
Index('ux_article_canonical_url', Articles.platform_id, Articles.canonical_url, unique=True, sqlite_where=text('canonical_url IS NOT NULL AND deleted_at IS NULL'), postgresql_where=text('canonical_url IS NOT NULL AND deleted_at IS NULL'))
Index('ix_source_identity', ArticleSources.provider, ArticleSources.endpoint, ArticleSources.external_id)
Index('ix_metrics_history', ArticleMetrics.article_id, ArticleMetrics.observed_at)
Index('ix_rights_article', RightsDecisions.article_id, RightsDecisions.effective_at)
Index('ix_snapshot_items', ArticleCollectionSnapshotItems.snapshot_id, ArticleCollectionSnapshotItems.included)
Index('ix_performance_analysis', PerformanceAnalyses.collection_snapshot_id, PerformanceAnalyses.status)
Index('ix_disposition_status', DataDispositionEvents.status, DataDispositionEvents.requested_at)
Index('ix_strategy_article_refs', StrategyArticleRefs.strategy_version_id, StrategyArticleRefs.article_id)
Index('ix_prepared_current', PreparedArticles.article_id, PreparedArticles.status, PreparedArticles.created_at)
Index('ix_jobs_poll', ProcessingJobs.status, ProcessingJobs.lease_until, ProcessingJobs.created_at)
Index('ux_job_idempotency', ProcessingJobs.job_type, ProcessingJobs.idempotency_key, unique=True, sqlite_where=text('idempotency_key IS NOT NULL'), postgresql_where=text('idempotency_key IS NOT NULL'))
