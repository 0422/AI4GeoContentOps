# 2026-10-24：本次修改原因：首次创建、编辑快照与当前修订指针必须在调用方同一短事务中原子提交。
"""Stage 2A revision primitives; Stage 2B will call these inside collection transactions."""

import json
from datetime import date, datetime, timezone
from types import SimpleNamespace
from uuid import uuid4

from sqlalchemy import update
from sqlalchemy.orm import Session

from app.domains.articles.contracts import ArticleEditable, ArticlePatch, FieldProvenance, ProvenanceStatus
from app.infrastructure.database.target_models import Articles, ArticleRevisions


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _json(value: object) -> str:
    return json.dumps(value, ensure_ascii=False, sort_keys=True, default=str)


def _revision(article: Articles | SimpleNamespace, revision_id: str, number: int, changed: list[str], note: str | None) -> ArticleRevisions:
    snapshot = {name: getattr(article, name) for name in (
        "platform_id", "category_id", "content_format_id", "genre_id", "audience_id", "topic",
        "title", "summary", "body_text", "author_name", "published_at",
        "article_url", "review_status", "content_status", "quality_score",
    )}
    snapshot["tags"] = json.loads(article.tags_json)
    return ArticleRevisions(
        id=revision_id, article_id=article.id, revision_number=number,
        title=article.title, summary=article.summary, body_text=article.body_text,
        author_name=article.author_name, published_at=article.published_at,
        category_id=article.category_id, content_format_id=article.content_format_id,
        genre_id=article.genre_id, article_url=article.article_url,
        snapshot_json=_json(snapshot), field_provenance_json=article.field_provenance_json,
        edited_fields_json=_json(changed), editor_note=note, created_at=_now(),
    )


def create_article_with_revision(session: Session, data: ArticleEditable,
                                 provenance_override: dict[str, dict] | None = None) -> Articles:
    """Caller owns commit. An exception rolls back article, revision, and pointer together."""
    payload = data.model_dump()
    now = _now()
    article_id = str(uuid4())
    revision_id = str(uuid4())
    provenance = {field: FieldProvenance(origin="manual", status=ProvenanceStatus.explicit_null if value is None else ProvenanceStatus.mapped,
        revision_id=revision_id).model_dump(mode="json") for field, value in payload.items()}
    # 2026-10-24：本次修改原因：采集候选收录时保留 Provider 字段来源，手动录入仍沿用默认人工来源。
    if provenance_override is not None:
        provenance.update(provenance_override)
        for field, item in provenance.items():
            if isinstance(item, dict):
                item.setdefault("revision_id", revision_id)
    article = Articles(
        id=article_id, platform_id=payload["platform_id"], category_id=payload["category_id"],
        content_format_id=payload["content_format_id"], genre_id=payload["genre_id"],
        audience_id=payload["audience_id"], topic=payload["topic"], tags_json=_json(payload["tags"]),
        title=payload["title"], summary=payload["summary"], body_text=payload["body_text"],
        author_name=payload["author_name"], published_at=payload["published_at"].isoformat() if payload["published_at"] else None,
        article_url=payload["article_url"], canonical_url=None,
        review_status=payload["review_status"], content_status=payload["content_status"],
        rights_status="unknown", rights_scope_json="{}", rights_evidence=None,
        quality_score=payload["quality_score"], current_revision_no=1, current_revision_id=None,
        field_provenance_json=_json(provenance), row_version=1,
        collected_at=now, deleted_at=None, created_at=now, updated_at=now,
    )
    session.add(article)
    session.flush()
    session.add(_revision(article, revision_id, 1, list(payload), "initial"))
    session.flush()
    article.current_revision_id = revision_id
    session.flush()
    return article


def edit_article_with_revision(session: Session, article_id: str, patch: ArticlePatch, expected_row_version: int) -> Articles:
    """Optimistic compare-and-swap and revision pointer update occur in one transaction."""
    article = session.get(Articles, article_id)
    if article is None:
        raise KeyError(article_id)
    if article.row_version != expected_row_version:
        raise ValueError("Article row_version conflict")
    changes = patch.changes()
    if not changes:
        return article
    # 2026-10-24：本次修改原因：先在内存计算新快照，避免 ORM 自动 flush 在乐观锁比较前写入文章列。
    projected = SimpleNamespace(**{column.name: getattr(article, column.name) for column in Articles.__table__.columns})
    db_changes = {}
    for field, value in changes.items():
        column = "tags_json" if field == "tags" else field
        if field == "tags":
            value = _json(value)
        elif field == "published_at" and value is not None:
            if isinstance(value, datetime):
                if value.tzinfo is None:
                    raise ValueError("published_at requires timezone information when time is known")
                value = value.astimezone(timezone.utc)
            value = value.isoformat()
        setattr(projected, column, value)
        db_changes[column] = value
    revision_id = str(uuid4())
    provenance = json.loads(projected.field_provenance_json)
    for field, value in changes.items():
        provenance[field] = FieldProvenance(
            origin="manual", status=ProvenanceStatus.manual_override if value is not None else ProvenanceStatus.explicit_null,
            revision_id=revision_id,
        ).model_dump(mode="json")
    projected.field_provenance_json = _json(provenance)
    next_revision = article.current_revision_no + 1
    session.add(_revision(projected, revision_id, next_revision, list(changes), None))
    session.flush()
    result = session.execute(
        update(Articles).where(Articles.id == article_id, Articles.row_version == expected_row_version)
        .values(current_revision_id=revision_id, current_revision_no=next_revision,
                field_provenance_json=projected.field_provenance_json,
                row_version=expected_row_version + 1, updated_at=_now(),
                **db_changes)
    )
    if result.rowcount != 1:
        raise ValueError("Article row_version conflict")
    session.expire(article)
    return article
