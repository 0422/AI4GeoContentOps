# 2026-10-24：本次修改原因：冻结选样、分析特征和封存输入必须按状态推进；封存后画像才能引用可复现的输入。
"""Stage 2A collection snapshot state transition primitives."""

from datetime import datetime, timezone

from sqlalchemy import func, select, update
from sqlalchemy.orm import Session

from app.infrastructure.database.target_models import (
    ArticleCollectionSnapshots, ArticleCollectionSnapshotItems,
    ArticleCollectionSnapshotFeatures, ArticleFeatures,
)


def freeze_selection(session: Session, snapshot_id: str, expected_row_version: int) -> None:
    """After this transition, selected article/revision/preparation IDs cannot change."""
    snapshot = session.get(ArticleCollectionSnapshots, snapshot_id)
    if snapshot is None or snapshot.status != "selection_building":
        raise ValueError("Snapshot is not building")
    total, included = session.execute(select(
        func.count(ArticleCollectionSnapshotItems.id),
        func.coalesce(func.sum(ArticleCollectionSnapshotItems.included), 0),
    ).where(ArticleCollectionSnapshotItems.snapshot_id == snapshot_id)).one()
    if total != snapshot.included_count + snapshot.excluded_count or included != snapshot.included_count:
        raise ValueError("Snapshot sample counts do not match frozen item rows")
    changed = session.execute(update(ArticleCollectionSnapshots).where(
        ArticleCollectionSnapshots.id == snapshot_id,
        ArticleCollectionSnapshots.status == "selection_building",
        ArticleCollectionSnapshots.row_version == expected_row_version,
    ).values(status="selection_frozen", frozen_at=datetime.now(timezone.utc).isoformat(),
             row_version=expected_row_version + 1))
    if changed.rowcount != 1:
        raise ValueError("Snapshot version conflict or invalid state")


def begin_analysis(session: Session, snapshot_id: str, expected_row_version: int) -> None:
    changed = session.execute(update(ArticleCollectionSnapshots).where(
        ArticleCollectionSnapshots.id == snapshot_id,
        ArticleCollectionSnapshots.status == "selection_frozen",
        ArticleCollectionSnapshots.row_version == expected_row_version,
    ).values(status="analyzing", row_version=expected_row_version + 1))
    if changed.rowcount != 1:
        raise ValueError("Snapshot version conflict or invalid state")


def attach_feature(session: Session, snapshot_item_id: str, feature_id: str) -> None:
    item = session.get(ArticleCollectionSnapshotItems, snapshot_item_id)
    feature = session.get(ArticleFeatures, feature_id)
    if item is None or feature is None:
        raise KeyError("Snapshot item or feature is missing")
    snapshot = session.get(ArticleCollectionSnapshots, item.snapshot_id)
    if snapshot is None or snapshot.status != "analyzing":
        raise ValueError("Feature links are editable only while analyzing")
    if not item.included or feature.article_id != item.article_id or feature.prepared_article_id != item.prepared_article_id:
        raise ValueError("Feature does not belong to this frozen article/preparation")
    session.add(ArticleCollectionSnapshotFeatures(snapshot_item_id=snapshot_item_id, feature_id=feature_id))


def seal_inputs(session: Session, snapshot_id: str, expected_row_version: int) -> None:
    snapshot = session.get(ArticleCollectionSnapshots, snapshot_id)
    if snapshot is None or snapshot.status != "analyzing" or snapshot.row_version != expected_row_version:
        raise ValueError("Snapshot version conflict or invalid state")
    if snapshot.included_count <= 0:
        raise ValueError("Cannot seal an empty analysis input")
    missing = session.execute(
        select(func.count()).select_from(ArticleCollectionSnapshotItems)
        .where(ArticleCollectionSnapshotItems.snapshot_id == snapshot_id,
               ArticleCollectionSnapshotItems.included == 1,
               ~ArticleCollectionSnapshotItems.id.in_(
                   select(ArticleCollectionSnapshotFeatures.snapshot_item_id)))
    ).scalar_one()
    if missing:
        raise ValueError(f"{missing} included samples have no sealed feature version")
    changed = session.execute(update(ArticleCollectionSnapshots).where(
        ArticleCollectionSnapshots.id == snapshot_id,
        ArticleCollectionSnapshots.status == "analyzing",
        ArticleCollectionSnapshots.row_version == expected_row_version,
    ).values(status="inputs_sealed", sealed_at=datetime.now(timezone.utc).isoformat(),
             row_version=expected_row_version + 1))
    if changed.rowcount != 1:
        raise ValueError("Snapshot changed before sealing")
