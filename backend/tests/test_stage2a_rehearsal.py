# 2026-10-24：本次修改原因：使用虚构且明确标记的本地旧库形状验证迁移器的字段保留和引用映射；不冒充 RedFox 真实 Fixture。
import json
import sqlite3
import unittest

from scripts.rehearse_stage2a_migration import migrate
from pathlib import Path


class RehearsalFixtureTests(unittest.TestCase):
    def test_legacy_sample_strategy_metric_and_task_mapping(self):
        old = sqlite3.connect(":memory:")
        old.row_factory = sqlite3.Row
        old.executescript("""
            CREATE TABLE tasks (id TEXT PRIMARY KEY, status TEXT, request_json TEXT, created_at TEXT);
            CREATE TABLE content_samples (id TEXT PRIMARY KEY, title TEXT, body_text TEXT, platform_id TEXT,
                category_id TEXT, format_id TEXT, source_url TEXT, quality_score INTEGER,
                rights_confirmed INTEGER, created_at TEXT);
            CREATE TABLE article_metadata (sample_id TEXT PRIMARY KEY, author_id TEXT, account_followers INTEGER,
                published_at TEXT, audience_id TEXT, topic TEXT, tags_json TEXT, usage_rights_note TEXT,
                review_status TEXT, content_hash TEXT, collected_at TEXT, source_data_json TEXT);
            CREATE TABLE article_metrics (id TEXT PRIMARY KEY, sample_id TEXT, captured_at TEXT, source TEXT,
                impressions INTEGER, clicks INTEGER, reads INTEGER, likes INTEGER, saves INTEGER,
                comments INTEGER, shares INTEGER, watch_count INTEGER, raw_counts_json TEXT,
                reward_count INTEGER, interactive_count INTEGER);
            CREATE TABLE content_strategies (id TEXT PRIMARY KEY, title TEXT, platform_id TEXT, category_id TEXT,
                format_id TEXT, guide_json TEXT, sample_ids_json TEXT, status TEXT, version INTEGER, created_at TEXT);
            CREATE TABLE brands (id TEXT PRIMARY KEY, name TEXT, description TEXT, facts_json TEXT,
                active INTEGER, version INTEGER, created_at TEXT);
        """)
        old.execute("INSERT INTO content_samples VALUES (?,?,?,?,?,?,?,?,?,?)",
            ("old-article", "Example", "Full article body", "wechat", "knowledge", None,
             "https://example.invalid/a", 4, 1, "2026-10-24T00:00:00+00:00"))
        old.execute("INSERT INTO article_metadata VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
            ("old-article", "Author", None, "2026-10-23", None, None, "[]", None,
             "ready", "x" * 64, "2026-10-24T00:00:00+00:00",
             json.dumps({"provider": "RedFox", "method": "ten_w", "request": {"type": "知识百科"},
                         "response": {"title": "Example", "summary": "A summary", "readCount": "10w+"}})))
        old.execute("INSERT INTO article_metrics VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
            ("old-metric", "old-article", "2026-10-24T00:00:00+00:00", "redfox", None,
             None, None, 0, None, None, None, None, '{"reads":"10w+"}', None, None))
        old.execute("INSERT INTO content_strategies VALUES (?,?,?,?,?,?,?,?,?,?)",
            ("old-strategy", "Strategy", "wechat", None, None, "{}", '["old-article"]', "draft", 1,
             "2026-10-24T00:00:00+00:00"))
        old.execute("INSERT INTO brands VALUES (?,?,?,?,?,?,?)",
            ("old-brand", "Brand", "Description", "{}", 1, 1, "2026-10-24T00:00:00+00:00"))
        old.execute("INSERT INTO tasks VALUES (?,?,?,?)",
            ("old-task", "completed", json.dumps({"topic": "Test", "strategy_id": "old-strategy",
                "strategy_version": 1, "brand_id": "old-brand"}), "2026-10-24T00:00:00+00:00"))
        raw = sqlite3.connect(":memory:")
        frozen_ddl = Path(__file__).resolve().parents[1] / "alembic/versions/20261024_01_stage2a_schema.sql"
        raw.executescript(frozen_ddl.read_text(encoding="utf-8"))
        raw.execute("PRAGMA foreign_keys=ON")
        try:
            with raw:
                report = migrate(old, raw)
            metric = raw.execute("SELECT read_raw, read_exact, read_lower_bound, likes FROM article_metrics").fetchone()
            self.assertEqual(metric, ("10w+", None, 100000, 0))
            self.assertEqual(raw.execute("SELECT current_revision_no FROM articles WHERE id='old-article'").fetchone()[0], 1)
            self.assertIsNone(raw.execute("SELECT raw_content FROM article_source_payloads").fetchone()[0])
            self.assertEqual(raw.execute("SELECT COUNT(*) FROM strategy_article_refs WHERE article_id='old-article'").fetchone()[0], 1)
            self.assertEqual(report["foreign_key_errors"], [])
            self.assertEqual(report["active_mapping_gaps"], {})
        finally:
            raw.close()
            old.close()


if __name__ == "__main__":
    unittest.main()
