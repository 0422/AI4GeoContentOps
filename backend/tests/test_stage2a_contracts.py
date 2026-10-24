# 2026-10-24：本次修改原因：用隔离内存库和纯数据契约覆盖 Stage 2A 的字段语义、版本指针及迁移边界。
import json
from pathlib import Path
import tempfile
import unittest

from alembic import command
from alembic.config import Config
from sqlalchemy import create_engine, inspect, text
from sqlalchemy.exc import IntegrityError

from app.domains.articles.contracts import ArticleEditable, ArticlePatch, ReadCount, SENSITIVE_DATA_LOCATIONS
from app.domains.articles.revisions import create_article_with_revision, edit_article_with_revision
from app.infrastructure.database.session import make_target_engine, reject_legacy_database, session_factory, short_transaction
from app.infrastructure.database.target_models import TargetBase, Articles, ArticleRevisions, ArticleSources, ArticleSourcePayloads, ArticleMetrics
from scripts.rehearse_stage2a_migration import count_value, legacy_utc


def isolated_schema_engine():
    engine = make_target_engine("sqlite:///:memory:")
    ddl_path = Path(__file__).resolve().parents[1] / "alembic/versions/20261024_01_stage2a_schema.sql"
    with engine.connect() as connection:
        connection.connection.driver_connection.executescript(ddl_path.read_text(encoding="utf-8"))
    return engine


class ContractTests(unittest.TestCase):
    def test_patch_distinguishes_omitted_null_and_zero(self):
        patch = ArticlePatch.model_validate({"summary": None, "quality_score": 0})
        self.assertEqual(patch.changes(), {"summary": None, "quality_score": 0})
        self.assertNotIn("body_text", patch.changes())

    def test_read_lower_bound_is_not_exact(self):
        raw, exact, bound = count_value("10w+")
        self.assertEqual((raw, exact, bound), ("10w+", None, 100000))
        self.assertIsNone(ReadCount(raw=raw, lower_bound=bound).exact)

    def test_legacy_system_timestamp_records_utc_assumption(self):
        self.assertEqual(legacy_utc("2026-10-24 12:00:00"), "2026-10-24T12:00:00+00:00")

    def test_cleanup_inventory_includes_historical_and_job_data(self):
        self.assertIn("article_revisions.body_text", SENSITIVE_DATA_LOCATIONS)
        self.assertIn("article_features.evidence_json", SENSITIVE_DATA_LOCATIONS)
        self.assertIn("processing_jobs.result_json", SENSITIVE_DATA_LOCATIONS)

    def test_explicit_legacy_database_guard(self):
        from app.infrastructure.database.session import LEGACY_DATABASE
        with self.assertRaises(ValueError):
            reject_legacy_database(f"sqlite:///{LEGACY_DATABASE.as_posix()}")


class SchemaAndRevisionTests(unittest.TestCase):
    def test_frozen_alembic_schema_matches_orm_tables(self):
        with tempfile.TemporaryDirectory() as temp:
            db = Path(temp) / "target.db"
            config = Config(str(Path(__file__).resolve().parents[1] / "alembic.ini"))
            config.cmd_opts = type("Options", (), {"x": [f"db_url=sqlite:///{db.as_posix()}"]})()
            command.upgrade(config, "head")
            engine = create_engine(f"sqlite:///{db.as_posix()}")
            actual = set(inspect(engine).get_table_names()) - {"alembic_version"}
            self.assertEqual(actual, set(TargetBase.metadata.tables))
            for table in actual:
                self.assertEqual(
                    {column["name"] for column in inspect(engine).get_columns(table)},
                    set(TargetBase.metadata.tables[table].columns.keys()),
                    table,
                )
            with engine.connect() as connection:
                guards = {row[0] for row in connection.execute(text(
                    "SELECT name FROM sqlite_master WHERE type='trigger' AND name LIKE 'guard_%'"))}
                self.assertIn("guard_snapshot_status", guards)
                self.assertIn("guard_article_collection_snapshot_items_insert", guards)
                self.assertIn("guard_article_collection_snapshot_features_update", guards)
            engine.dispose()

    def test_article_revision_pointer_is_atomic_and_owned(self):
        engine = isolated_schema_engine()
        factory = session_factory(engine)
        with short_transaction(factory) as session:
            article = create_article_with_revision(session, ArticleEditable(platform_id="wechat", title="Original", body_text="Body"))
            article_id = article.id
        with short_transaction(factory) as session:
            updated = edit_article_with_revision(session, article_id, ArticlePatch(summary=None, quality_score=0, title="Edited"), 1)
            self.assertEqual(updated.current_revision_no, 2)
        with factory() as session:
            article = session.get(Articles, article_id)
            revisions = session.query(ArticleRevisions).filter_by(article_id=article_id).order_by(ArticleRevisions.revision_number).all()
            self.assertEqual(len(revisions), 2)
            self.assertEqual(article.current_revision_id, revisions[1].id)
            self.assertEqual(revisions[0].title, "Original")
            self.assertEqual(revisions[1].title, "Edited")
            self.assertEqual(ArticleEditable.model_validate(json.loads(revisions[1].snapshot_json)).title, "Edited")
            self.assertEqual(json.loads(article.field_provenance_json)["quality_score"]["origin"], "manual")
        with short_transaction(factory) as session:
            second = create_article_with_revision(session, ArticleEditable(platform_id="wechat", title="Second"))
            second_id = second.id
        with self.assertRaises(IntegrityError):
            with short_transaction(factory) as session:
                second = session.get(Articles, second_id)
                first = session.get(Articles, article_id)
                second.current_revision_id = first.current_revision_id
        engine.dispose()

    def test_source_payload_provenance_and_approximate_metric_roundtrip(self):
        engine = isolated_schema_engine()
        factory = session_factory(engine)
        with short_transaction(factory) as session:
            article = create_article_with_revision(session, ArticleEditable(platform_id="wechat", title="Example", summary="Summary"))
            article_id = article.id
            source = ArticleSources(id="source-1", article_id=article_id, discovery_candidate_id=None,
                acquisition_method="api", provider="RedFox", endpoint="ten_w_rank", external_id="external-1",
                source_url="https://example.invalid/article", source_category="知识百科",
                request_params_json='{"type":"知识百科"}', response_meta_json="{}",
                field_mapping_json='{"title":{"origin":"provider","source_path":"$.title","status":"mapped"}}',
                raw_item_hash="a" * 64, raw_content_hash=None, content_format="html", raw_complete=0,
                parser_version="fixture", warnings_json="[]", fetched_at="2026-10-24T00:00:00+00:00")
            session.add(source)
            # 2026-10-24：本次修改原因：来源须先于引用它的载荷和指标落库，避免无 relationship 映射时 flush 顺序不确定。
            session.flush()
            session.add(ArticleSourcePayloads(source_id="source-1", raw_item_json='{"title":"Example","readCount":"10w+"}',
                raw_content=None, stored_at="2026-10-24T00:00:00+00:00", retain_until=None))
            session.add(ArticleMetrics(id="metric-1", article_id=article_id, source_id="source-1",
                source_label="ten_w_rank", observed_at="2026-10-24T00:00:00+00:00",
                read_raw="10w+", read_exact=None, read_lower_bound=100000, likes=0,
                extra_metrics_json="{}", parse_warnings_json="[]", field_provenance_json='{"read_raw":{"source_path":"$.readCount"}}'))
        with factory() as session:
            payload = session.get(ArticleSourcePayloads, "source-1")
            metric = session.get(ArticleMetrics, "metric-1")
            source = session.get(ArticleSources, "source-1")
            self.assertEqual(json.loads(payload.raw_item_json)["readCount"], "10w+")
            self.assertEqual(json.loads(source.field_mapping_json)["title"]["source_path"], "$.title")
            self.assertIsNone(metric.read_exact)
            self.assertEqual(metric.read_lower_bound, 100000)
            self.assertEqual(metric.likes, 0)
        engine.dispose()


if __name__ == "__main__":
    unittest.main()
