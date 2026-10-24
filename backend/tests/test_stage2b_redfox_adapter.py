# 2026-10-24：本次修改原因：Stage 2B 锁定公众号候选字段、原始项保留和指标空值语义，避免解析到收录间丢值。
"""Pure Stage 2B contract tests; no live RedFox calls are made."""

import unittest
from unittest.mock import patch

from app.domains.articles.adapters.redfox_wechat import _candidate, fetch_wechat


class RedFoxWechatAdapterTests(unittest.TestCase):
    def test_candidate_preserves_unknown_raw_fields_and_tracks_mapping(self):
        raw = {
            "workUuid": "wk-1", "title": "  标题  ", "summary": "摘要",
            "content": "正文" * 40, "author": "作者", "workUrl": "https://mp.weixin.qq.com/s/1",
            "publishTime": "2026-10-24", "readCount": "10w+", "likeCount": 0,
            "commentCount": None, "unknownProviderField": {"x": 1},
        }
        item = _candidate(raw, "keyword_search", None)
        self.assertEqual(item.raw_item, raw)
        self.assertEqual(item.normalized["title"], "标题")
        self.assertEqual(item.normalized["metrics"]["read_exact"], None)
        self.assertEqual(item.normalized["metrics"]["read_lower_bound"], 100000)
        self.assertEqual(item.normalized["metrics"]["likes"], 0)
        self.assertIsNone(item.normalized["metrics"]["comments"])
        self.assertEqual(item.provenance["title"]["source_path"], "$.title")
        self.assertEqual(item.provenance["metric.read"]["status"], "approximate")

    # 2026-10-24：本次修改原因：防止榜单请求类目冒充单篇返回类目，并回归无时区发布时间的日期保留行为。
    def test_rank_request_category_is_separate_from_returned_category_and_naive_time_keeps_date(self):
        raw = {"title": "榜单文章", "type": "健康养生", "publishTime": "2026-10-22 12:16:03"}
        item = _candidate(raw, "ten_w_rank", "美容美体")
        self.assertEqual(item.normalized["requested_source_category"], "美容美体")
        self.assertEqual(item.normalized["source_category"], "健康养生")
        self.assertIsNone(item.normalized["category_id"])
        self.assertEqual(item.normalized["published_at"], "2026-10-22")
        self.assertEqual(item.normalized["published_at_raw"], "2026-10-22 12:16:03")
        self.assertTrue(any("类目" in warning for warning in item.warnings))

    @patch("app.domains.articles.adapters.redfox_wechat._post")
    def test_keyword_fetch_uses_documented_fields_and_preserves_response_rows(self, post):
        raw = {"title": "A", "workUuid": "wk-2", "content": "X" * 80, "extra": "kept"}
        post.return_value = {"list": [raw], "total": 1, "hasMore": False}
        endpoint, payload, candidates, has_more = fetch_wechat("keyword_search", keyword="geo", offset=20)
        self.assertEqual(endpoint, "/story/api/gzhData/searchArticle")
        self.assertEqual(post.call_args.args[1], {"keyword": "geo", "offset": 20})
        self.assertEqual(payload["response"]["list"][0], raw)
        self.assertEqual(candidates[0].raw_item["extra"], "kept")
        self.assertFalse(has_more)


if __name__ == "__main__":
    unittest.main()
