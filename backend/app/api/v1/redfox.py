# 2026-10-23：本次修改原因：提供仅供人工验证使用的公众号搜索与按需详情接口。
from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel, Field
# 2026-10-23：本次修改原因：榜单接口按实际日期类型校验查询参数。
from datetime import date

from app.redfox_service import (
    RedFoxError, get_wechat_article, key_configured, search_wechat_hot_articles,
)
# 2026-10-23：本次修改原因：将公众号优质库搜索作为全文分析入口，热门库保留为选题发现。
from app.redfox_service import search_wechat_quality_articles
# 2026-10-23：本次修改原因：将三种公众号榜单纳入样本库候选采集接口。
from app.redfox_service import get_wechat_rank
# 2026-10-23：本次修改原因：单击候选后自动提炼待审核策略，并记录文章来源。
from uuid import uuid4

from app.api.v1.content import StrategyRead, strategy_labels, strategy_read
from app.db import ContentSampleModel, ContentStrategyReferenceModel, SessionLocal
from app.strategy_service import create_draft, extract_guide


router = APIRouter(prefix="/redfox", tags=["redfox-pilot"])


class ArticleRequest(BaseModel):
    url: str = Field(min_length=25, max_length=1000)


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
