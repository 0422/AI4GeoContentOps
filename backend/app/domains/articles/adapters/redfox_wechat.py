# 2026-10-24：本次修改原因：Stage 2B 将公众号三类 RedFox 响应统一映射为候选，同时保留完整原项和逐字段来源。
"""Pure parsing helpers for the three documented RedFox WeChat endpoints."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any

from app.domains.articles.contracts import FieldProvenance, ProvenanceStatus
from app.redfox_service import RedFoxError, _post, _rank_request

PARSER_VERSION = "redfox-wechat-1"
REDFOX_WECHAT_CATEGORIES = (
    "人文资讯", "知识百科", "健康养生", "时尚潮流", "乐活生活", "旅游出行", "搞笑幽默",
    "情感心理", "体育娱乐", "美容美体", "文摘精选", "财富理财", "科技数码", "创投商业",
    "汽车交通", "房产楼市", "职场发展", "教育考试", "学术研究", "企业品牌",
)
ENDPOINTS = {
    "keyword_search": "/story/api/gzhData/searchArticle",
    "ten_w_rank": "/story/api/cozeSkill/getTenWReadingRank",
    "original_rank": "/story/api/cozeSkill/getOriginalRank",
}


@dataclass(frozen=True)
class ParsedCandidate:
    raw_item: dict[str, Any]
    normalized: dict[str, Any]
    provenance: dict[str, dict[str, Any]]
    external_id: str | None
    warnings: tuple[str, ...]
    content_status: str


def _list(data: Any, names: tuple[str, ...]) -> list[dict[str, Any]]:
    if isinstance(data, list):
        rows = data
    elif isinstance(data, dict):
        rows = next((data[key] for key in names if isinstance(data.get(key), list)), None)
        if rows is None:
            options = [value for value in data.values() if isinstance(value, list)
                       and all(isinstance(row, dict) for row in value)]
            rows = options[0] if len(options) == 1 else None
    else:
        rows = None
    if rows is None:
        raise RedFoxError("RedFox 返回成功，但未识别到文章列表；完整响应已无法解析为候选")
    return [row for row in rows if isinstance(row, dict)]


def _first(row: dict[str, Any], *keys: str) -> tuple[str | None, Any]:
    for key in keys:
        if key in row:
            value = row[key]
            if value is not None and value != "":
                return key, value
            # An explicit null is meaningful and should be recorded if no later alias has a value.
    for key in keys:
        if key in row:
            return key, row[key]
    return None, None


def _provenance(row: dict[str, Any], selected: str | None, value: Any, transform: str | None = None) -> dict[str, Any]:
    if selected is None:
        status = ProvenanceStatus.missing
    elif value is None:
        status = ProvenanceStatus.explicit_null
    else:
        status = ProvenanceStatus.mapped
    return FieldProvenance(origin="provider", status=status,
                           source_path=f"$.{selected}" if selected else None,
                           raw_value=value, transform=transform).model_dump(mode="json")


def _text(value: Any, limit: int | None = None) -> str | None:
    if value is None:
        return None
    result = value.strip() if isinstance(value, str) else str(value)
    return result[:limit] if limit is not None else result


def _number(value: Any) -> tuple[int | None, str | None]:
    if value is None or isinstance(value, bool):
        return None, None if value is None else f"Unsupported numeric value: {value!r}"
    if isinstance(value, int) and value >= 0:
        return value, None
    if isinstance(value, str):
        stripped = value.strip().replace(",", "")
        if stripped.isdigit():
            return int(stripped), None
    return None, f"Value retained as raw because it is not an exact non-negative integer: {value!r}"


def _published(value: Any) -> tuple[str | None, str | None]:
    if value is None:
        return None, None
    if isinstance(value, (int, float)):
        return None, "Numeric publish time was not converted because its unit is unverified"
    raw = str(value).strip()
    if not raw:
        return None, None
    try:
        parsed = datetime.fromisoformat(raw.replace("Z", "+00:00"))
        if parsed.tzinfo is None:
            # 2026-10-24：本次修改原因：无时区发布时间保留其原始日历日期，避免候选列表和录入表单无故留空；不推断时区或转换时刻。
            if len(raw) == 10:
                return raw, None
            return parsed.date().isoformat(), "发布时间缺少时区；保留接口原始日期，不转换或推断具体时刻"
        return parsed.astimezone(timezone.utc).isoformat(), None
    except ValueError:
        if len(raw) == 10:
            try:
                return datetime.strptime(raw, "%Y-%m-%d").date().isoformat(), None
            except ValueError:
                pass
        return None, "Publish time format was not recognized; raw value retained"


def _candidate(row: dict[str, Any], endpoint: str, category: str | None) -> ParsedCandidate:
    warnings: list[str] = []
    fields: dict[str, Any] = {}
    provenance: dict[str, dict[str, Any]] = {}

    def mapped(target: str, keys: tuple[str, ...], transform: str | None = None) -> Any:
        key, raw = _first(row, *keys)
        provenance[target] = _provenance(row, key, raw, transform)
        return raw

    title_raw = mapped("title", ("title",))
    title = _text(title_raw, 300)
    if title and title != title_raw:
        provenance["title"]["status"] = ProvenanceStatus.truncated.value
        provenance["title"]["transform"] = "trim_and_limit_300"
    summary_raw = mapped("summary", ("summary", "description"), "trim")
    summary = _text(summary_raw)
    author_raw = mapped("author_name", ("author", "userName", "accountName"), "trim")
    author = _text(author_raw)
    url_raw = mapped("article_url", ("workUrl", "oriUrl"), "trim")
    url = _text(url_raw)
    source_url = _text(mapped("source_url", ("sourceUrl",), "trim"))
    published_raw = mapped("published_at", ("publishTime", "publicTime"), "parse_iso_date_or_utc")
    published, warning = _published(published_raw)
    if warning:
        warnings.append(warning)
        if published is not None:
            provenance["published_at"]["status"] = ProvenanceStatus.approximate.value
            provenance["published_at"]["transform"] = "retain_calendar_date_timezone_unknown"
    content_raw = mapped("body_text", ("content",), "preserve_raw_body")
    body = _text(content_raw)
    if body and len(body) > 30000:
        body = body[:30000]
        provenance["body_text"]["status"] = ProvenanceStatus.truncated.value
        provenance["body_text"]["transform"] = "truncate_30000_for_editable_preview; raw_retained"
        warnings.append("正文展示值超过 30000 字符；正式文章正文按预览上限保存，完整原文保存在来源载荷")

    # 2026-10-24：本次修改原因：榜单 `type` 表示 Provider 来源分类，不应冒充样本库内部内容类目。
    source_category_raw = row.get("type") if endpoint != "keyword_search" else None
    provenance["source_category"] = FieldProvenance(
        origin="provider" if source_category_raw is not None else "transform",
        status=ProvenanceStatus.mapped if source_category_raw is not None or category else ProvenanceStatus.missing,
        source_path="$.type" if source_category_raw is not None else None,
        transform="rank_category_request_parameter" if category else None,
        raw_value=source_category_raw if source_category_raw is not None else category,
    ).model_dump(mode="json")
    if (isinstance(source_category_raw, str) and source_category_raw.strip() in REDFOX_WECHAT_CATEGORIES
            and category and source_category_raw.strip() != category.strip()):
        warnings.append(f"接口返回类目“{source_category_raw}”与请求类目“{category}”不一致，请人工核对")
    # 2026-10-24：本次修改原因：区分用户请求的榜单分类和 Provider 对单条文章返回的分类，避免把筛选条件伪装成文章分类。
    provenance["requested_source_category"] = FieldProvenance(
        origin="transform", status=ProvenanceStatus.mapped if category else ProvenanceStatus.missing,
        transform="rank_category_request_parameter" if category else None, raw_value=category,
    ).model_dump(mode="json")
    fields["category_id"] = None
    provenance["category_id"] = FieldProvenance(
        origin="transform", status=ProvenanceStatus.missing,
        transform="internal_content_category_requires_user_selection",
    ).model_dump(mode="json")
    fields.update(platform_id="platform_01",
                  title=title, summary=summary, body_text=body, author_name=author,
                  published_at=published, article_url=url)

    metric_keys = {
        "read": ("readCount", "clicksCount"), "likes": ("likeCount",),
        "watch_count": ("watchCount",), "comments": ("commentCount",),
        "shares": ("shareCount",), "saves": ("collectCount",),
        "rewards": ("rewardCount",), "fans_count": ("fans",),
        "interactive_count": ("interactiveCount",),
    }
    metrics: dict[str, Any] = {}
    for name, aliases in metric_keys.items():
        raw = mapped(f"metric.{name}", aliases, "parse_nonnegative_integer")
        exact, parse_warning = _number(raw)
        if name == "read" and isinstance(raw, str) and raw.strip().lower().endswith("w+"):
            digits = raw.strip().lower()[:-2]
            try:
                lower = int(float(digits) * 10000)
                metrics.update(read_raw=raw, read_exact=None, read_lower_bound=lower)
                provenance[f"metric.{name}"]["status"] = ProvenanceStatus.approximate.value
                provenance[f"metric.{name}"]["transform"] = "parse_lower_bound_w_plus"
            except ValueError:
                metrics.update(read_raw=raw, read_exact=None, read_lower_bound=None)
                warnings.append(f"阅读量区间无法解析：{raw!r}")
        elif name == "read":
            metrics.update(read_raw=None if raw is None else str(raw), read_exact=exact, read_lower_bound=None)
            if parse_warning:
                warnings.append(parse_warning)
        else:
            metrics[name] = exact
            if parse_warning:
                warnings.append(f"{name}: {parse_warning}")

    id_key, external_id_value = _first(row, "workUuid", "photoId")
    external_id = _text(external_id_value)
    if id_key:
        provenance["external_id"] = _provenance(row, id_key, external_id_value)
    if not title:
        warnings.append("缺少标题，不能直接收录；可在候选编辑草稿中补齐")
    if not body:
        warnings.append("接口未提供可解析正文；摘要不会被当作正文")
    if content_raw is not None and not isinstance(content_raw, str):
        warnings.append("正文原始字段不是文本，已完整保留在来源载荷，未强制转换")
    # Presence and length alone do not prove that a provider returned the full article body.
    status = "unknown" if body else "partial" if summary else "missing"
    if body:
        warnings.append("接口返回正文文本，但完整性尚未由接口契约或人工核对确认")
    normalized = {**fields, "metrics": metrics,
                  "source_category": _text(source_category_raw),
                  "requested_source_category": category,
                  "published_at_raw": None if published_raw is None else str(published_raw),
                  "content_status": status,
                  "raw_content_format": "html" if isinstance(content_raw, str) and "<" in content_raw else "text",
                  "raw_complete": False}
    # The response contract is intentionally labeled unverified where the mapping document says so.
    if endpoint != "keyword_search":
        warnings.append("该榜单接口的响应字段映射仍待真实脱敏 Fixture 验证")
    return ParsedCandidate(row, normalized, provenance, external_id, tuple(warnings), status)


def fetch_wechat(method: str, *, keyword: str | None = None, category: str | None = None,
                 start_date: str | None = None, end_date: str | None = None,
                 offset: int = 0, sort_type: str | None = None,
                 exact_match: bool | None = None) -> tuple[str, dict[str, Any], list[ParsedCandidate], bool | None]:
    if method not in ENDPOINTS:
        raise ValueError("Unsupported WeChat discovery method")
    endpoint = ENDPOINTS[method]
    if method == "keyword_search":
        params: dict[str, Any] = {"keyword": (keyword or "").strip(), "offset": max(0, offset)}
        if sort_type is not None:
            params["sortType"] = sort_type
        if exact_match is not None:
            params["exactMatch"] = exact_match
        data = _post(endpoint, params)
        rows = _list(data, ("list",))
        has_more = data.get("hasMore") if isinstance(data.get("hasMore"), bool) else None
    else:
        params = {"type": category, "startDate": start_date, "endDate": end_date}
        data = _rank_request("POST", endpoint, params, f"wechat-{method}-AI4GeoContentOps")
        names = ("tenWReadingRank", "list", "articles", "records") if method == "ten_w_rank" else ("originalRank", "list", "articles", "records")
        rows = _list(data, names)
        has_more = None
    candidates = [_candidate(row, method, category) for row in rows]
    return endpoint, {"request": params, "response": data}, candidates, has_more
