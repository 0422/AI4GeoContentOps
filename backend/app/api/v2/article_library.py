# 2026-10-24：本次修改原因：提供基于 Stage 2A 目标数据模型的发现、收录、手动录入与文章编辑 API。
"""Stage 2B target-contract API. No legacy database models are used here."""

from __future__ import annotations

import json
from datetime import date, datetime, timezone
from typing import Any, Literal

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, ConfigDict, Field, model_validator
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.domains.articles.adapters.redfox_wechat import REDFOX_WECHAT_CATEGORIES
from app.domains.articles.contracts import ArticleEditable, ArticlePatch, RightsScope
from app.domains.articles.service import collect_candidate, create_manual_article, discover_wechat, patch_article
from app.infrastructure.database.target_models import ArticleMetrics, ArticleSourcePayloads, ArticleSources, Articles, DiscoveryCandidates, DiscoveryFetches, DiscoverySessions
from app.infrastructure.database.target_sessions import target_session
from app.redfox_service import RedFoxError

router = APIRouter(prefix="/article-library", tags=["article-library-v2"])


@router.get("/discover/wechat/categories")
def wechat_categories():
    return {"items": list(REDFOX_WECHAT_CATEGORIES)}


class WechatDiscoveryRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    method: Literal["keyword_search", "ten_w_rank", "original_rank"]
    keyword: str | None = Field(default=None, min_length=2, max_length=80)
    category: str | None = Field(default=None, max_length=100)
    start_date: date | None = None
    end_date: date | None = None
    offset: int = Field(default=0, ge=0, le=100000)
    sort_type: Literal["_0", "_2", "_4"] | None = None
    exact_match: bool | None = None

    @model_validator(mode="after")
    def validate_method_params(self):
        if self.method == "keyword_search" and not (self.keyword or "").strip():
            raise ValueError("keyword_search requires a keyword")
        if self.method != "keyword_search" and (self.sort_type is not None or self.exact_match is not None):
            raise ValueError("sort_type and exact_match are only supported by keyword_search")
        if self.method != "keyword_search":
            if not self.category or not self.start_date or not self.end_date:
                raise ValueError("rank methods require category, start_date and end_date")
            if self.category not in REDFOX_WECHAT_CATEGORIES:
                raise ValueError("category is not in the documented RedFox WeChat category list")
            if self.start_date >= self.end_date:
                raise ValueError("end_date must be later than start_date")
        return self


class RightsSubmission(BaseModel):
    model_config = ConfigDict(extra="forbid")
    scope: RightsScope
    evidence: str | None = Field(default=None, max_length=2000)


class CandidateCollectRequest(RightsSubmission):
    candidate_id: str
    expected_row_version: int = Field(ge=1)
    overrides: ArticlePatch | None = None


class BatchCollectRequest(RightsSubmission):
    candidates: list[tuple[str, int]] = Field(min_length=1, max_length=100)
    # 2026-10-24：本次修改原因：批量收录允许对每条候选携带已核对的内部类目等差异字段。
    overrides_by_candidate: dict[str, ArticlePatch] = Field(default_factory=dict)


class ManualArticleRequest(RightsSubmission):
    article: ArticleEditable


class ArticleUpdateRequest(BaseModel):
    expected_row_version: int = Field(ge=1)
    patch: ArticlePatch


def _article_read(article: Articles) -> dict[str, Any]:
    return {"id": article.id, "platform_id": article.platform_id, "category_id": article.category_id,
            "content_format_id": article.content_format_id, "genre_id": article.genre_id,
            "audience_id": article.audience_id, "topic": article.topic,
            "tags": json.loads(article.tags_json), "title": article.title, "summary": article.summary,
            "body_text": article.body_text, "author_name": article.author_name,
            "published_at": article.published_at, "article_url": article.article_url,
            "review_status": article.review_status, "content_status": article.content_status,
            "rights_status": article.rights_status, "rights_scope": json.loads(article.rights_scope_json),
            "rights_evidence": article.rights_evidence, "quality_score": article.quality_score,
            "current_revision_id": article.current_revision_id, "current_revision_no": article.current_revision_no,
            "field_provenance": json.loads(article.field_provenance_json), "row_version": article.row_version,
            "created_at": article.created_at, "updated_at": article.updated_at}


@router.post("/discover/wechat", status_code=201)
def discover_wechat_candidates(request: WechatDiscoveryRequest, session: Session = Depends(target_session)):
    try:
        result = discover_wechat(session, method=request.method, keyword=request.keyword,
            category=request.category, start_date=request.start_date.isoformat() if request.start_date else None,
            end_date=request.end_date.isoformat() if request.end_date else None, offset=request.offset,
            sort_type=request.sort_type, exact_match=request.exact_match)
        session.commit()
        return result
    except RedFoxError as error:
        session.rollback()
        raise HTTPException(status_code=502, detail=str(error)) from error
    except Exception:
        session.rollback()
        raise


@router.get("/discovery-sessions/{session_id}")
def get_discovery_session(session_id: str, offset: int = Query(0, ge=0),
                          limit: int = Query(50, ge=1, le=200),
                          session: Session = Depends(target_session)):
    row = session.get(DiscoverySessions, session_id)
    if row is None:
        raise HTTPException(status_code=404, detail="Discovery session not found")
    candidate_query = select(DiscoveryCandidates).where(DiscoveryCandidates.session_id == session_id)
    candidates = session.scalars(candidate_query.order_by(
        DiscoveryCandidates.discovered_at, DiscoveryCandidates.id).offset(offset).limit(limit)).all()
    candidate_count = session.scalar(select(func.count()).select_from(DiscoveryCandidates).where(
        DiscoveryCandidates.session_id == session_id)) or 0
    return {"id": row.id, "platform_id": row.platform_id, "provider": row.provider,
            "endpoint": row.endpoint, "request_params": json.loads(row.request_params_json),
            "status": row.status, "result_count": row.result_count, "created_at": row.created_at,
            "expires_at": row.expires_at, "candidate_offset": offset,
            "candidate_limit": limit, "candidate_total": candidate_count, "candidates": [
                {"id": item.id, "normalized": json.loads(item.normalized_json),
                 "field_provenance": json.loads(item.field_provenance_json),
                 "edit_draft": json.loads(item.edit_draft_json) if item.edit_draft_json else None,
                 "warnings": json.loads(item.warnings_json), "content_status": item.content_status,
                 "collected_article_id": item.collected_article_id, "row_version": item.row_version}
                for item in candidates]}


@router.get("/discovery-candidates/{candidate_id}")
def get_discovery_candidate(candidate_id: str, session: Session = Depends(target_session)):
    candidate = session.get(DiscoveryCandidates, candidate_id)
    if candidate is None:
        raise HTTPException(status_code=404, detail="Discovery candidate not found")
    return {"id": candidate.id, "session_id": candidate.session_id, "fetch_id": candidate.fetch_id,
            "provider": candidate.provider, "endpoint": candidate.endpoint,
            "external_id": candidate.external_id, "normalized": json.loads(candidate.normalized_json),
            "field_provenance": json.loads(candidate.field_provenance_json),
            "edit_draft": json.loads(candidate.edit_draft_json) if candidate.edit_draft_json else None,
            "raw_item": json.loads(candidate.raw_item_json), "warnings": json.loads(candidate.warnings_json),
            "content_status": candidate.content_status,
            "collected_article_id": candidate.collected_article_id, "row_version": candidate.row_version}


@router.patch("/discovery-candidates/{candidate_id}")
def patch_discovery_candidate(candidate_id: str, request: ArticleUpdateRequest,
                              session: Session = Depends(target_session)):
    candidate = session.get(DiscoveryCandidates, candidate_id)
    if candidate is None:
        raise HTTPException(status_code=404, detail="Discovery candidate not found")
    if candidate.row_version != request.expected_row_version:
        raise HTTPException(status_code=409, detail="Candidate changed; refresh before editing")
    current = json.loads(candidate.edit_draft_json) if candidate.edit_draft_json else {}
    current.update(request.patch.changes())
    candidate.edit_draft_json = json.dumps(current, ensure_ascii=False, sort_keys=True, default=str)
    candidate.row_version += 1
    candidate.updated_at = datetime.now(timezone.utc).isoformat()
    session.commit()
    return {"id": candidate.id, "edit_draft": current, "row_version": candidate.row_version}


@router.post("/discovery-candidates/collect", status_code=201)
def collect_one(request: CandidateCollectRequest, session: Session = Depends(target_session)):
    try:
        article = collect_candidate(session, request.candidate_id, request.expected_row_version,
                                   request.scope, request.overrides.changes() if request.overrides else None,
                                   request.evidence)
        session.commit()
        return _article_read(article)
    except KeyError as error:
        session.rollback()
        raise HTTPException(status_code=404, detail="Discovery candidate not found") from error
    except ValueError as error:
        session.rollback()
        raise HTTPException(status_code=409 if "修改" in str(error) else 422, detail=str(error)) from error


@router.post("/discovery-candidates/collect-batch", status_code=201)
def collect_batch(request: BatchCollectRequest, session: Session = Depends(target_session)):
    if request.scope.store is not True:
        raise HTTPException(status_code=422, detail="Batch collection requires explicit storage permission")
    try:
        articles = [collect_candidate(session, candidate_id, version, request.scope,
                                      overrides=(request.overrides_by_candidate.get(candidate_id).changes()
                                                 if candidate_id in request.overrides_by_candidate else None),
                                      evidence=request.evidence)
                    for candidate_id, version in request.candidates]
        session.commit()
        return {"count": len(articles), "articles": [_article_read(article) for article in articles]}
    except (KeyError, ValueError) as error:
        session.rollback()
        raise HTTPException(status_code=409 if isinstance(error, ValueError) else 404, detail=str(error)) from error


@router.post("/articles", status_code=201)
def create_manual(request: ManualArticleRequest, session: Session = Depends(target_session)):
    try:
        article = create_manual_article(session, request.article, request.scope, request.evidence)
        session.commit()
        return _article_read(article)
    except ValueError as error:
        session.rollback()
        raise HTTPException(status_code=422, detail=str(error)) from error


@router.get("/articles")
def list_articles(platform_id: str | None = None, category_id: str | None = None,
                  content_format_id: str | None = None, offset: int = Query(0, ge=0),
                  limit: int = Query(50, ge=1, le=200), session: Session = Depends(target_session)):
    query = select(Articles).where(Articles.deleted_at.is_(None))
    count_query = select(func.count()).select_from(Articles).where(Articles.deleted_at.is_(None))
    if platform_id:
        query, count_query = query.where(Articles.platform_id == platform_id), count_query.where(Articles.platform_id == platform_id)
    # 2026-10-24：本次修改原因：样本管理的筛选条件由目标库执行，保证分页总数与当前筛选一致。
    if category_id:
        query, count_query = query.where(Articles.category_id == category_id), count_query.where(Articles.category_id == category_id)
    if content_format_id:
        query, count_query = query.where(Articles.content_format_id == content_format_id), count_query.where(Articles.content_format_id == content_format_id)
    rows = session.scalars(query.order_by(Articles.updated_at.desc()).offset(offset).limit(limit)).all()
    return {"items": [_article_read(row) for row in rows], "offset": offset, "limit": limit,
            "total": session.scalar(count_query) or 0}


@router.get("/articles/{article_id}")
def get_article(article_id: str, session: Session = Depends(target_session)):
    article = session.get(Articles, article_id)
    if article is None or article.deleted_at is not None:
        raise HTTPException(status_code=404, detail="Article not found")
    sources = session.scalars(select(ArticleSources).where(ArticleSources.article_id == article_id)).all()
    metrics = session.scalars(select(ArticleMetrics).where(ArticleMetrics.article_id == article_id).order_by(ArticleMetrics.observed_at.desc())).all()
    source_data = []
    for source in sources:
        payload = session.get(ArticleSourcePayloads, source.id)
        source_data.append({"id": source.id, "provider": source.provider, "endpoint": source.endpoint,
            "external_id": source.external_id, "acquisition_method": source.acquisition_method,
            "source_url": source.source_url, "source_category": source.source_category,
            "request_params": json.loads(source.request_params_json),
            "field_provenance": json.loads(source.field_mapping_json),
            "raw_item": json.loads(payload.raw_item_json) if payload else None,
            "raw_content": payload.raw_content if payload else None, "fetched_at": source.fetched_at})
    return {**_article_read(article), "sources": source_data, "metrics": [
        {"id": m.id, "source_id": m.source_id, "source_label": m.source_label,
         "observed_at": m.observed_at, "read_raw": m.read_raw, "read_exact": m.read_exact,
         "read_lower_bound": m.read_lower_bound, "likes": m.likes, "watch_count": m.watch_count,
         "comments": m.comments, "shares": m.shares, "saves": m.saves, "rewards": m.rewards,
         "fans_count": m.fans_count, "interactive_count": m.interactive_count,
         "extra_metrics": json.loads(m.extra_metrics_json),
         "field_provenance": json.loads(m.field_provenance_json)} for m in metrics]}


@router.patch("/articles/{article_id}")
def update_article(article_id: str, request: ArticleUpdateRequest,
                   session: Session = Depends(target_session)):
    try:
        article = patch_article(session, article_id, request.patch, request.expected_row_version)
        session.commit()
        return _article_read(article)
    except KeyError as error:
        session.rollback()
        raise HTTPException(status_code=404, detail="Article not found") from error
    except ValueError as error:
        session.rollback()
        raise HTTPException(status_code=409, detail=str(error)) from error
