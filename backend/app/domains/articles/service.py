# 2026-10-24：本次修改原因：Stage 2B 将候选留存、权限决策和正式收录置于目标文章库领域服务。
"""Transactional Stage 2B article discovery and collection operations."""

from __future__ import annotations

import hashlib
import json
from datetime import datetime, timedelta, timezone
from typing import Any
from uuid import uuid4

from sqlalchemy import or_, select
from sqlalchemy.orm import Session
from pydantic import ValidationError

from app.domains.articles.adapters.redfox_wechat import PARSER_VERSION, ParsedCandidate, _published, fetch_wechat
from app.domains.articles.contracts import ArticleEditable, ArticlePatch, FieldProvenance, ProvenanceStatus, RightsScope
from app.domains.articles.revisions import create_article_with_revision, edit_article_with_revision
from app.infrastructure.database.target_models import (
    ArticleMetrics, ArticleSourcePayloads, ArticleSources, Articles, DiscoveryCandidates,
    DiscoveryFetches, DiscoverySessions, RightsDecisions,
)


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _json(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False, sort_keys=True, default=str)


def _hash(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def discover_wechat(session: Session, *, method: str, keyword: str | None = None,
                    category: str | None = None, start_date: str | None = None,
                    end_date: str | None = None, offset: int = 0,
                    sort_type: str | None = None, exact_match: bool | None = None) -> dict[str, Any]:
    """Provider request occurs before any write transaction is opened by the API."""
    endpoint, raw_result, parsed, has_more = fetch_wechat(
        method, keyword=keyword, category=category, start_date=start_date,
        end_date=end_date, offset=offset, sort_type=sort_type, exact_match=exact_match)
    now = datetime.now(timezone.utc)
    session_id, fetch_id = str(uuid4()), str(uuid4())
    params = raw_result["request"]
    session.add(DiscoverySessions(
        id=session_id, platform_id="platform_01", provider="redfox", endpoint=method,
        request_params_json=_json(params), status="completed", result_count=len(parsed),
        pinned=0, created_at=now.isoformat(), expires_at=(now + timedelta(days=7)).isoformat(),
        last_viewed_at=now.isoformat(),
    ))
    session.flush()
    session.add(DiscoveryFetches(
        id=fetch_id, session_id=session_id, request_params_json=_json(params),
        raw_response_json=_json(raw_result["response"]), upstream_cursor=str(offset) if offset else None,
        result_count=len(parsed), has_more=(int(has_more) if has_more is not None else None),
        fetched_at=now.isoformat(),
    ))
    # 2026-10-24：本次修改原因：先确保抓取记录落入当前事务，再插入引用它的候选，规避 SQLite 外键写入顺序问题。
    session.flush()
    result: list[dict[str, Any]] = []
    for item in parsed:
        normalized = item.normalized
        identity = item.external_id or normalized.get("article_url") or _hash(_json(item.raw_item))
        key = _hash(f"wechat:{method}:{identity}")
        existing = session.scalar(select(DiscoveryCandidates).where(
            DiscoveryCandidates.session_id == session_id,
            DiscoveryCandidates.candidate_key == key))
        candidate = existing or DiscoveryCandidates(
            id=str(uuid4()), session_id=session_id, fetch_id=fetch_id,
            candidate_kind="article", provider="redfox", endpoint=method,
            external_id=item.external_id, candidate_key=key, raw_item_json=_json(item.raw_item),
            normalized_json=_json(normalized), field_provenance_json=_json(item.provenance),
            edit_draft_json=None, row_version=1, parser_version=PARSER_VERSION,
            warnings_json=_json(list(item.warnings)), content_status=item.content_status,
            pinned=0, collected_article_id=None, discovered_at=now.isoformat(), updated_at=now.isoformat(),
        )
        if existing is None:
            session.add(candidate)
            session.flush()
            matched_article_id = None
            if item.external_id:
                matched_article_id = session.scalar(select(ArticleSources.article_id).join(
                    Articles, Articles.id == ArticleSources.article_id).where(
                    Articles.deleted_at.is_(None), ArticleSources.provider == "redfox",
                    ArticleSources.endpoint == method, ArticleSources.external_id == item.external_id).limit(1))
            article_url = normalized.get("article_url")
            if matched_article_id is None and article_url:
                matched_article_id = session.scalar(select(Articles.id).where(
                    Articles.deleted_at.is_(None), Articles.platform_id == "platform_01",
                    or_(Articles.article_url == article_url, Articles.canonical_url == article_url)).limit(1))
            candidate.collected_article_id = matched_article_id
        result.append({"id": candidate.id, "normalized": normalized,
                       "field_provenance": item.provenance, "warnings": list(item.warnings),
                       "content_status": item.content_status, "collected_article_id": candidate.collected_article_id,
                       "row_version": candidate.row_version})
    return {"session_id": session_id, "fetch_id": fetch_id, "method": method,
            "endpoint": endpoint, "count": len(result), "has_more": has_more,
            "candidates": result}


def _check_storage_permission(scope: RightsScope) -> None:
    if scope.store is not True:
        raise ValueError("正式收录必须明确确认允许保存该文章；未知或未确认均不允许收录")


def _check_collectable_article(article: ArticleEditable) -> None:
    # 2026-10-24：本次修改原因：API 收录与手动录入都必须满足标题、内部类目和正文的正式入库要求。
    if not article.title.strip():
        raise ValueError("收录前必须补齐标题")
    if not article.category_id:
        raise ValueError("收录前必须选择文章内容类目")
    if not article.body_text or len(article.body_text.strip()) < 50:
        raise ValueError("收录前必须补齐至少 50 字正文")


def _find_existing(session: Session, candidate: DiscoveryCandidates, editable: ArticleEditable) -> Articles | None:
    if editable.article_url:
        found = session.scalar(select(Articles).where(
            Articles.deleted_at.is_(None),
            or_(Articles.canonical_url == editable.article_url, Articles.article_url == editable.article_url)))
        if found:
            return found
    if candidate.external_id:
        return session.scalar(select(Articles).join(ArticleSources, ArticleSources.article_id == Articles.id).where(
            Articles.deleted_at.is_(None), ArticleSources.provider == candidate.provider,
            ArticleSources.endpoint == candidate.endpoint, ArticleSources.external_id == candidate.external_id))
    return None


def _metric_from_normalized(article_id: str, source_id: str, endpoint: str,
                            normalized: dict[str, Any], provenance: dict[str, Any]) -> ArticleMetrics | None:
    values = normalized.get("metrics")
    if not isinstance(values, dict) or not any(value is not None for value in values.values()):
        return None
    return ArticleMetrics(
        id=str(uuid4()), article_id=article_id, source_id=source_id, source_label=endpoint,
        observed_at=_now(), read_raw=values.get("read_raw"), read_exact=values.get("read_exact"),
        read_lower_bound=values.get("read_lower_bound"), likes=values.get("likes"),
        watch_count=values.get("watch_count"), comments=values.get("comments"),
        shares=values.get("shares"), saves=values.get("saves"), rewards=values.get("rewards"),
        fans_count=values.get("fans_count"), interactive_count=values.get("interactive_count"),
        impressions=None, clicks=None, extra_metrics_json="{}", parse_warnings_json="[]",
        field_provenance_json=_json({key: value for key, value in provenance.items() if key.startswith("metric.")}),
    )


def collect_candidate(session: Session, candidate_id: str, expected_row_version: int,
                      scope: RightsScope, overrides: dict[str, Any] | None = None,
                      evidence: str | None = None) -> Articles:
    _check_storage_permission(scope)
    candidate = session.get(DiscoveryCandidates, candidate_id)
    if candidate is None:
        raise KeyError(candidate_id)
    if candidate.row_version != expected_row_version:
        raise ValueError("候选已被其他操作修改，请刷新后重试")
    if candidate.collected_article_id:
        article = session.get(Articles, candidate.collected_article_id)
        if article and article.deleted_at is None:
            return article
    normalized = json.loads(candidate.normalized_json)
    draft = json.loads(candidate.edit_draft_json) if candidate.edit_draft_json else {}
    normalized.update(draft)
    if overrides:
        normalized.update(overrides)
    raw_item = json.loads(candidate.raw_item_json)
    published_raw_key = next((key for key in ("publishTime", "publicTime")
                              if raw_item.get(key) not in (None, "")), None)
    published_raw_value = raw_item.get(published_raw_key) if published_raw_key else None
    published_from_raw = False
    # 2026-10-24：本次修改原因：旧候选标准发布时间为空时，用保留的 RedFox 原始发布时间补齐收录值。
    if not normalized.get("published_at") and published_raw_value is not None:
        parsed_publish_date, _publish_warning = _published(published_raw_value)
        if parsed_publish_date:
            normalized["published_at"] = parsed_publish_date
            published_from_raw = True
    source_category = normalized.get("source_category")
    source_url = normalized.get("source_url")
    raw_metrics = normalized.pop("metrics", {})
    normalized.pop("source_category", None)
    # 2026-10-24：本次修改原因：请求榜单类目和原始发布时间仅作为来源元数据，不混入文章主表编辑字段。
    normalized.pop("requested_source_category", None)
    normalized.pop("published_at_raw", None)
    normalized.pop("raw_content_format", None)
    normalized.pop("raw_complete", None)
    normalized.pop("source_url", None)
    allowed = ArticleEditable.model_fields.keys()
    editable_data = {key: value for key, value in normalized.items() if key in allowed}
    try:
        editable = ArticleEditable.model_validate(editable_data)
    except ValidationError as error:
        raise ValueError("候选文章缺少必填字段或字段格式不正确，请先编辑补齐") from error
    _check_collectable_article(editable)
    existing = _find_existing(session, candidate, editable)
    article_id = existing.id if existing else None
    source_id = str(uuid4())
    provenance = json.loads(candidate.field_provenance_json)
    if published_from_raw and published_raw_key:
        provenance["published_at"] = FieldProvenance(
            origin="provider",
            status=ProvenanceStatus.approximate if _publish_warning else ProvenanceStatus.mapped,
            source_id=source_id,
            source_path=f"$.{published_raw_key}",
            raw_value=published_raw_value,
            transform="retain_calendar_date_timezone_unknown" if _publish_warning else "parse_provider_publish_date",
        ).model_dump(mode="json")
    article_provenance = {key: value for key, value in provenance.items() if key in ArticleEditable.model_fields}
    user_fields = set(draft) | set(overrides or {})
    for field in ArticleEditable.model_fields:
        if field not in article_provenance:
            article_provenance[field] = FieldProvenance(
                origin="manual" if field in user_fields else "transform",
                status=ProvenanceStatus.manual_override if field in user_fields else ProvenanceStatus.missing,
                transform="candidate_user_edit" if field in user_fields else "no_provider_value",
                raw_value=normalized.get(field),
            ).model_dump(mode="json")
        elif field in user_fields:
            article_provenance[field] = FieldProvenance(
                origin="manual", status=ProvenanceStatus.manual_override,
                source_id=source_id,
                raw_value=normalized.get(field), transform="candidate_user_edit",
            ).model_dump(mode="json")
    for item in provenance.values():
        if isinstance(item, dict):
            item["source_id"] = source_id
    for item in article_provenance.values():
        if isinstance(item, dict):
            item["source_id"] = source_id
    if existing is None:
        # Preserve provider provenance for populated values; missing fields remain explicit in the map.
        article = create_article_with_revision(session, editable, article_provenance)
        article_id = article.id
    else:
        article = existing
    fetch = session.get(DiscoveryFetches, candidate.fetch_id)
    request_params = json.loads(fetch.request_params_json) if fetch else {}
    raw_content = raw_item.get("content") if isinstance(raw_item.get("content"), str) else None
    session.add(ArticleSources(
        id=source_id, article_id=article_id, discovery_candidate_id=candidate.id,
        acquisition_method="api", provider=candidate.provider, endpoint=candidate.endpoint,
        external_id=candidate.external_id, source_url=source_url,
        source_category=source_category, request_params_json=_json(request_params),
        response_meta_json=_json({"candidate_id": candidate.id}),
        field_mapping_json=_json(provenance),
        raw_item_hash=_hash(candidate.raw_item_json),
        raw_content_hash=_hash(raw_content) if raw_content is not None else None,
        content_format="html_or_text_unverified", raw_complete=0,
        parser_version=candidate.parser_version, warnings_json=candidate.warnings_json,
        fetched_at=candidate.discovered_at,
    ))
    session.flush()
    session.add(ArticleSourcePayloads(
        source_id=source_id, raw_item_json=candidate.raw_item_json,
        raw_content=raw_content,
        stored_at=_now(), retain_until=None,
    ))
    decision = RightsDecisions(
        id=str(uuid4()), article_id=article_id, source_id=source_id, status="allowed",
        scope_json=_json(scope.model_dump(mode="json")),
        evidence=evidence or "User confirmed storage permission at collection",
        policy_version="rights-v1", supersedes_id=None, effective_at=_now(), recorded_at=_now(), expires_at=None,
    )
    session.add(decision)
    article = session.get(Articles, article_id)
    article.rights_status = "allowed"
    article.rights_scope_json = _json(scope.model_dump(mode="json"))
    article.rights_evidence = evidence or "User confirmed storage permission at collection"
    metric_source = {**normalized, "metrics": raw_metrics}
    metric = _metric_from_normalized(article_id, source_id, candidate.endpoint, metric_source, provenance)
    if metric:
        session.add(metric)
    candidate.collected_article_id = article_id
    candidate.row_version += 1
    candidate.updated_at = _now()
    return article


def create_manual_article(session: Session, editable: ArticleEditable, scope: RightsScope,
                          evidence: str | None = None) -> Articles:
    _check_storage_permission(scope)
    _check_collectable_article(editable)
    article = create_article_with_revision(session, editable)
    source_id = str(uuid4())
    now = _now()
    session.add(ArticleSources(
        id=source_id, article_id=article.id, discovery_candidate_id=None,
        acquisition_method="manual", provider="manual", endpoint=None, external_id=None,
        source_url=editable.article_url, source_category=editable.category_id,
        request_params_json="{}", response_meta_json="{}", field_mapping_json=article.field_provenance_json,
        raw_item_hash=None, raw_content_hash=_hash(editable.body_text) if editable.body_text else None,
        content_format="text", raw_complete=int(bool(editable.body_text)), parser_version="manual-v1",
        warnings_json="[]", fetched_at=now,
    ))
    session.add(ArticleSourcePayloads(source_id=source_id, raw_item_json="{}", raw_content=editable.body_text,
                                      stored_at=now, retain_until=None))
    session.add(RightsDecisions(
        id=str(uuid4()), article_id=article.id, source_id=source_id, status="allowed",
        scope_json=_json(scope.model_dump(mode="json")), evidence=evidence,
        policy_version="rights-v1", supersedes_id=None, effective_at=now, recorded_at=now, expires_at=None,
    ))
    article.rights_status = "allowed"
    article.rights_scope_json = _json(scope.model_dump(mode="json"))
    article.rights_evidence = evidence
    return article


def patch_article(session: Session, article_id: str, patch: ArticlePatch, expected_row_version: int) -> Articles:
    article = edit_article_with_revision(session, article_id, patch, expected_row_version)
    if "body_text" in patch.model_fields_set:
        # Derived results are invalidated by dependency hash/version at use time; keep history immutable.
        article.content_status = "unknown"
    return article
