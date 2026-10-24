# 2026-10-24：本次修改原因：Stage 2A 用一套 Pydantic 契约区分文章当前值、来源原件、修订、缺失值和字段溯源。
"""Reference Library contracts. No provider response shape is assumed here."""

from datetime import date, datetime, timezone
from enum import Enum
from typing import Any, Literal

from pydantic import AwareDatetime, BaseModel, ConfigDict, Field, field_validator, model_validator


class ProvenanceStatus(str, Enum):
    mapped = "mapped"
    missing = "missing"
    explicit_null = "explicit_null"
    approximate = "approximate"
    truncated = "truncated"
    manual_override = "manual_override"
    legacy_unverified = "legacy_unverified"


class FieldProvenance(BaseModel):
    origin: Literal["provider", "manual", "legacy", "transform"]
    status: ProvenanceStatus
    source_id: str | None = None
    source_path: str | None = None
    transform: str | None = None
    raw_value: Any = None
    revision_id: str | None = None


class ReadCount(BaseModel):
    raw: str | None = None
    exact: int | None = Field(default=None, ge=0)
    lower_bound: int | None = Field(default=None, ge=0)

    @model_validator(mode="after")
    def distinguish_exact_and_lower_bound(self) -> "ReadCount":
        if self.exact is not None and self.lower_bound is not None and self.exact != self.lower_bound:
            raise ValueError("Exact and lower-bound counts cannot disagree")
        return self


class ArticleEditable(BaseModel):
    model_config = ConfigDict(extra="forbid")
    platform_id: str
    category_id: str | None = None
    content_format_id: str | None = None
    genre_id: str | None = None
    audience_id: str | None = None
    topic: str | None = None
    tags: list[str] = Field(default_factory=list)
    title: str = Field(min_length=1)
    summary: str | None = None
    body_text: str | None = None
    author_name: str | None = None
    published_at: date | AwareDatetime | None = None
    article_url: str | None = None
    review_status: str = "pending"
    content_status: Literal["complete", "partial", "missing", "unknown"] = "unknown"
    quality_score: int | None = None

    @field_validator("published_at")
    @classmethod
    def utc_timestamp(cls, value: date | datetime | None) -> date | datetime | None:
        if value is None:
            return None
        if isinstance(value, datetime):
            if value.tzinfo is None:
                raise ValueError("published_at requires timezone information when time is known")
            return value.astimezone(timezone.utc)
        return value


class ArticlePatch(BaseModel):
    """model_fields_set is the change set: omitted != explicit null != zero."""

    model_config = ConfigDict(extra="forbid")
    category_id: str | None = None
    content_format_id: str | None = None
    genre_id: str | None = None
    audience_id: str | None = None
    topic: str | None = None
    tags: list[str] | None = None
    title: str | None = None
    summary: str | None = None
    body_text: str | None = None
    author_name: str | None = None
    published_at: date | AwareDatetime | None = None
    article_url: str | None = None
    review_status: str | None = None
    content_status: str | None = None
    quality_score: int | None = None

    @model_validator(mode="after")
    def forbid_clearing_required_title(self) -> "ArticlePatch":
        if "title" in self.model_fields_set and not self.title:
            raise ValueError("title cannot be cleared")
        return self

    def changes(self) -> dict[str, Any]:
        return self.model_dump(exclude_unset=True)


class SourceSnapshot(BaseModel):
    source_id: str
    article_id: str
    provider: str
    endpoint: str | None
    request_params: dict[str, Any]
    raw_item: dict[str, Any]
    raw_content: str | None
    content_format: str
    field_mapping: dict[str, FieldProvenance]
    fetched_at: AwareDatetime


class DiscoverySessionContract(BaseModel):
    platform_id: str
    provider: str
    endpoint: str
    request_params: dict[str, Any]
    idempotency_key: str | None = None


class DiscoveryCandidateContract(BaseModel):
    id: str
    session_id: str
    fetch_id: str
    provider: str
    endpoint: str
    external_id: str | None = None
    raw_item: dict[str, Any]
    normalized: dict[str, Any]
    field_provenance: dict[str, FieldProvenance]
    edit_draft: dict[str, Any] | None = None
    content_status: Literal["complete", "partial", "missing", "unknown"]
    row_version: int = Field(ge=1)
    warnings: list[str] = Field(default_factory=list)


class MetricSnapshot(BaseModel):
    article_id: str
    source_id: str | None = None
    observed_at: AwareDatetime
    read: ReadCount = Field(default_factory=ReadCount)
    likes: int | None = Field(default=None, ge=0)
    watch_count: int | None = Field(default=None, ge=0)
    comments: int | None = Field(default=None, ge=0)
    shares: int | None = Field(default=None, ge=0)
    saves: int | None = Field(default=None, ge=0)
    rewards: int | None = Field(default=None, ge=0)
    fans_count: int | None = Field(default=None, ge=0)
    field_provenance: dict[str, FieldProvenance] = Field(default_factory=dict)


class ArticleDetail(BaseModel):
    id: str
    editable: ArticleEditable
    row_version: int
    current_revision_id: str
    current_revision_no: int
    field_provenance: dict[str, FieldProvenance]
    sources: list[SourceSnapshot] = Field(default_factory=list)
    metrics: list[MetricSnapshot] = Field(default_factory=list)
    rights_status: str


class ArticleRevisionRead(BaseModel):
    id: str
    article_id: str
    revision_number: int = Field(ge=1)
    editable_snapshot: ArticleEditable
    field_provenance: dict[str, FieldProvenance]
    edited_fields: list[str]
    created_at: AwareDatetime


class PreparationFingerprint(BaseModel):
    article_id: str
    input_origin: Literal["revision", "source"]
    input_ref_id: str
    input_hash: str = Field(pattern=r"^[a-f0-9]{64}$")
    preparation_config_hash: str = Field(pattern=r"^[a-f0-9]{64}$")
    cleaner_version: str


class FeatureFingerprint(BaseModel):
    prepared_article_id: str
    feature_group: str
    analysis_input_hash: str = Field(pattern=r"^[a-f0-9]{64}$")
    analysis_config_hash: str = Field(pattern=r"^[a-f0-9]{64}$")
    analyzer_version: str


class RightsScope(BaseModel):
    store: bool | None = None
    local_clean: bool | None = None
    third_party_llm: bool | None = None
    generation_reference: bool | None = None
    service_provider: str | None = None
    legacy_confirmation: bool | None = None


class RightsDecision(BaseModel):
    article_id: str
    source_id: str | None = None
    status: Literal["allowed", "denied", "unknown", "withdrawn"]
    scope: RightsScope
    evidence: str | None = None
    policy_version: str
    effective_at: AwareDatetime


class RightsProjection(BaseModel):
    """Current decision-derived gate; the append-only RightsDecision remains authoritative history."""
    article_id: str
    decision_id: str | None = None
    store: bool | None = None
    local_clean: bool | None = None
    third_party_llm: bool | None = None
    generation_reference: bool | None = None
    evaluated_at: AwareDatetime

    def permits(self, action: Literal["store", "local_clean", "third_party_llm", "generation_reference"]) -> bool:
        return getattr(self, action) is True


class ProcessingInputVersion(BaseModel):
    target_id: str
    article_row_version: int | None = None
    article_revision_id: str | None = None
    rights_decision_id: str | None = None
    prepared_article_id: str | None = None
    input_hash: str = Field(pattern=r"^[a-f0-9]{64}$")
    config_hash: str = Field(pattern=r"^[a-f0-9]{64}$")


# 2026-10-24：本次修改原因：权限撤回扫描必须覆盖可恢复正文的全部副本，后续清理服务据此逐项实现。
SENSITIVE_DATA_LOCATIONS = (
    "discovery_fetches.raw_response_json", "discovery_candidates.raw_item_json",
    "discovery_candidates.normalized_json", "discovery_candidates.edit_draft_json",
    "article_source_payloads.raw_item_json", "article_source_payloads.raw_content",
    "articles.body_text", "article_revisions.body_text", "article_revisions.snapshot_json",
    "prepared_articles.clean_text", "prepared_articles.blocks_json",
    "article_features.features_json", "article_features.evidence_json",
    "style_profile_versions.profile_json", "style_profile_inputs",
    "performance_analyses.result_json", "processing_jobs.input_json",
    "processing_jobs.result_json", "processing_jobs.error_message",
    "generated_revisions.body_markdown", "evaluation_runs.evidence_json",
    "legacy_payload_archive.payload_json", "application_cache", "application_logs", "database_backups",
)


class DispositionScope(BaseModel):
    """The executor must report every matched location and any unprocessed backup/cache."""
    target_type: Literal["article", "source", "candidate", "job", "profile", "document"]
    target_id: str
    reason: Literal["user_delete", "rights_withdrawal", "retention_expiry", "provider_change"]
    locations: list[str]
    include_backups: bool = True

    @field_validator("locations")
    @classmethod
    def known_locations(cls, value: list[str]) -> list[str]:
        unknown = set(value) - set(SENSITIVE_DATA_LOCATIONS)
        if unknown:
            raise ValueError(f"Unknown sensitive-data locations: {sorted(unknown)}")
        return value
