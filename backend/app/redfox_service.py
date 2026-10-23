# 2026-10-23：本次修改原因：以有限的公众号热门文章查询验证 RedFox 数据接入，并在人工审核前仅返回候选数据。
import os
import re
from datetime import date, timedelta
from html.parser import HTMLParser
from pathlib import Path
from urllib.parse import urlparse

import httpx
from dotenv import load_dotenv


load_dotenv(Path(__file__).resolve().parents[1] / ".env", override=False, encoding="utf-8")

REDFOX_BASE_URL = "https://redfox.hk"


class RedFoxError(Exception):
    pass


def key_configured() -> bool:
    return bool(os.getenv("REDFOX_API_KEY", "").strip())


def _post(path: str, payload: dict) -> dict:
    key = os.getenv("REDFOX_API_KEY", "").strip()
    if not key:
        raise RedFoxError("请先在 backend/.env 中配置 REDFOX_API_KEY，并重启后端")
    try:
        with httpx.Client(timeout=25.0) as client:
            response = client.post(
                REDFOX_BASE_URL + path,
                # headers={"X-API-KEY": key, "Content-Type": "application/json"}, json=payload,  # 2026-10-23：原统一鉴权方式暂留供对照。
                # 2026-10-23：本次修改原因：公众号优质库按 RedFox 官方 SDK 使用 REDFOX_API_KEY 请求头及 source 字段；热门接口保持已验证的请求头。
                headers={"REDFOX_API_KEY" if path.startswith("/story/api/gzhData/") else "X-API-KEY": key,
                         "Content-Type": "application/json"},
                # json={**payload, "source": "AI4GeoContentOps"} if path.startswith("/story/api/gzhData/") else payload,  # 2026-10-24：原额外请求字段留作对照。
                # 2026-10-24：本次修改原因：关键词接口只提交文档列出的 keyword、offset 等请求字段。
                json=payload if path == "/story/api/gzhData/searchArticle" else
                     {**payload, "source": "AI4GeoContentOps"} if path.startswith("/story/api/gzhData/") else payload,
            )
    except httpx.RequestError as error:
        raise RedFoxError("RedFox 网络请求失败，请稍后重试") from error
    if response.status_code in (401, 403):
        raise RedFoxError("RedFox 密钥无效或当前接口未开通")
    if response.status_code == 429:
        raise RedFoxError("RedFox 调用过于频繁，请稍后再试")
    if response.status_code >= 400:
        raise RedFoxError(f"RedFox 请求失败（HTTP {response.status_code}）")
    try:
        result = response.json()
    except ValueError as error:
        raise RedFoxError("RedFox 返回了无法解析的数据") from error
    if not isinstance(result, dict):
        raise RedFoxError("RedFox 返回结构不符合预期")
    code = result.get("code")
    if str(code) != "2000":
        if str(code) == "3201":
            raise RedFoxError("RedFox 账户额度不足")
        if str(code) == "4004":
            raise RedFoxError("RedFox 调用过于频繁，请稍后再试")
        # raise RedFoxError(f"RedFox 接口返回错误（code={code}）")  # 2026-10-23：原错误提示暂留供对照。
        # 2026-10-23：本次修改原因：保留服务端简短 msg，便于区分权限、参数和文章未收录；密钥不写入提示。
        # message = str(result.get("msg") or "未提供说明").replace(key, "[已隐藏]")  # 2026-10-23：原仅兼容 msg 暂留供对照。
        # 2026-10-23：本次修改原因：官网说明错误消息字段可能是 msg 或 message。
        message = str(result.get("msg") or result.get("message") or "未提供说明").replace(key, "[已隐藏]")
        message = " ".join(message.split())[:160]
        raise RedFoxError(f"RedFox 接口返回错误（code={code}）：{message}")
    data = result.get("data")
    if not isinstance(data, dict):
        raise RedFoxError("RedFox 返回的 data 结构不符合预期")
    return data


# 2026-10-23：本次修改原因：榜单同时使用 GET 和 POST，且返回的 data 可能是列表；单独解析榜单响应并给出可操作的错误提示。
def _rank_request(method: str, path: str, payload: dict, source_name: str) -> dict | list:
    key = os.getenv("REDFOX_API_KEY", "").strip()
    if not key:
        raise RedFoxError("请先在 backend/.env 中配置 REDFOX_API_KEY，并重启后端")
    # arguments = {**payload, "source": source_name}  # 2026-10-24：原统一追加 source 字段留作对照。
    # 2026-10-24：本次修改原因：两种公众号榜单只发送文档要求的 type/startDate/endDate。
    arguments = payload if path in {"/story/api/cozeSkill/getTenWReadingRank",
                                    "/story/api/cozeSkill/getOriginalRank"} else {**payload, "source": source_name}
    try:
        with httpx.Client(timeout=30.0) as client:
            response = client.request(
                method, REDFOX_BASE_URL + path,
                headers={"REDFOX_API_KEY": key, "Content-Type": "application/json"},
                params=arguments if method == "GET" else None,
                json=arguments if method == "POST" else None,
            )
    except httpx.TimeoutException as error:
        raise RedFoxError("RedFox 榜单请求超时，请稍后重试") from error
    except httpx.RequestError as error:
        raise RedFoxError("RedFox 网络连接失败，请检查网络后重试") from error
    try:
        result = response.json()
    except ValueError as error:
        # 2026-10-23：本次修改原因：鉴权或服务端返回 HTML 时仍优先显示 HTTP 状态对应的处理建议。
        if response.status_code in {400, 401, 403, 429, 500, 503}:
            plain_http_hint = {
                400: "请求参数不符合接口要求，请核对类目与日期",
                401: "密钥无效或缺失，请检查 backend/.env",
                403: "当前密钥无权调用该榜单，请检查接口权限",
                429: "调用过于频繁，请稍后重试",
                500: "RedFox 服务端异常，请稍后重试",
                503: "RedFox 服务暂不可用，请稍后重试",
            }
            raise RedFoxError(f"{plain_http_hint[response.status_code]}（HTTP {response.status_code}，响应非 JSON）") from error
        raise RedFoxError(f"RedFox 返回非 JSON 内容（HTTP {response.status_code}），请稍后重试") from error
    if not isinstance(result, dict):
        raise RedFoxError("RedFox 返回结构异常：顶层不是 JSON 对象，请核对接口版本")
    provider_code = str(result.get("code") or "")
    provider_message = str(result.get("msg") or result.get("message") or "未提供说明")
    provider_message = " ".join(provider_message.replace(key, "[已隐藏]").split())[:160]
    if response.status_code >= 400:
        # 2026-10-23：本次修改原因：HTTP 状态和 RedFox 业务码分别展示，避免把鉴权、限流和服务错误统称为抓取失败。
        http_hint = {
            400: "请求参数不符合接口要求，请核对类目与日期",
            401: "密钥无效或缺失，请检查 backend/.env",
            403: "当前密钥无权调用该榜单，请检查接口权限",
            429: "调用过于频繁，请稍后重试",
            500: "RedFox 服务端异常，请稍后重试",
            503: "RedFox 服务暂不可用，请稍后重试",
        }.get(response.status_code, "RedFox 请求失败，请稍后重试")
        raise RedFoxError(f"{http_hint}（HTTP {response.status_code}，code={provider_code or '未提供'}）：{provider_message}")
    # 2026-10-23：本次修改原因：榜单旧文档出现 code=200，现行 SDK 使用 2000；仅对榜单兼容两种成功码。
    if provider_code not in {"2000", "200"}:
        business_hint = {
            "1001": "缺少必填参数，请核对日期和类目",
            "1002": "参数格式不正确，请核对日期格式和类目名称",
            "1003": "参数类型不正确，请检查请求参数",
            "3103": "RedFox 密钥不存在，请检查 backend/.env",
            "3105": "RedFox 密钥已禁用，请在控制台检查密钥状态",
            "3201": "RedFox 账户额度不足，请检查账户余额",
            "3202": "RedFox 积分账户异常，请在控制台检查账户",
            "4004": "RedFox 调用过于频繁，请稍后重试",
            "500": "RedFox 服务端异常，请稍后重试",
            "503": "RedFox 服务暂不可用，请稍后重试",
        }.get(provider_code, "RedFox 未完成本次榜单查询")
        raise RedFoxError(f"{business_hint}（code={provider_code or '未提供'}）：{provider_message}")
    data = result.get("data")
    if not isinstance(data, (dict, list)):
        raise RedFoxError("RedFox 返回成功状态，但缺少可读取的榜单 data；请核对接口响应")
    return data


# 2026-10-24：本次修改原因：三种公众号接口的原始非正文返回字段统一保存，供样本详情核对来源。
_WECHAT_FIELDS = (
    "accountId", "accountType", "author", "collectCount", "commentCount", "coverUrl",
    "fans", "interactiveCount", "isOriginal", "likeCount", "memo", "orderNum",
    "originalAuthor", "originalFlag", "oriUrl", "photoId", "publishLocation",
    "publishTime", "publicTime", "readCount", "clicksCount", "rewardCount",
    "shareCount", "sourceUrl", "summary", "syncTime", "thumbnail", "title", "type",
    "userHeadUrl", "userName", "watchCount", "workUrl", "workUuid",
)


def _wechat_source_data(article: dict, method: str, request: dict) -> dict:
    return {"provider": "RedFox", "method": method, "request": request,
            "response": {key: article[key] for key in _WECHAT_FIELDS if key in article}}


# 2026-10-23：本次修改原因：仅把榜单明示的阅读、互动指标及来源转换为候选卡片，缺失字段保持为空而不伪造为 0。
def _rank_candidate(article: dict, source: str, index: int, *, account: dict | None = None,
                    role: str = "", request: dict | None = None) -> dict:
    account = account or {}
    url = article.get("oriUrl") or article.get("workUrl") or article.get("url") or ""
    url = url if isinstance(url, str) and urlparse(url).scheme == "https" and urlparse(url).hostname == "mp.weixin.qq.com" else ""
    title = str(article.get("title") or "")[:300]
    # summary = str(article.get("summary") or article.get("content") or "")[:500]  # 2026-10-24：原将正文降格为摘要的映射留作对照。
    # 2026-10-24：本次修改原因：榜单 summary 与 content 分别对应摘要和正文。
    summary = str(article.get("summary") or "")[:500]
    content = article.get("content")
    # body_text = _article_text(content) if source == "growth" and isinstance(content, str) else ""  # 2026-10-24：原仅增长榜提取 content 的逻辑留作对照。
    # 2026-10-24：本次修改原因：10W+ 和原创榜文档明确 content 是正文，先清理再供用户核对。
    body_text = _article_text(content) if isinstance(content, str) else ""
    # 2026-10-23：本次修改原因：样本正文上限为 30000 字，增长榜内容截断时向界面显式说明。
    body_truncated = len(body_text) > 30000
    # body_text = body_text[:30000] if len(body_text) >= 200 else ""  # 2026-10-24：原 200 字门槛留作对照。
    # 2026-10-24：本次修改原因：入库正文最低 50 字，采集阶段保持相同标准。
    body_text = body_text[:30000] if len(body_text) >= 50 else ""
    return {
        "id": str(article.get("photoId") or article.get("workUuid") or url or f"{source}-{index}"),
        "title": title, "summary": summary,
        "author": str(article.get("userName") or account.get("userName") or article.get("author") or ""),
        "url": url, "published_at": str(article.get("publicTime") or article.get("publishTime") or ""),
        "read_count": article.get("clicksCount", article.get("readCount")),
        "like_count": article.get("likeCount"), "watch_count": article.get("watchCount"),
        "share_count": article.get("shareCount"), "comment_count": article.get("commentCount"),
        # 2026-10-24：本次修改原因：榜单若提供账号规模，随候选传给录入弹窗。
        # "account_followers": (article.get("fansCount") or article.get("followerCount") or account.get("fansCount") or account.get("followerCount")),  # 2026-10-24：原未读取文档 fans 字段的映射留作对照。
        # 2026-10-24：本次修改原因：公众号榜单粉丝数实际字段为 fans，空值保持为空。
        "account_followers": article.get("fans") if article.get("fans") is not None else account.get("fans"),
        "save_count": article.get("collectCount"), "reward_count": article.get("rewardCount"),
        "interactive_count": article.get("interactiveCount"),
        "source_data": _wechat_source_data(article, source, request or {}),
        "category": str(article.get("type") or ""), "growth_rate": account.get("growthRate"),
        "rank_position": account.get("rankPosition", article.get("orderNum")),
        "work_role": role, "body_text": body_text, "body_truncated": body_truncated,
        "body_status": "rank_content_unverified" if body_text else "detail_required",
    }


# 2026-10-23：本次修改原因：提供 10W+、原创爆款和阅读增长三种榜单采集入口，并保留各榜单不同的参数与返回形状。
# 2026-10-23：本次修改原因：发现页分页需要保留榜单完整结果，旧接口仍默认取前 20 条。
def get_wechat_rank(source: str, *, category: str | None = None, start_date: date | None = None,
                    end_date: date | None = None, rank_date: date | None = None,
                    limit: int | None = 20) -> dict:
    if source in {"ten_w", "original"}:
        if not category or not start_date or not end_date:
            raise RedFoxError("请选择榜单类目、开始日期和结束日期")
        if start_date >= end_date:
            raise RedFoxError("结束日期必须晚于开始日期")
        path = ("/story/api/cozeSkill/getTenWReadingRank" if source == "ten_w"
                else "/story/api/cozeSkill/getOriginalRank")
        source_name = ("公众号 10W+ 阅读文章推荐-SDK" if source == "ten_w"
                       else "公众号原创爆款文章推荐-SDK")
        # 2026-10-24：本次修改原因：保存与实际请求完全一致的榜单筛选条件。
        request = {"type": category, "startDate": start_date.isoformat(), "endDate": end_date.isoformat()}
        data = _rank_request("POST", path, request, source_name)
        field = "tenWReadingRank" if source == "ten_w" else "originalRank"
        if isinstance(data, list):
            rows = data
        else:
            rows = next((data[name] for name in (field, "list", "articles", "records")
                         if isinstance(data.get(name), list)), None)
        if rows is None:
            raise RedFoxError(f"RedFox 返回成功状态，但缺少 {field} 文章列表；请核对接口字段")
        # items = [_rank_candidate(row, source, index) for index, row in enumerate(rows[:20], 1)  # 2026-10-23：原固定截断暂留供对照。
        items = [_rank_candidate(row, source, index, request=request) for index, row in enumerate(rows[:limit], 1)
                 if isinstance(row, dict)]
        # 2026-10-23：本次修改原因：将部分损坏的榜单条目与真正的空榜单区分提示。
        if rows and not items:
            raise RedFoxError("RedFox 返回了榜单条目，但条目不是文章对象；请核对接口字段")
        # warnings = ([f"榜单前 20 条中有 {len(rows[:20]) - len(items)} 条格式异常，未显示。"] if len(items) < len(rows[:20]) else [])  # 2026-10-23：原固定 20 条提示暂留供对照。
        warnings = ([f"榜单中有 {len(rows[:limit]) - len(items)} 条格式异常，未显示。"]
                    if len(items) < len(rows[:limit]) else [])
        return {"source": source, "keyword": "", "category": category,
                "start_date": start_date.isoformat(), "end_date": end_date.isoformat(),
                "rank_date": None, "total_count": len(rows), "items": items, "warnings": warnings}
    if source == "growth":
        if not rank_date:
            raise RedFoxError("请选择阅读增长榜日期")
        data = _rank_request("GET", "/story/api/cozeSkill/getGzhCozeSkillDataRaise",
                             {"rankDate": rank_date.isoformat()}, "公众号阅读增长榜单-SDK")
        if isinstance(data, list):
            accounts = data
        else:
            accounts = next((data[name] for name in ("list", "items", "records")
                             if isinstance(data.get(name), list)), None)
        if accounts is None:
            raise RedFoxError("RedFox 返回成功状态，但缺少阅读增长榜账号列表；请核对接口字段")
        items = []
        seen = set()
        # 2026-10-23：本次修改原因：记录增长榜代表文章字段缺失，供界面显示部分返回提示。
        missing_works = 0
        for account in accounts:
            if not isinstance(account, dict):
                missing_works += 2
                continue
            for field, role in (("maxWork", "最高阅读文章"), ("minWork", "最低阅读文章")):
                article = account.get(field)
                if not isinstance(article, dict):
                    missing_works += 1
                    continue
                candidate = _rank_candidate(article, source, len(items) + 1, account=account, role=role)
                identity = candidate["url"] or candidate["id"]
                if identity in seen:
                    continue
                seen.add(identity)
                items.append(candidate)
                if len(items) >= 20:
                    break
            if len(items) >= 20:
                break
        if accounts and not items:
            raise RedFoxError("RedFox 返回了增长榜账号，但缺少 maxWork/minWork 文章内容；请核对接口字段")
        warnings = ([f"增长榜中有 {missing_works} 篇代表文章未返回，当前只展示已取得的文章。"]
                    if missing_works else [])
        return {"source": source, "keyword": "", "category": None,
                "start_date": None, "end_date": None, "rank_date": rank_date.isoformat(),
                "total_count": len(accounts), "items": items, "warnings": warnings}
    raise RedFoxError("不支持的公众号榜单类型")


def search_wechat_hot_articles(keyword: str) -> dict:
    # 2026-10-23：本次修改原因：首轮只查询近七天、最多十篇，不在搜索阶段拉取全文或写入样本库。
    end_date = date.today() - timedelta(days=1)
    start_date = end_date - timedelta(days=6)
    data = _post("/story/api/gzh/search/hotArticle", {
        "keyword": keyword,
        "startDate": start_date.isoformat(),
        "endDate": end_date.isoformat(),
    })
    articles = data.get("articles")
    if not isinstance(articles, list):
        raise RedFoxError("RedFox 搜索返回结构已变化：缺少 articles 列表")
    items = []
    for article in articles[:10]:
        if not isinstance(article, dict):
            continue
        url = article.get("url") or ""
        # if not isinstance(url, str) or urlparse(url).hostname != "mp.weixin.qq.com":  # 2026-10-23：原过滤条件暂留供对照。
        # 2026-10-23：本次修改原因：候选链接与详情接口统一要求 HTTPS 微信文章地址。
        if not isinstance(url, str) or urlparse(url).scheme != "https" or urlparse(url).hostname != "mp.weixin.qq.com":
            continue
        items.append({
            "id": str(article.get("id") or url),
            "title": str(article.get("title") or "未命名文章")[:300],
            "summary": str(article.get("summary") or "")[:500],
            "author": str(article.get("author") or ""),
            "url": url,
            "published_at": str(article.get("publicTime") or ""),
            "read_count": article.get("clicksCount"),
        })
    # return {"keyword": keyword, "start_date": start_date.isoformat(), "end_date": end_date.isoformat(), "items": items}  # 2026-10-23：原返回保留供对照。
    # 2026-10-23：本次修改原因：前端需区分热门发现库与可尝试详情的优质库。
    return {"keyword": keyword, "start_date": start_date.isoformat(),
            "end_date": end_date.isoformat(), "source": "hot", "items": items}


# 2026-10-23：本次修改原因：优先从与 queryArticleDetail 同属公众号优质库的搜索接口获取候选。
# 2026-10-23：本次修改原因：公众号关键词搜索按页传递偏移量，不再只返回首批十篇。
def search_wechat_quality_articles(keyword: str, *, offset: int = 0, limit: int = 10) -> dict:
    # data = _post("/story/api/gzhData/searchArticle", {"keyword": keyword, "offset": 0, "sortType": "_4"})  # 2026-10-23：原附加排序参数暂留供对照。
    # 2026-10-23：本次修改原因：先按官方 SDK 的最小参数调用，减少不同账户/版本的参数兼容风险。
    # data = _post("/story/api/gzhData/searchArticle", {"keyword": keyword, "offset": 0})  # 2026-10-23：原第一页固定偏移暂留供对照。
    # 2026-10-24：本次修改原因：关键词接口的偏移和关键字按文档提交，并保存本次查询条件。
    request = {"keyword": keyword, "offset": offset}
    data = _post("/story/api/gzhData/searchArticle", request)
    articles = data.get("list")
    if not isinstance(articles, list):
        articles = data.get("articles")
    if not isinstance(articles, list):
        raise RedFoxError("RedFox 优质库搜索返回结构已变化：缺少文章列表")
    items = []
    # for article in articles[:limit]:  # 2026-10-24：原十条截断留作对照。
    # 2026-10-24：本次修改原因：上游每次按 20 条取，页面再切成两个十条页。
    for index, article in enumerate(articles[:limit], 1):
        if not isinstance(article, dict):
            continue
        url = article.get("workUrl") or article.get("url") or ""
        # if not isinstance(url, str): continue  # 2026-10-24：原缺链接时直接丢弃候选的逻辑留作对照。
        # 2026-10-24：本次修改原因：链接缺失的文章仍可手工核对；不安全的链接不用于自动取文。
        parsed = urlparse(url) if isinstance(url, str) else None
        url = url if parsed and parsed.scheme == "https" and parsed.hostname == "mp.weixin.qq.com" else ""
        content = article.get("content")
        body = _article_text(content) if isinstance(content, str) else ""
        items.append({
            "id": str(article.get("workUuid") or article.get("id") or url or f"keyword-{offset}-{index}"),
            "title": str(article.get("title") or "未命名文章")[:300],
            "summary": str(article.get("summary") or article.get("description") or "")[:500],
            "author": str(article.get("author") or article.get("accountName") or ""),
            "url": url,
            "published_at": str(article.get("publishTime") or article.get("publicTime") or ""),
            "read_count": article.get("readCount", article.get("clicksCount")),
            # 2026-10-24：本次修改原因：关键词接口返回的互动项和正文全部进入统一候选对象。
            "like_count": article.get("likeCount"), "watch_count": article.get("watchCount"),
            "comment_count": article.get("commentCount"), "share_count": article.get("shareCount"),
            "save_count": article.get("collectCount"), "reward_count": article.get("rewardCount"),
            "interactive_count": article.get("interactiveCount"),
            "body_text": body[:30000] if len(body) >= 50 else "",
            "body_truncated": len(body) > 30000,
            "body_status": "rank_content_unverified" if len(body) >= 50 else "detail_required",
            "source_data": _wechat_source_data(article, "keyword", request),
        })
        # if len(items) >= 10:  # 2026-10-23：原首批固定十篇暂留供对照。
        if len(items) >= limit:
            break
    # return {"keyword": keyword, "start_date": None, "end_date": None, "source": "quality", "items": items,
    #         "has_more": len(articles) >= limit}  # 2026-10-24：原以本地截断数猜测下一页的逻辑留作对照。
    # 2026-10-24：本次修改原因：优先使用接口返回的 hasMore/total，避免十条视图与二十条上游分页混淆。
    total = data.get("total")
    return {"keyword": keyword, "start_date": None, "end_date": None,
            "source": "quality", "items": items,
            "total_count": total if isinstance(total, int) and total >= 0 else None,
            "has_more": bool(data["hasMore"]) if "hasMore" in data else len(articles) >= limit}


class _PlainText(HTMLParser):
    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.parts: list[str] = []
        # 2026-10-23：本次修改原因：过滤 HTML 中的脚本和样式，避免混入样本正文。
        self.skip_depth = 0

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        if tag in {"script", "style"}:
            self.skip_depth += 1
            return
        if self.skip_depth:
            return
        if tag in {"p", "div", "br", "li", "h1", "h2", "h3", "h4"}:
            self.parts.append("\n")

    def handle_endtag(self, tag: str) -> None:
        if tag in {"script", "style"} and self.skip_depth:
            self.skip_depth -= 1

    def handle_data(self, data: str) -> None:
        # self.parts.append(data)  # 2026-10-23：原实现保留供对照，现需跳过脚本和样式。
        if not self.skip_depth:
            self.parts.append(data)


def _article_text(value: str) -> str:
    parser = _PlainText()
    parser.feed(value)
    return re.sub(r"\n{3,}", "\n\n", "\n".join(
        line.strip() for line in "".join(parser.parts).splitlines() if line.strip()
    )).strip()


# 2026-10-23：本次修改原因：部分 RedFox 热门列表文章的详情接口返回 3501，尝试读取其公开文章页面作为正文来源。
class _WechatBody(HTMLParser):
    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.active = False
        self.depth = 0
        self.skip = 0
        self.parts: list[str] = []

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        if not self.active and any(key == "id" and value == "js_content" for key, value in attrs):
            self.active, self.depth = True, 1
            return
        if not self.active:
            return
        if tag in {"script", "style"}:
            self.skip += 1
        if not self.skip and tag in {"p", "div", "br", "li", "h1", "h2", "h3"}:
            self.parts.append("\n")
        if tag not in {"img", "br", "hr", "input", "meta", "link", "source", "wbr"}:
            self.depth += 1

    def handle_endtag(self, tag: str) -> None:
        if not self.active:
            return
        if tag in {"script", "style"} and self.skip:
            self.skip -= 1
        # self.depth -= 1  # 2026-10-23：原逻辑会在 br 等自闭合标签上错误减少正文容器深度，暂留供对照。
        # 2026-10-23：本次修改原因：只有真正闭合容器的标签才减少深度，避免过早停止读取正文。
        if tag not in {"img", "br", "hr", "input", "meta", "link", "source", "wbr"}:
            self.depth -= 1
        if self.depth <= 0:
            self.active = False

    def handle_data(self, data: str) -> None:
        if self.active and not self.skip:
            self.parts.append(data)


def _public_page_text(url: str) -> str:
    try:
        # 2026-10-23：本次修改原因：仅访问固定的微信文章域名，不跟随跳转，并限制正文下载体积。
        with httpx.Client(timeout=20.0, follow_redirects=False,
                          headers={"User-Agent": "Mozilla/5.0"}) as client:
            with client.stream("GET", url) as response:
                if response.status_code != 200:
                    return ""
                chunks = []
                total = 0
                for chunk in response.iter_bytes():
                    total += len(chunk)
                    if total > 2_000_000:
                        return ""
                    chunks.append(chunk)
                html = b"".join(chunks).decode("utf-8", errors="replace")
    except httpx.RequestError:
        return ""
    parser = _WechatBody()
    parser.feed(html)
    return re.sub(r"\n{3,}", "\n\n", "\n".join(
        line.strip() for line in "".join(parser.parts).splitlines() if line.strip()
    )).strip()


# def get_wechat_article(url: str) -> dict:  # 2026-10-23：原 RedFox 详情实现保留供对照。
# 2026-10-23：本次修改原因：已下架的 RedFox 详情流程保留为旧实现，不再用于页面取全文。
def _get_wechat_article_via_redfox(url: str) -> dict:
    parsed = urlparse(url)
    if parsed.scheme != "https" or parsed.hostname != "mp.weixin.qq.com":
        raise RedFoxError("仅支持 https://mp.weixin.qq.com 的公众号文章链接")
    # data = _post("/story/api/gzhData/queryArticleDetail", {"url": url})  # 2026-10-23：原直接调用保留供对照。
    # 2026-10-23：本次修改原因：RedFox 详情未覆盖的公开文章可从原文链接读取；不保存页面 HTML。
    try:
        data = _post("/story/api/gzhData/queryArticleDetail", {"url": url})
    except RedFoxError as error:
        if "code=3501" not in str(error):
            raise
        body = _public_page_text(url)
        if len(body) < 200:
            # raise RedFoxError("RedFox 未返回这篇文章的全文（3501），公开页面也无法读取，请换一篇文章") from error  # 2026-10-23：原提示暂留供对照。
            # 2026-10-23：本次修改原因：全文缺失时引导用户沿用候选标题和链接，仅补充正文。
            # raise RedFoxError("RedFox 未返回这篇文章的全文（3501），公开页面也无法读取；可打开原文复制正文后用样本库提炼") from error  # 2026-10-23：原提示暂留供对照。
            # 2026-10-23：本次修改原因：保留原始业务错误说明并引导手动补正文，避免把 3501 武断解释为未收录。
            raise RedFoxError(f"{error}；公开原文页也未取得足够正文，可打开原文复制正文后保存样本") from error
        return {"source_url": url, "title": "", "body_text": body[:30000],
                "truncated": len(body) > 30000, "body_available": True, "origin": "public_page"}
    # 2026-10-23：本次修改原因：详情接口字段可能随版本变化；只尝试已知正文字段，无法识别时供用户手动粘贴。
    candidates = [data]
    for key in ("article", "work", "detail"):
        if isinstance(data.get(key), dict):
            candidates.append(data[key])
    body = ""
    title = ""
    for item in candidates:
        title = title or str(item.get("title") or item.get("articleTitle") or "")
        for key in ("content", "articleContent", "contentHtml", "html", "body", "text", "bodyText"):
            value = item.get(key)
            if isinstance(value, str) and value.strip():
                body = _article_text(value)
                break
        if body:
            break
    # 2026-10-23：本次修改原因：详情成功但不包含可识别正文时，也尝试从同一篇公开原文读取。
    if len(body) < 200:
        public_body = _public_page_text(url)
        if len(public_body) >= 200:
            return {"source_url": url, "title": title[:300], "body_text": public_body[:30000],
                    "truncated": len(public_body) > 30000, "body_available": True, "origin": "public_page"}
    # return {"source_url": url, "title": title[:300], "body_text": body[:30000], "truncated": len(body) > 30000, "body_available": bool(body)}  # 2026-10-23：原返回暂留供对照。
    # 2026-10-23：本次修改原因：向分析链路标明正文的实际取得方式。
    return {"source_url": url, "title": title[:300], "body_text": body[:30000],
            "truncated": len(body) > 30000, "body_available": bool(body), "origin": "redfox"}


# 2026-10-23：本次修改原因：榜单继续使用 RedFox，按链接取全文改用 DeepSeek Fetch。
# def get_wechat_article(url: str) -> dict:  # 2026-10-23：原 DeepSeek Fetch 实现保留供对照。
# 2026-10-23：本次修改原因：保留此前的 DeepSeek 取文流程供问题排查，新入口改用浏览器。
def _get_wechat_article_via_deepseek(url: str) -> dict:
    from app.deepseek_fetch_service import DeepSeekFetchError, fetch_wechat_article

    try:
        return fetch_wechat_article(url)
    except DeepSeekFetchError as error:
        # 2026-10-23：本次修改原因：Fetch 被目标站点拦截时沿用公开页读取作为最后一次尝试。
        parsed = urlparse(url)
        if parsed.scheme != "https" or parsed.hostname != "mp.weixin.qq.com":
            raise RedFoxError(str(error)) from error
        body = _public_page_text(url)
        if len(body) >= 200:
            return {"source_url": url, "title": "", "body_text": body[:30000],
                    "truncated": len(body) > 30000, "body_available": True, "origin": "public_page"}
        raise RedFoxError(f"{error}；公开原文页也未取得足够正文，可手动粘贴原文") from error


# 2026-10-23：本次修改原因：当前公众号详情接口已下架，改为按需启动浏览器提取正文。
def get_wechat_article(url: str) -> dict:
    from app.wechat_browser_service import WechatBrowserError, fetch_wechat_article_browser

    try:
        return fetch_wechat_article_browser(url)
    except WechatBrowserError as error:
        # 2026-10-23：本次修改原因：浏览器未取得正文时再尝试原有公开页读取，保留人工补入入口。
        parsed = urlparse(url)
        if parsed.scheme != "https" or parsed.hostname != "mp.weixin.qq.com":
            raise RedFoxError(str(error)) from error
        body = _public_page_text(url)
        if len(body) >= 200:
            return {"source_url": url, "title": "", "body_text": body[:30000],
                    "truncated": len(body) > 30000, "body_available": True, "origin": "public_page"}
        raise RedFoxError(f"{error}；公开页面备用读取也未取得正文，可打开原文手动补入") from error
