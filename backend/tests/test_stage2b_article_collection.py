# 2026-10-24：本次修改原因：验证候选收录后文章、指标、来源载荷与逐字段 provenance 可从目标库完整回读。
"""Stage 2B persistence contract tests. No network or paid provider is used."""

import json
import unittest
from datetime import datetime, timezone

from sqlalchemy import create_engine, event, select
from sqlalchemy.orm import Session
from sqlalchemy.pool import StaticPool

from app.domains.articles.contracts import RightsScope
from app.domains.articles.service import collect_candidate
from app.infrastructure.database.target_models import (
    ArticleMetrics, ArticleSourcePayloads, ArticleSources, Articles, DiscoveryCandidates,
    DiscoveryFetches, DiscoverySessions, TargetBase,
)


class ArticleCollectionTests(unittest.TestCase):
    def setUp(self):
        self.engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)

        @event.listens_for(self.engine, "connect")
        def enable_foreign_keys(connection, _record):
            connection.execute("PRAGMA foreign_keys=ON")

        TargetBase.metadata.create_all(self.engine)

    def tearDown(self):
        self.engine.dispose()

    def test_candidate_fields_metrics_payload_and_provenance_survive_collection(self):
        now = datetime.now(timezone.utc).isoformat()
        raw_item = {"title": "A title", "content": "full raw body", "publishTime": "2026-10-20 08:20:00",
                    "readCount": "10w+", "likeCount": 0,
                    "unknown": {"kept": True}}
        with Session(self.engine) as session:
            session.add(DiscoverySessions(id="session-1", platform_id="platform_01", provider="redfox",
                endpoint="keyword_search", request_params_json='{"keyword":"geo"}', status="completed",
                result_count=1, pinned=0, created_at=now, expires_at=now, last_viewed_at=now))
            # 2026-10-24：本次修改原因：测试夹具依照 session → fetch → candidate 的外键依赖顺序写入。
            session.flush()
            session.add(DiscoveryFetches(id="fetch-1", session_id="session-1", request_params_json='{"keyword":"geo"}',
                raw_response_json=json.dumps({"list": [raw_item]}), upstream_cursor=None, result_count=1,
                has_more=0, fetched_at=now))
            session.flush()
            session.add(DiscoveryCandidates(id="candidate-1", session_id="session-1", fetch_id="fetch-1",
                candidate_kind="article", provider="redfox", endpoint="keyword_search", external_id="wk-1",
                candidate_key="key-1", raw_item_json=json.dumps(raw_item),
                normalized_json=json.dumps({"platform_id":"platform_01", "title":"A title", "summary":"summary",
                    "body_text":"editable body " * 8, "author_name":"writer", "published_at":None,
                    "article_url":"https://mp.weixin.qq.com/s/1", "category_id":"category_01",
                    "metrics":{"read_raw":"10w+", "read_exact":None, "read_lower_bound":100000, "likes":0}}),
                field_provenance_json=json.dumps({"title":{"origin":"provider", "status":"mapped", "source_path":"$.title"},
                    "body_text":{"origin":"provider", "status":"mapped", "source_path":"$.content"},
                    "metric.read":{"origin":"provider", "status":"approximate", "source_path":"$.readCount"}}),
                edit_draft_json=None, row_version=1, parser_version="test", warnings_json="[]",
                content_status="complete", pinned=0, collected_article_id=None, discovered_at=now, updated_at=now))
            session.commit()
            article = collect_candidate(session, "candidate-1", 1,
                RightsScope(store=True, local_clean=True, third_party_llm=None, generation_reference=None))
            session.commit()
            article_id = article.id

        with Session(self.engine) as session:
            article = session.get(Articles, article_id)
            candidate = session.get(DiscoveryCandidates, "candidate-1")
            source = session.scalar(select(ArticleSources).where(ArticleSources.article_id == article_id))
            payload = session.get(ArticleSourcePayloads, source.id)
            metric = session.scalar(select(ArticleMetrics).where(ArticleMetrics.article_id == article_id))
            self.assertEqual(article.title, "A title")
            # 2026-10-24：本次修改原因：验证旧候选的发布时间为空时，收录服务会从原始来源字段补齐日期。
            self.assertEqual(article.published_at, "2026-10-20")
            self.assertEqual(article.field_provenance_json and json.loads(article.field_provenance_json)["title"]["source_path"], "$.title")
            self.assertEqual(candidate.collected_article_id, article_id)
            self.assertEqual(json.loads(payload.raw_item_json)["unknown"], {"kept": True})
            self.assertEqual(metric.read_raw, "10w+")
            self.assertIsNone(metric.read_exact)
            self.assertEqual(metric.read_lower_bound, 100000)
            self.assertEqual(metric.likes, 0)


if __name__ == "__main__":
    unittest.main()
