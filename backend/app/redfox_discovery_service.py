# 2026-10-23：本次修改原因：按平台和采集方式调用 RedFox 已公开的接口，并统一返回候选文章或热点话题。
# from datetime import date, datetime  # 2026-10-23：原多余导入暂留供对照。
from datetime import date, datetime
import json
from threading import Lock
from time import monotonic
from urllib.parse import urlparse

from app.redfox_service import RedFoxError, _article_text, _rank_request, get_wechat_rank, search_wechat_quality_articles


# 2026-10-23：本次修改原因：榜单翻页复用短时间内同一查询结果，避免每翻一页再次调用外部接口。
PAGE_SIZE = 10
_CACHE_TTL = 300.0
_cache_lock = Lock()
_cache: dict[str, tuple[float, dict]] = {}


def _cached(key: str) -> dict | None:
    with _cache_lock:
        entry = _cache.get(key)
        return entry[1] if entry and monotonic() - entry[0] < _CACHE_TTL else None


def _remember(key: str, result: dict) -> None:
    with _cache_lock:
        if len(_cache) >= 32:
            oldest = min(_cache, key=lambda item: _cache[item][0])
            _cache.pop(oldest, None)
        _cache[key] = (monotonic(), result)


def _paginate(result: dict, page: int) -> dict:
    items = result["items"]
    start = (page - 1) * PAGE_SIZE
    # 2026-10-24：本次修改原因：分页返回独立条目，避免数据库收录状态写回短时缓存。
    # return {**result, "items": items[start:start + PAGE_SIZE], "page": page, ...}  # 2026-10-23：原直接复用缓存条目暂留供对照。
    return {**result, "items": [dict(item) for item in items[start:start + PAGE_SIZE]], "page": page,
            "page_size": PAGE_SIZE, "total_count": len(items), "has_more": start + PAGE_SIZE < len(items)}


def _list_rows(data: dict | list) -> list:
    if isinstance(data, list):
        return data
    for key in ("list", "items", "records", "articles", "works", "notes", "data", "result",
                "rankList", "hotList", "top10", "topList", "rank", "rankData", "hotNotes", "hotWords"):
        value = data.get(key)
        if isinstance(value, list):
            return value
        if isinstance(value, dict):
            try:
                return _list_rows(value)
            except RedFoxError:
                pass
    # 2026-10-23：本次修改原因：部分平台列表字段未统一命名，仅在唯一列表可判定时回退。
    candidates = [value for value in data.values() if isinstance(value, list)
                  and all(isinstance(row, dict) for row in value)]
    if len(candidates) == 1:
        return candidates[0]
    raise RedFoxError("RedFox 已返回数据，但未识别到条目列表，请核对接口响应字段")


def _first(row: dict, *names: str):
    for name in names:
        value = row.get(name)
        if value is not None and value != "":
            return value
    return None


def _candidate(row: dict, index: int, platform: str, topic: bool) -> dict:
    # 2026-10-23：本次修改原因：部分榜单将作品字段嵌在条目的 work/article/note 中。
    work = next((row[key] for key in ("work", "article", "note", "opus") if isinstance(row.get(key), dict)), None)
    if work:
        row = {**row, **work}
    title = _first(row, "title", "articleTitle", "opusTitle", "hotWord", "hotName", "eventName",
                   "hotKeyword", "keyword", "word", "name", "topicName", "contentTitle")
    url = _first(row, "workUrl", "workLink", "articleUrl", "noteUrl", "oriUrl", "opusUrl", "link", "url", "shareUrl", "shareLink")
    url = url if isinstance(url, str) and urlparse(url).scheme in {"http", "https"} else ""
    summary = _first(row, "summary", "description", "desc", "abstract", "snippet")
    body = _first(row, "clearContent", "bodyText", "body_text", "content") if not topic else ""
    # body = str(body) if isinstance(body, str) and len(body.strip()) >= 200 else ""  # 2026-10-23：原未清理 HTML 的候选正文暂留供对照。
    # 2026-10-23：本次修改原因：候选正文字段可能含 HTML，保存前先转成可核对的纯文本。
    body = _article_text(body) if isinstance(body, str) and len(body.strip()) >= 200 else ""
    published = _first(row, "publishTime", "publicTime", "createTime", "date")
    # 2026-10-23：本次修改原因：头条搜索返回秒级时间戳，转换后才适合在列表和录入表单显示。
    if platform == "toutiao" and str(published or "").isdigit():
        try:
            published = datetime.fromtimestamp(int(published)).strftime("%Y-%m-%d %H:%M:%S")
        except (ValueError, OverflowError):
            published = ""
    return {
        "id": str(_first(row, "workUuid", "opusId", "workId", "noteId", "photoId", "articleId", "id", "hotId") or url or f"{platform}-{index}"),
        "title": str(title or "未提供标题")[:300], "summary": str(summary or "")[:500],
        "author": str(_first(row, "userName", "author", "accountName", "nickname") or ""),
        "url": url, "published_at": str(published or ""),
        "read_count": _first(row, "readCount", "clicksCount", "viewCount"),
        "like_count": _first(row, "likeCount", "likes", "diggCount"),
        "watch_count": _first(row, "watchCount"),
        "share_count": _first(row, "shareCount"),
        "comment_count": _first(row, "commentCount", "commentNum"),
        # 2026-10-24：本次修改原因：跨平台搜索返回账号规模时也保留原值。
        "account_followers": _first(row, "fansCount", "followerCount", "accountFollowers"),
        "platform": platform, "kind": "topic" if topic else "article", "body_text": body[:30000],
        "body_truncated": len(body) > 30000,
    }


def discover(*, platform: str, method: str, keyword: str | None, category: str | None,
             start_date: str | None, end_date: str | None, rank_date: date | None,
             hotspot_platform: int | None, page: int = 1) -> dict:
    cache_key = json.dumps([platform, method, keyword, category, start_date, end_date,
                            rank_date.isoformat() if rank_date else None, hotspot_platform], ensure_ascii=False)
    if method != "keyword" or platform == "multi":
        cached = _cached(cache_key)
        if cached is not None:
            return _paginate(cached, page)
    # 2026-10-23：本次修改原因：每个方式仅发送接口实际支持的筛选条件，避免无效查询和多余调用。
    if platform == "wechat":
        if method == "keyword":
            # result = search_wechat_quality_articles(keyword or "", offset=(page - 1) * PAGE_SIZE, limit=PAGE_SIZE)  # 2026-10-24：原每十条改变上游偏移量的逻辑留作对照。
            # 2026-10-24：本次修改原因：关键词接口按 20 条偏移，上游结果缓存后分成两个十条页面。
            upstream_offset = ((page - 1) // 2) * 20
            keyword_key = json.dumps(["wechat-keyword", keyword, upstream_offset], ensure_ascii=False)
            result = _cached(keyword_key)
            if result is None:
                result = search_wechat_quality_articles(keyword or "", offset=upstream_offset, limit=20)
                _remember(keyword_key, result)
        elif method in {"ten_w", "original"}:
            result = get_wechat_rank(method, category=category,
                                     start_date=date.fromisoformat((start_date or "")[:10]),
                                     end_date=date.fromisoformat((end_date or "")[:10]), limit=None)
        else:
            raise RedFoxError("不支持的公众号采集方式")
        normalized = {**result, "platform": platform,
                      "items": [{**item, "platform": platform, "kind": "article"} for item in result["items"]]}
        if method == "keyword":
            # return {**normalized, "page": page, "page_size": PAGE_SIZE,
            #         "total_count": None, "has_more": bool(result.get("has_more"))}  # 2026-10-24：原直接返回上游第一页的逻辑留作对照。
            # 2026-10-24：本次修改原因：每个页面仅返回本组十条，下一页状态由余量及 hasMore 决定。
            start = ((page - 1) % 2) * PAGE_SIZE
            return {**normalized, "page": page, "page_size": PAGE_SIZE,
                    "items": [dict(item) for item in normalized["items"][start:start + PAGE_SIZE]],
                    "has_more": start + PAGE_SIZE < len(normalized["items"]) or bool(result.get("has_more"))}
        _remember(cache_key, normalized)
        return _paginate(normalized, page)

    topic = platform == "multi" or method == "hotspot"
    source = f"{platform}-{method}-AI4GeoContentOps"
    if platform == "xiaohongshu":
        if method == "dark_horse":
            path, verb, args = "/story/api/cozeSkill/getLowPowderExplosiveArticle", "POST", {
                "category": category, "rankDate": rank_date.isoformat()}
        elif method in {"daily", "weekly"}:
            path = ("/story/api/cozeSkill/getXhsCozeSkillDataOne" if method == "daily"
                    else "/story/api/cozeSkill/getXhsCozeSkillDataSeven")
            verb, args = "GET", {"rankDate": rank_date.isoformat(), "category": category}
        else:
            raise RedFoxError("不支持的小红书采集方式")
    elif platform == "baijiahao" and method == "keyword":
        path, verb, args = "/story/api/bjh/ability/searchWork", "POST", {
            "keyWord": keyword, "pn": str((page - 1) * PAGE_SIZE)}
    elif platform == "toutiao" and method == "keyword":
        path, verb, args = "/story/api/toutiao/searchWork", "POST", {"keyword": keyword, "offset": str(page - 1)}
    elif platform == "zhihu" and method == "keyword":
        # 2026-10-23：本次修改原因：沿用 RedFox 官方 SDK 所用的请求键名 keword。
        path, verb, args = "/story/api/zhihu/ability/searchWork", "POST", {
            "keword": keyword, "offset": str(((page - 1) // 2) * 20), "vertical": "article"}
    elif platform == "zhihu" and method == "hotspot":
        path, verb, args = "/story/api/hotSpot/getListByPlatform", "GET", {
            "platform": 9, "startDate": start_date, "endDate": end_date}
    elif platform == "multi" and method == "top10":
        path, verb, args = "/story/api/hotKeyword/list", "POST", {"startDate": start_date, "endDate": end_date}
    elif platform == "multi" and method == "keyword":
        path, verb, args = "/story/api/hotSpot/getListByPlatformWithKeyword", "POST", {
            "keywords": [keyword], "startDate": start_date, "endDate": end_date}
    elif platform == "multi" and method == "hotspot":
        path, verb, args = "/story/api/hotSpot/getListByPlatform", "GET", {
            "platform": hotspot_platform, "startDate": start_date, "endDate": end_date}
    else:
        raise RedFoxError("不支持的平台与采集方式组合")

    data = _rank_request(verb, path, args, source)
    rows = _list_rows(data)
    # items = [_candidate(row, index, platform, topic) for index, row in enumerate(rows[:20], 1) if isinstance(row, dict)]  # 2026-10-23：原固定 20 条截断暂留供对照。
    if method == "keyword" and platform == "zhihu":
        rows_for_page = rows[((page - 1) % 2) * PAGE_SIZE:((page - 1) % 2 + 1) * PAGE_SIZE]
    elif method == "keyword" and platform != "multi":
        rows_for_page = rows[:PAGE_SIZE]
    else:
        rows_for_page = rows
    items = [_candidate(row, index, platform, topic) for index, row in enumerate(rows_for_page, 1)
             if isinstance(row, dict)]
    if rows and not items:
        raise RedFoxError("RedFox 返回的条目不是可读取的对象，请核对接口响应字段")
    result = {"source": method, "platform": platform, "keyword": keyword or "",
            "category": category, "start_date": start_date, "end_date": end_date,
            "rank_date": rank_date.isoformat() if rank_date else None,
            "total_count": len(rows), "items": items, "warnings": []}
    if method == "keyword" and platform != "multi":
        # 2026-10-23：本次修改原因：提供商未返回可靠总数时仅报告是否可能有下一页。
        has_more = (len(rows) > ((page - 1) % 2 + 1) * PAGE_SIZE or len(rows) >= 20) if platform == "zhihu" else len(rows) >= PAGE_SIZE
        if rows and isinstance(rows[-1], dict) and "hasNext" in rows[-1]:
            has_more = bool(rows[-1]["hasNext"])
        return {**result, "page": page, "page_size": PAGE_SIZE,
                "total_count": None, "has_more": has_more}
    _remember(cache_key, result)
    return _paginate(result, page)


# 2026-10-23：本次修改原因：点“收录”时只为选中的作品补取详情；无正文时交给弹窗人工补齐。
def get_candidate_detail(platform: str, work_id: str, url: str | None = None) -> dict:
    if platform == "xiaohongshu":
        path, args = "/story/api/xhsUser/queryWorkDetail", ({"workLink": url} if url else {"workId": work_id})
    elif platform == "baijiahao":
        path, args = "/story/api/bjh/ability/opusHtml", {"articleId": work_id}
    elif platform == "toutiao":
        path, args = "/story/api/toutiao/workDetail", {"opusId": work_id}
    else:
        raise RedFoxError("该平台没有可用的文章详情接口，请在收录窗口补齐正文")
    data = _rank_request("POST", path, args, f"{platform}-article-detail-AI4GeoContentOps")
    if not isinstance(data, dict):
        raise RedFoxError("RedFox 详情返回结构不符合预期，请手动核对正文")
    work = next((data[key] for key in ("work", "article", "result", "data")
                 if isinstance(data.get(key), dict)), data)
    raw = _first(work, "clearContent", "bodyText", "body_text", "content", "html", "text")
    body = _article_text(raw) if isinstance(raw, str) else ""
    source_url = str(_first(work, "workUrl", "workLink", "articleUrl", "opusUrl", "url") or url or "")
    source_url = source_url if urlparse(source_url).scheme in {"http", "https"} else ""
    return {"title": str(_first(work, "title", "articleTitle", "opusTitle") or ""),
            "body_text": body[:30000] if len(body) >= 50 else "",
            "body_truncated": len(body) > 30000,
            "source_url": source_url}
