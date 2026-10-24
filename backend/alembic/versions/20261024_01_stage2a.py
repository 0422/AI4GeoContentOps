# 2026-10-24：本次修改原因：以冻结 SQL 快照创建 Stage 2A 目标表，不导入会继续变化的 ORM 模型。
"""Stage 2A target schema, new database only."""

from pathlib import Path

from alembic import op

revision = "20261024_01"
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    ddl = Path(__file__).with_name("20261024_01_stage2a_schema.sql").read_text(encoding="utf-8")
    for statement in ddl.split(";"):
        if statement.strip():
            op.execute(statement.strip())
    # 2026-10-24：本次修改原因：SQLite 直接写入也不能改动已冻结选样或已封存的特征关联；跨库实现由后续方言迁移提供。
    if op.get_bind().dialect.name == "sqlite":
        for table, parent, mutable_state in (
            ("article_collection_snapshot_items", "NEW.snapshot_id", "selection_building"),
            ("article_collection_snapshot_features", "(SELECT snapshot_id FROM article_collection_snapshot_items WHERE id=NEW.snapshot_item_id)", "analyzing"),
        ):
            op.execute(f"""CREATE TRIGGER guard_{table}_insert BEFORE INSERT ON {table}
                WHEN (SELECT status FROM article_collection_snapshots WHERE id={parent}) != '{mutable_state}'
                BEGIN SELECT RAISE(ABORT, 'snapshot state forbids insert'); END""")
        for operation in ("UPDATE", "DELETE"):
            for table, old_parent, mutable_state in (
                ("article_collection_snapshot_items", "OLD.snapshot_id", "selection_building"),
                ("article_collection_snapshot_features", "(SELECT snapshot_id FROM article_collection_snapshot_items WHERE id=OLD.snapshot_item_id)", "analyzing"),
            ):
                op.execute(f"""CREATE TRIGGER guard_{table}_{operation.lower()} BEFORE {operation} ON {table}
                    WHEN (SELECT status FROM article_collection_snapshots WHERE id={old_parent}) != '{mutable_state}'
                    BEGIN SELECT RAISE(ABORT, 'snapshot state forbids {operation.lower()}'); END""")
        op.execute("""CREATE TRIGGER guard_snapshot_status BEFORE UPDATE OF status ON article_collection_snapshots
            WHEN NOT ((OLD.status='selection_building' AND NEW.status='selection_frozen') OR
                      (OLD.status='selection_frozen' AND NEW.status='analyzing') OR
                      (OLD.status='analyzing' AND NEW.status='inputs_sealed'))
            BEGIN SELECT RAISE(ABORT, 'invalid snapshot state transition'); END""")
        op.execute("""CREATE TRIGGER guard_snapshot_frozen_definition BEFORE UPDATE ON article_collection_snapshots
            WHEN OLD.status!='selection_building' AND (
              NEW.collection_id IS NOT OLD.collection_id OR NEW.version_number IS NOT OLD.version_number OR
              NEW.collection_version IS NOT OLD.collection_version OR NEW.filter_json IS NOT OLD.filter_json OR
              NEW.sampling_config_json IS NOT OLD.sampling_config_json OR NEW.random_seed IS NOT OLD.random_seed OR
              NEW.candidate_count IS NOT OLD.candidate_count OR NEW.included_count IS NOT OLD.included_count OR
              NEW.excluded_count IS NOT OLD.excluded_count)
            BEGIN SELECT RAISE(ABORT, 'frozen selection definition is immutable'); END""")
        op.execute("""CREATE TRIGGER guard_snapshot_sealed_update BEFORE UPDATE ON article_collection_snapshots
            WHEN OLD.status='inputs_sealed'
            BEGIN SELECT RAISE(ABORT, 'sealed snapshot is immutable'); END""")


def downgrade() -> None:
    raise RuntimeError("Restore the pre-migration database copy; destructive downgrade is intentionally disabled")
