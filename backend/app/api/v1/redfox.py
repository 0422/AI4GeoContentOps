# 2026-10-23：本次修改原因：提供仅供人工验证使用的公众号搜索与按需详情接口。
# 2026-10-24：本次修改原因：候选无链接时从已保存来源字段读取稳定身份。
import json
from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel, Field
# 2026-10-23：本次修改原因：榜单接口按实际日期类型校验查询参数。
from datetime import date, datetime

# 2026-10-23：本次修改原因：六个平台的发现查询使用统一入口和明确的参数校验。
from app.redfox_discovery_service import discover, get_candidate_detail

from app.redfox_service import (
    RedFoxError, get_wechat_article, key_configured, search_wechat_hot_articles,
)
# 2026-10-23：本次修改原因：将公众号优质库搜索作为全文分析入口，热门库保留为选题发现。
from app.redfox_service import search_wechat_quality_articles
# 2026-10-23：本次修改原因：将三种公众号榜单纳入样本库候选采集接口。
from app.redfox_service import get_wechat_rank
# 2026-10-23：本次修改原因：单击候选后自动提炼待审核策略，并记录文章来源。
from uuid import uuid4
from sqlalchemy import select

from app.api.v1.content import StrategyRead, strategy_labels, strategy_read
# from app.db import ContentSampleModel, ContentStrategyReferenceModel, SessionLocal  # 2026-10-24：原导入留作对照。
# 2026-10-24：本次修改原因：发现页同时用来源链接与候选身份识别已入库文章。
from app.db import ArticleMetadataModel, ContentSampleModel, ContentStrategyReferenceModel, SessionLocal
from app.strategy_service import create_draft, extract_guide


router = APIRouter(prefix="/redfox", tags=["redfox-pilot"])


# 2026-10-23：本次修改原因：采集方式决定关键词、类目和日期是否必填，拒绝不会被接口使用的组合。
@router.get("/discover")
def discover_candidates(platform: str, method: str, keyword: str | None = None,
                        category: str | None = None, start_date: str | None = None,
                        end_date: str | None = None, rank_date: date | None = None,
                        hotspot_platform: int | None = None,
                        page: int = Query(default=1, ge=1)) -> dict:
    methods = {
        "wechat": {"ten_w", "original", "keyword"},
        "xiaohongshu": {"dark_horse", "daily", "weekly"},
        "baijiahao": {"keyword"}, "toutiao": {"keyword"},
        "multi": {"top10", "keyword", "hotspot"},
        "zhihu": {"keyword", "hotspot"},
    }
    if method not in methods.get(platform, set()):
        raise HTTPException(status_code=422, detail="目标平台与采集方式不匹配")
    if method == "keyword" and len((keyword or "").strip()) < 2:
        raise HTTPException(status_code=422, detail="请至少输入两个关键词字符")
    if (platform == "wechat" and method in {"ten_w", "original"}) or platform == "xiaohongshu":
        if not category:
            raise HTTPException(status_code=422, detail="请选择榜单类目")
    if platform == "xiaohongshu" and not rank_date:
        raise HTTPException(status_code=422, detail="请选择榜单日期")
    needs_range = ((platform == "wechat" and method != "keyword") or platform == "multi"
                   or (platform == "zhihu" and method == "hotspot"))
    if needs_range:
        if not start_date or not end_date:
            raise HTTPException(status_code=422, detail="请选择开始和结束时间")
        try:
            if platform == "multi" and method == "top10":
                first = datetime.strptime(start_date, "%Y-%m-%d %H:%M:%S")
                last = datetime.strptime(end_date, "%Y-%m-%d %H:%M:%S")
            else:
                first = date.fromisoformat(start_date)
                last = date.fromisoformat(end_date)
        except ValueError as error:
            raise HTTPException(status_code=422, detail="日期格式不正确") from error
        if first > last or (platform == "wechat" and first == last):
            raise HTTPException(status_code=422, detail="结束时间必须晚于开始时间")
        if platform == "multi" and method == "keyword" and (last - first).days > 30:
            raise HTTPException(status_code=422, detail="关键词查询范围最多 30 天")
    if platform == "multi" and method == "hotspot" and hotspot_platform not in {1, 2, 5, 6, 7, 8, 9, 10}:
        raise HTTPException(status_code=422, detail="请选择热点平台")
    try:
        # return discover(platform=platform, method=method, keyword=(keyword or "").strip(), category=category, start_date=start_date, end_date=end_date, rank_date=rank_date, hotspot_platform=hotspot_platform, page=page)  # 2026-10-23：原未标记已入库文章的返回逻辑暂留供对照。
        # 2026-10-23：本次修改原因：重进发现页仍能按来源链接识别已收录文章，避免重复入库。
        result = discover(platform=platform, method=method, keyword=(keyword or "").strip(),
                          category=category, start_date=start_date, end_date=end_date,
                          rank_date=rank_date, hotspot_platform=hotspot_platform, page=page)
        urls = [item.get("url") for item in result["items"] if item.get("url")]
        # if urls: ... item["collected"] = item.get("url") in existing  # 2026-10-24：原仅按链接判断的逻辑留作对照。
        # 2026-10-24：本次修改原因：缺原文链接或链接变化时，仍能依据入库时记录的候选身份标记已收录。
        with SessionLocal() as session:
            existing = set(session.scalars(select(ContentSampleModel.source_url).where(
                ContentSampleModel.source_url.in_(urls))).all()) if urls else set()
            source_rows = session.scalars(select(ArticleMetadataModel.source_data_json)).all()
        saved_keys = set()
        for raw in source_rows:
            try:
                source_data = json.loads(raw or "{}")
            except (TypeError, ValueError):
                continue
            if isinstance(source_data, dict) and isinstance(source_data.get("candidate_key"), str):
                saved_keys.add(source_data["candidate_key"])
        for item in result["items"]:
            item["collected"] = bool((item.get("url") and item["url"] in existing) or
                                     f"{item.get('platform') or platform}:{item.get('id')}" in saved_keys)
        return result
    except RedFoxError as error:
        raise HTTPException(status_code=502, detail=str(error)) from error


class ArticleRequest(BaseModel):
    url: str = Field(min_length=25, max_length=1000)


# 2026-10-23：本次修改原因：仅为用户点选的跨平台候选按需取正文，避免列表查询时批量调用详情。
class CandidateDetailRequest(BaseModel):
    platform: str
    work_id: str = Field(min_length=1, max_length=300)
    url: str | None = Field(default=None, max_length=1000)


@router.post("/discover/detail")
def discovery_detail(request: CandidateDetailRequest) -> dict:
    try:
        return get_candidate_detail(request.platform, request.work_id, request.url)
    except RedFoxError as error:
        raise HTTPException(status_code=502, detail=str(error)) from error


# 2026-10-23：本次修改原因：允许从单篇候选直接创建策略草稿，类目与形式由编辑在搜索区选择。
class AnalyzeRequest(ArticleRequest):
    title: str = Field(min_length=1, max_length=300)
    category_id: str
    format_id: str | None = None


@router.get("/status")
def status() -> dict[str, bool]:
    return {"configured": key_configured()}


@router.get("/wechat/search")
# def search_wechat(keyword: str = Query(min_length=2, max_length=80)) -> dict:  # 2026-10-23：原仅热门库入口暂留供对照。
# 2026-10-23：本次修改原因：允许选择优质库或热门库，默认优质库以提高全文可用概率。
def search_wechat(keyword: str = Query(min_length=2, max_length=80),
                  source: str = Query(default="quality", pattern="^(quality|hot)$")) -> dict:
    # 2026-10-23：本次修改原因：空白搜索词不应触发按次计费的外部请求。
    if len(keyword.strip()) < 2:
        raise HTTPException(status_code=422, detail="请至少输入两个非空白字符")
    try:
        # return search_wechat_hot_articles(keyword.strip())  # 2026-10-23：原固定热门库搜索暂留供对照。
        # 2026-10-23：本次修改原因：优质库搜索与详情接口属于同一数据集；热门库仅供发现候选。
        return (search_wechat_quality_articles(keyword.strip()) if source == "quality"
                else search_wechat_hot_articles(keyword.strip()))
    except RedFoxError as error:
        raise HTTPException(status_code=502, detail=str(error)) from error


@router.post("/wechat/article")
def article(request: ArticleRequest) -> dict:
    try:
        return get_wechat_article(request.url)
    except RedFoxError as error:
        raise HTTPException(status_code=502, detail=str(error)) from error


# 2026-10-23：本次修改原因：榜单与关键词搜索使用不同参数，独立入口避免误将关键词设为榜单必填项。
@router.get("/wechat/rank")
def wechat_rank(source: str = Query(pattern="^(ten_w|original|growth)$"),
                category: str | None = Query(default=None, max_length=30),
                start_date: date | None = None, end_date: date | None = None,
                rank_date: date | None = None) -> dict:
    if source == "growth" and category:
        raise HTTPException(status_code=422, detail="阅读增长榜接口没有类目参数，请只选择榜单日期")
    if source in {"ten_w", "original"} and (not category or not start_date or not end_date):
        raise HTTPException(status_code=422, detail="请选择榜单类目、开始日期和结束日期")
    if source == "growth" and not rank_date:
        raise HTTPException(status_code=422, detail="请选择阅读增长榜日期")
    try:
        return get_wechat_rank(source, category=category, start_date=start_date,
                               end_date=end_date, rank_date=rank_date)
    except RedFoxError as error:
        raise HTTPException(status_code=502, detail=str(error)) from error


# @router.post("/wechat/analyze", response_model=StrategyRead, status_code=201)  # 2026-10-23：旧分析入口暂留供对照，职责已移入 /strategies/analyze-candidate。
def analyze_article(request: AnalyzeRequest) -> StrategyRead:
    with SessionLocal() as session:
        try:
            platform, category, content_format = strategy_labels(
                session, "platform_01", request.category_id, request.format_id
            )
        except ValueError as error:
            raise HTTPException(status_code=422, detail=str(error)) from error
        try:
            detail = get_wechat_article(request.url)
        except RedFoxError as error:
            raise HTTPException(status_code=502, detail=str(error)) from error
        body = detail["body_text"]
        if len(body) < 200:
            raise HTTPException(status_code=422, detail="这篇文章正文不足 200 字，无法可靠提炼写法")
        # 2026-10-23：本次修改原因：抽取首、中、尾段供模型观察结构，原文只在本次请求中使用。
        middle = max(0, len(body) // 2 - 250)
        excerpt = body[:750] + "\n[中段]\n" + body[middle:middle + 500] + "\n[结尾]\n" + body[-450:]
        sample = ContentSampleModel(
            id=str(uuid4()), title=request.title.strip(), body_text=excerpt,
            platform_id="platform_01", category_id=request.category_id,
            format_id=request.format_id, source_url=request.url,
            quality_score=4, rights_confirmed=False,
        )
        try:
            guide = extract_guide(session, [sample], platform, category, content_format)
        except ValueError as error:
            raise HTTPException(status_code=422, detail=str(error)) from error
        except Exception as error:
            raise HTTPException(status_code=502, detail=f"策略提炼失败：{type(error).__name__}") from error
        row = create_draft(
            session, f"{platform} · {category} · {content_format} · 单篇参考",
            "platform_01", request.category_id, request.format_id, guide, [],
        )
        session.add(ContentStrategyReferenceModel(
            id=str(uuid4()), strategy_id=row.id, title=request.title.strip(),
            source_url=request.url, provider=detail["origin"],
        ))
        session.commit()
        return strategy_read(row)
