# 2026-10-23：本次修改原因：为参考文章库提供真实分页、复核、指标快照、风格画像及策略衔接接口。
import json
from datetime import date, datetime, timezone
from typing import Literal
from uuid import uuid4

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel, Field, model_validator
# from sqlalchemy import func, or_, select  # 2026-10-24：原查询导入留作对照。
# 2026-10-24：本次修改原因：删除未被画像或策略引用的样本时，在同一事务清理其从属记录。
from sqlalchemy import delete, func, or_, select

from app.article_library_service import (
    FEATURE_VERSION, aggregate_features, content_hash, extract_features,
    representative_ids, semantic_profile,
)
from app.content_config import require_option
from app.db import (
    ArticleAnalysisRunModel, ArticleFeatureModel, ArticleMetadataModel, ArticleMetricModel,
    # 2026-10-24：本次修改原因：待收录候选草稿与正式样本分开持久化。
    CandidateDraftModel, ContentSampleModel, ContentStrategyModel, SessionLocal, StrategyProfileLinkModel,
    StyleProfileArticleModel, StyleProfileModel,
)
from app.strategy_service import create_draft, extract_guide


router = APIRouter(prefix="/library", tags=["article-library"])

# 2026-10-24：本次修改原因：待收录草稿允许正文和权限尚未补齐，但限制单篇草稿体积。
class CandidateDraftWrite(BaseModel):
    candidate_key: str = Field(min_length=1, max_length=1200)
    value: dict


# 2026-10-24：本次修改原因：候选的人工补录内容跨页及重开页面后仍可继续处理。
@router.get("/candidate-drafts")
def list_candidate_drafts() -> dict[str, dict]:
    with SessionLocal() as session:
        return {row.candidate_key: json.loads(row.value_json) for row in session.scalars(
            select(CandidateDraftModel).order_by(CandidateDraftModel.updated_at.desc())).all()}


@router.post("/candidate-drafts")
def save_candidate_draft(request: CandidateDraftWrite) -> dict:
    value_json = json.dumps(request.value, ensure_ascii=False)
    if len(value_json) > 150000:
        raise HTTPException(status_code=422, detail="待收录草稿过大")
    with SessionLocal() as session:
        row = session.get(CandidateDraftModel, request.candidate_key)
        if row is None:
            row = CandidateDraftModel(candidate_key=request.candidate_key, value_json=value_json,
                                      updated_at=datetime.now(timezone.utc))
            session.add(row)
        else:
            row.value_json = value_json
            row.updated_at = datetime.now(timezone.utc)
        session.commit()
    return {"candidate_key": request.candidate_key}


@router.delete("/candidate-drafts")
def delete_candidate_draft(candidate_key: str = Query(min_length=1, max_length=1200)) -> dict:
    with SessionLocal() as session:
        row = session.get(CandidateDraftModel, candidate_key)
        if row is not None:
            session.delete(row)
            session.commit()
    return {"candidate_key": candidate_key}


# 2026-10-23：本次修改原因：编辑文章时允许补齐来源与分类，同时用明确状态区分待核对和排除样本。
class ArticlePatch(BaseModel):
    title: str | None = Field(default=None, max_length=300)
    body_text: str | None = Field(default=None, max_length=30000)
    platform_id: str | None = None
    category_id: str | None = None
    format_id: str | None = None
    source_url: str | None = Field(default=None, max_length=1000)
    quality_score: int | None = Field(default=None, ge=1, le=5)
    rights_confirmed: bool | None = None
    author_id: str | None = Field(default=None, max_length=200)
    # 2026-10-23：本次修改原因：账号规模缺失时不自动划分高、中、低传播表现。
    account_followers: int | None = Field(default=None, ge=0)
    published_at: str | None = Field(default=None, pattern=r"^\d{4}-\d{2}-\d{2}$")
    audience_id: str | None = None
    topic: str | None = Field(default=None, max_length=200)
    tags: list[str] | None = Field(default=None, max_length=20)
    usage_rights_note: str | None = Field(default=None, max_length=2000)
    review_status: Literal["pending", "ready", "excluded"] | None = None


# 2026-10-23：本次修改原因：新文章及来源信息一次事务入库，避免先保存正文、后补元数据时留下半成品。
class ArticleCreate(BaseModel):
    title: str = Field(min_length=1, max_length=300)
    body_text: str = Field(min_length=50, max_length=30000)
    platform_id: str
    category_id: str
    format_id: str | None = None
    source_url: str | None = Field(default=None, max_length=1000)
    quality_score: int = Field(ge=1, le=5)
    rights_confirmed: bool
    author_id: str | None = Field(default=None, max_length=200)
    account_followers: int | None = Field(default=None, ge=0)
    published_at: str | None = Field(default=None, pattern=r"^\d{4}-\d{2}-\d{2}$")
    audience_id: str | None = None
    topic: str | None = Field(default=None, max_length=200)
    tags: list[str] = Field(default_factory=list, max_length=20)
    usage_rights_note: str | None = Field(default=None, max_length=2000)
    review_status: Literal["pending", "ready"] = "ready"
    # 2026-10-24：本次修改原因：把候选查询方式、请求参数和返回的来源字段随样本一起入库。
    source_data: dict = Field(default_factory=dict)
    # 2026-10-23：本次修改原因：候选已提供的真实互动读数与文章一次入库，缺失值保持为空。
    initial_metric: dict | None = None


# 2026-10-23：本次修改原因：缺失指标保持为空，读数必须注明时间与来源，派生比率只在分母存在时计算。
class MetricCreate(BaseModel):
    captured_at: datetime | None = None
    source: str = Field(min_length=1, max_length=100)
    impressions: int | None = Field(default=None, ge=0)
    clicks: int | None = Field(default=None, ge=0)
    reads: int | None = Field(default=None, ge=0)
    likes: int | None = Field(default=None, ge=0)
    # 2026-10-24：本次修改原因：公众号在看与其他互动项分开保存。
    watch_count: int | None = Field(default=None, ge=0)
    saves: int | None = Field(default=None, ge=0)
    # 2026-10-24：本次修改原因：分别记录打赏次数和榜单综合互动量。
    reward_count: int | None = Field(default=None, ge=0)
    interactive_count: int | None = Field(default=None, ge=0)
    comments: int | None = Field(default=None, ge=0)
    shares: int | None = Field(default=None, ge=0)
    # 2026-10-24：本次修改原因：近似读数保留原文，供样本复核时显示。
    raw_counts: dict[str, str] = Field(default_factory=dict)

    # 2026-10-23：本次修改原因：空快照或只有空白来源无法用于任何后续比较。
    @model_validator(mode="after")
    def nonempty_snapshot(self):
        if not self.source.strip():
            raise ValueError("请填写指标来源")
        if all(getattr(self, key) is None for key in (
                "impressions", "clicks", "reads", "likes", "watch_count", "saves", "reward_count",
                "interactive_count", "comments", "shares")) and not self.raw_counts:
            # raise ValueError("请至少填写一项真实指标")  # 2026-10-24：原仅精确值的提示留作对照。
            # 2026-10-24：本次修改原因：近似原始读数也可作为来源快照保存。
            raise ValueError("请至少填写一项来源读数")
        # 2026-10-24：本次修改原因：只接受已知来源读数，避免任意字段进入复核视图。
        allowed = {"followers", "reads", "likes", "watch_count", "saves", "reward_count",
                   "interactive_count", "comments", "shares"}
        if any(key not in allowed or not isinstance(value, str) or not value.strip() or len(value) > 40
               for key, value in self.raw_counts.items()):
            raise ValueError("原始指标字段无效")
        return self


class ProfileAnalyze(BaseModel):
    platform_id: str
    category_id: str
    format_id: str | None = None
    audience_id: str | None = None
    include_ai: bool = False


# 2026-10-23：本次修改原因：旧文章缺少关联元数据时以已确认权限的原状态兼容读取。
def metadata_for(session, sample: ContentSampleModel) -> ArticleMetadataModel:
    row = session.get(ArticleMetadataModel, sample.id)
    if row is not None:
        return row
    return ArticleMetadataModel(
        sample_id=sample.id, tags_json="[]", review_status="ready" if sample.rights_confirmed else "pending",
        content_hash=content_hash(sample.body_text), collected_at=sample.created_at,
    )


def article_read(session, sample: ContentSampleModel, detail: bool = False) -> dict:
    meta = metadata_for(session, sample)
    feature = session.get(ArticleFeatureModel, sample.id)
    current_hash = content_hash(sample.body_text)
    result = {
        "id": sample.id, "title": sample.title, "platform_id": sample.platform_id,
        "category_id": sample.category_id, "format_id": sample.format_id,
        "source_url": sample.source_url, "quality_score": sample.quality_score,
        "rights_confirmed": sample.rights_confirmed, "created_at": sample.created_at,
        "author_id": meta.author_id, "account_followers": meta.account_followers,
        # "source_data": json.loads(meta.source_data_json or "{}"),  # 2026-10-24：原列表也返回整份来源字段的方案留作对照。
        "published_at": meta.published_at,
        "audience_id": meta.audience_id, "topic": meta.topic,
        "tags": json.loads(meta.tags_json), "usage_rights_note": meta.usage_rights_note,
        "review_status": meta.review_status, "collected_at": meta.collected_at,
        "analysis_status": "current" if feature and feature.content_hash == current_hash else
                           "stale" if feature else "pending",
        "body_excerpt": sample.body_text[:140],
    }
    if detail:
        metrics = session.scalars(select(ArticleMetricModel).where(
            ArticleMetricModel.sample_id == sample.id
        ).order_by(ArticleMetricModel.captured_at.desc())).all()
        links = session.scalars(select(StyleProfileArticleModel).where(
            StyleProfileArticleModel.sample_id == sample.id
        )).all()
        strategies = session.scalars(select(ContentStrategyModel).where(
            ContentStrategyModel.status != "deleted"
        )).all()
        result.update({
            "body_text": sample.body_text,
            # 2026-10-24：本次修改原因：只在打开样本详情时返回完整来源字段，列表维持紧凑。
            "source_data": json.loads(meta.source_data_json or "{}"),
            "features": json.loads(feature.features_json) if feature else None,
            "feature_version": feature.algorithm_version if feature else None,
            "metrics": [metric_read(row) for row in metrics],
            # 2026-10-23：本次修改原因：仅在同类、同期且账号规模相近的指标快照足够时给出表现分组。
            "performance": performance_read(session, sample, meta, metrics),
            "profile_ids": [row.profile_id for row in links],
            "strategy_ids": [row.id for row in strategies if sample.id in json.loads(row.sample_ids_json)],
        })
    return result


def metric_read(row: ArticleMetricModel) -> dict:
    # data = {name: getattr(row, name) for name in (
    #     "impressions", "clicks", "reads", "likes", "saves", "comments", "shares")}  # 2026-10-24：原字段范围保留供对照。
    # 2026-10-24：本次修改原因：返回公众号在看和近似读数，精确值仍单独用于比率计算。
    data = {name: getattr(row, name) for name in (
        "impressions", "clicks", "reads", "likes", "watch_count", "saves", "reward_count",
        "interactive_count", "comments", "shares")}
    return {"id": row.id, "captured_at": row.captured_at, "source": row.source, **data,
            "raw_counts": json.loads(row.raw_counts_json or "{}"),
            "ctr": round(row.clicks / row.impressions, 4) if row.clicks is not None and row.impressions else None,
            "save_rate": round(row.saves / row.reads, 4) if row.saves is not None and row.reads else None,
            "comment_rate": round(row.comments / row.reads, 4) if row.comments is not None and row.reads else None}


# 2026-10-23：本次修改原因：传播表现分组需要相同分母和观察窗口；条件不足时清楚说明原因。
def performance_read(session, sample: ContentSampleModel, meta: ArticleMetadataModel,
                     metrics: list[ArticleMetricModel]) -> dict:
    unavailable = lambda reason: {"band": None, "reason": reason, "metric": None, "percentile": None,
                                  "peer_count": 0}
    if meta.review_status != "ready" or not sample.rights_confirmed:
        return unavailable("文章仍待核对或已排除")
    if not meta.published_at or not meta.account_followers:
        return unavailable("需填写发布时间和账号粉丝数，才能寻找可比文章")
    try:
        published = date.fromisoformat(meta.published_at)
    except ValueError:
        return unavailable("发布时间格式无效")
    def in_window(row: ArticleMetricModel, published_on: date) -> bool:
        return 7 <= (row.captured_at.date() - published_on).days <= 30
    latest = next((item for item in metrics if in_window(item, published)), None)
    if latest is None:
        return unavailable("缺少发布后第 7–30 天的指标快照")
    if latest.impressions and latest.clicks is not None:
        metric_name, target = "点击率（点击/曝光）", latest.clicks / latest.impressions
    elif latest.reads and latest.saves is not None:
        metric_name, target = "收藏率（收藏/阅读）", latest.saves / latest.reads
    else:
        return unavailable("快照缺少可比较的点击率或收藏率分母")
    peers = session.scalars(select(ContentSampleModel).where(
        ContentSampleModel.id != sample.id,
        ContentSampleModel.platform_id == sample.platform_id,
        ContentSampleModel.category_id == sample.category_id,
        ContentSampleModel.format_id == sample.format_id,
        ContentSampleModel.rights_confirmed.is_(True),
    )).all()
    values = []
    for peer in peers:
        peer_meta = metadata_for(session, peer)
        if (peer_meta.review_status != "ready" or not peer_meta.published_at or
                not peer_meta.account_followers or
                not .5 * meta.account_followers <= peer_meta.account_followers <= 2 * meta.account_followers):
            continue
        try:
            peer_date = date.fromisoformat(peer_meta.published_at)
        except ValueError:
            continue
        if abs((peer_date - published).days) > 90:
            continue
        snapshots = session.scalars(select(ArticleMetricModel).where(
            ArticleMetricModel.sample_id == peer.id
        ).order_by(ArticleMetricModel.captured_at.desc())).all()
        peer_metric = next((item for item in snapshots if in_window(item, peer_date)), None)
        if peer_metric is None:
            continue
        if metric_name.startswith("点击") and peer_metric.impressions and peer_metric.clicks is not None:
            values.append(peer_metric.clicks / peer_metric.impressions)
        elif metric_name.startswith("收藏") and peer_metric.reads and peer_metric.saves is not None:
            values.append(peer_metric.saves / peer_metric.reads)
    if len(values) < 10:
        return {**unavailable("同平台、类目、体裁、近 90 天及相近账号规模的可比文章不足 10 篇"),
                "peer_count": len(values), "metric": metric_name}
    percentile = (sum(value < target for value in values) + .5 * sum(value == target for value in values)) / len(values)
    band = "高表现" if percentile >= .7 else "低表现" if percentile < .3 else "中等表现"
    return {"band": band, "reason": "比较同平台、类目、体裁、近 90 天及相近账号规模的发布后第 7–30 天快照；不代表未来传播概率",
            "metric": metric_name, "value": round(target, 4), "percentile": round(percentile, 3),
            "peer_count": len(values)}


# 2026-10-23：本次修改原因：列表按传播表现筛选时一次载入可比元数据，避免逐篇重复查询全部样本。
def performance_bands(session) -> dict[str, str]:
    samples = session.scalars(select(ContentSampleModel).where(
        ContentSampleModel.rights_confirmed.is_(True))).all()
    metadata = {row.sample_id: row for row in session.scalars(select(ArticleMetadataModel)).all()}
    snapshots: dict[str, list[ArticleMetricModel]] = {}
    for row in session.scalars(select(ArticleMetricModel).order_by(
            ArticleMetricModel.captured_at.desc())).all():
        snapshots.setdefault(row.sample_id, []).append(row)
    available = []
    for sample in samples:
        meta = metadata.get(sample.id)
        if meta is None or meta.review_status != "ready" or not meta.published_at or not meta.account_followers:
            continue
        try:
            published = date.fromisoformat(meta.published_at)
        except ValueError:
            continue
        metric = next((item for item in snapshots.get(sample.id, [])
                       if 7 <= (item.captured_at.date() - published).days <= 30), None)
        if metric is None:
            continue
        if metric.impressions and metric.clicks is not None:
            name, value = "ctr", metric.clicks / metric.impressions
        elif metric.reads and metric.saves is not None:
            name, value = "save_rate", metric.saves / metric.reads
        else:
            continue
        available.append((sample, meta, published, name, value))
    bands = {}
    for sample, meta, published, name, value in available:
        peers = [other_value for other, other_meta, other_date, other_name, other_value in available
                 if other.id != sample.id and other.platform_id == sample.platform_id and
                 other.category_id == sample.category_id and other.format_id == sample.format_id and
                 other_name == name and abs((other_date - published).days) <= 90 and
                 .5 * meta.account_followers <= other_meta.account_followers <= 2 * meta.account_followers]
        if len(peers) < 10:
            continue
        percentile = (sum(peer < value for peer in peers) + .5 * sum(peer == value for peer in peers)) / len(peers)
        bands[sample.id] = "high" if percentile >= .7 else "low" if percentile < .3 else "middle"
    return bands


# 2026-10-23：本次修改原因：概况按数据库全集统计，避免前端只拿到前一百篇时误报文章总量。
@router.get("/summary")
def library_summary(platform_id: str | None = None) -> dict:
    with SessionLocal() as session:
        statement = select(ContentSampleModel)
        if platform_id:
            statement = statement.where(ContentSampleModel.platform_id == platform_id)
        samples = session.scalars(statement).all()
        status = [metadata_for(session, row).review_status for row in samples]
        analyzed = sum(bool((feature := session.get(ArticleFeatureModel, row.id)) and
                            feature.content_hash == content_hash(row.body_text)) for row in samples)
        profile_query = select(func.count()).select_from(StyleProfileModel)
        if platform_id:
            profile_query = profile_query.where(StyleProfileModel.platform_id == platform_id)
        return {"total": len(samples), "pending": status.count("pending"),
                "ready": status.count("ready"), "excluded": status.count("excluded"),
                "analyzed": analyzed, "profiles": session.scalar(profile_query) or 0}


# 2026-10-23：本次修改原因：服务端完成搜索筛选和分页，样本超过一百篇后仍可完整浏览。
@router.get("/articles")
def list_articles(page: int = Query(default=1, ge=1), page_size: int = Query(default=20, ge=1, le=50),
                  q: str = "", platform_id: str | None = None, category_id: str | None = None,
                  format_id: str | None = None, audience_id: str | None = None,
                  review_status: str | None = None, analysis_status: str | None = None,
                  performance_band: str | None = None) -> dict:
    conditions = []
    if platform_id:
        conditions.append(ContentSampleModel.platform_id == platform_id)
    if category_id:
        conditions.append(ContentSampleModel.category_id == category_id)
    if format_id:
        conditions.append(ContentSampleModel.format_id == format_id)
    if audience_id:
        conditions.append(ArticleMetadataModel.audience_id == audience_id)
    if review_status == "ready":
        conditions.append(or_(ArticleMetadataModel.review_status == "ready",
                              (ArticleMetadataModel.sample_id.is_(None) & ContentSampleModel.rights_confirmed.is_(True))))
    elif review_status == "pending":
        conditions.append(or_(ArticleMetadataModel.review_status == "pending",
                              (ArticleMetadataModel.sample_id.is_(None) & ContentSampleModel.rights_confirmed.is_(False))))
    elif review_status == "excluded":
        conditions.append(ArticleMetadataModel.review_status == "excluded")
    # 2026-10-23：本次修改原因：分析状态在服务端筛选，分页总数和列表状态保持一致。
    if analysis_status == "pending":
        conditions.append(ArticleFeatureModel.sample_id.is_(None))
    elif analysis_status == "current":
        conditions.append(ArticleFeatureModel.sample_id.is_not(None))
        conditions.append(or_(ArticleMetadataModel.sample_id.is_(None),
                              ArticleFeatureModel.content_hash == ArticleMetadataModel.content_hash))
    elif analysis_status == "stale":
        conditions.append(ArticleFeatureModel.sample_id.is_not(None))
        conditions.append(ArticleMetadataModel.sample_id.is_not(None))
        conditions.append(ArticleFeatureModel.content_hash != ArticleMetadataModel.content_hash)
    if q.strip():
        term = f"%{q.strip()}%"
        conditions.append(or_(ContentSampleModel.title.ilike(term),
                              ContentSampleModel.body_text.ilike(term),
                              ContentSampleModel.source_url.ilike(term),
                              ArticleMetadataModel.author_id.ilike(term)))
    with SessionLocal() as session:
        base = select(ContentSampleModel).outerjoin(ArticleMetadataModel,
                                                   ArticleMetadataModel.sample_id == ContentSampleModel.id).outerjoin(
            ArticleFeatureModel, ArticleFeatureModel.sample_id == ContentSampleModel.id)
        count_query = select(func.count()).select_from(ContentSampleModel).outerjoin(
            ArticleMetadataModel, ArticleMetadataModel.sample_id == ContentSampleModel.id).outerjoin(
            ArticleFeatureModel, ArticleFeatureModel.sample_id == ContentSampleModel.id)
        # 2026-10-23：本次修改原因：表现分组是相对计算结果，先完成同类比较再分页，计数不会误报。
        if performance_band in ("high", "middle", "low"):
            bands = performance_bands(session)
            matched = session.scalars(base.where(*conditions).order_by(
                ContentSampleModel.created_at.desc(), ContentSampleModel.id.desc())).all()
            matching_rows = [row for row in matched if bands.get(row.id) == performance_band]
            total = len(matching_rows)
            rows = matching_rows[(page - 1) * page_size:page * page_size]
        else:
            total = session.scalar(count_query.where(*conditions)) or 0
            rows = session.scalars(base.where(*conditions).order_by(
                ContentSampleModel.created_at.desc(), ContentSampleModel.id.desc()
            ).offset((page - 1) * page_size).limit(page_size)).all()
        return {"items": [article_read(session, row) for row in rows],
                "total": total, "page": page, "page_size": page_size}


# 2026-10-23：本次修改原因：采集候选与人工粘贴共用严格查重和权限校验，来源及分类同时保存。
@router.post("/articles", status_code=201)
def create_article(request: ArticleCreate) -> dict:
    if not request.rights_confirmed:
        raise HTTPException(status_code=422, detail="请先确认拥有该正文的存储、分析与使用权限")
    title, body = request.title.strip(), request.body_text.strip()
    if not title or len(body) < 50:
        raise HTTPException(status_code=422, detail="标题不能为空，正文至少 50 字")
    source_url = request.source_url.strip() if request.source_url else None
    if source_url and not source_url.startswith(("http://", "https://")):
        raise HTTPException(status_code=422, detail="来源链接应以 http:// 或 https:// 开头")
    if request.published_at:
        try:
            date.fromisoformat(request.published_at)
        except ValueError as error:
            raise HTTPException(status_code=422, detail="发布时间无效") from error
    # 2026-10-24：本次修改原因：来源字段可追溯，同时限制单篇原始元数据体积。
    source_data_json = json.dumps(request.source_data, ensure_ascii=False)
    if len(source_data_json) > 100000:
        raise HTTPException(status_code=422, detail="来源元数据过大")
    with SessionLocal() as session:
        for kind, option_id in (("platform", request.platform_id), ("category", request.category_id),
                                ("format", request.format_id), ("audience", request.audience_id)):
            if option_id:
                try:
                    require_option(session, option_id, kind)
                except ValueError as error:
                    raise HTTPException(status_code=422, detail=str(error)) from error
        if source_url and session.scalar(select(ContentSampleModel.id).where(
            ContentSampleModel.source_url == source_url)):
            raise HTTPException(status_code=409, detail="该来源链接已录入")
        digest = content_hash(body)
        if any(content_hash(row.body_text) == digest for row in session.scalars(select(ContentSampleModel)).all()):
            raise HTTPException(status_code=409, detail="相同正文已录入文章库")
        row = ContentSampleModel(id=str(uuid4()), title=title, body_text=body,
                                 platform_id=request.platform_id, category_id=request.category_id,
                                 format_id=request.format_id, source_url=source_url,
                                 quality_score=request.quality_score, rights_confirmed=True)
        session.add(row)
        session.flush()
        session.add(ArticleMetadataModel(
            sample_id=row.id, author_id=request.author_id.strip() if request.author_id else None,
            account_followers=request.account_followers, published_at=request.published_at,
            audience_id=request.audience_id, topic=request.topic.strip() if request.topic else None,
            tags_json=json.dumps([tag.strip() for tag in request.tags if tag.strip()], ensure_ascii=False),
            usage_rights_note=request.usage_rights_note.strip() if request.usage_rights_note else None,
            source_data_json=source_data_json,
            review_status=request.review_status, content_hash=digest, collected_at=row.created_at,
        ))
        # 2026-10-23：本次修改原因：保存候选快照时按指标模型逐项校验，不把显示文本当成精确读数。
        if request.initial_metric:
            try:
                initial = MetricCreate.model_validate(request.initial_metric)
            except Exception as error:
                raise HTTPException(status_code=422, detail=f"候选指标格式无效：{error}") from error
            session.add(ArticleMetricModel(
                id=str(uuid4()), sample_id=row.id,
                captured_at=initial.captured_at or datetime.now(timezone.utc),
                source=initial.source.strip(),
                # 2026-10-24：本次修改原因：原始展示值单独序列化，不与整数指标列混写。
                raw_counts_json=json.dumps(initial.raw_counts, ensure_ascii=False),
                **initial.model_dump(exclude={"captured_at", "source", "raw_counts"}),
            ))
        session.commit()
        return article_read(session, row, detail=True)


@router.get("/articles/{sample_id}")
def get_article(sample_id: str) -> dict:
    with SessionLocal() as session:
        row = session.get(ContentSampleModel, sample_id)
        if row is None:
            raise HTTPException(status_code=404, detail="文章不存在")
        return article_read(session, row, detail=True)


# 2026-10-24：本次修改原因：样本管理提供真实删除操作，同时使相关画像与策略失效。
@router.delete("/articles/{sample_id}", status_code=204)
def delete_article(sample_id: str) -> None:
    with SessionLocal() as session:
        row = session.get(ContentSampleModel, sample_id)
        if row is None:
            raise HTTPException(status_code=404, detail="文章不存在或已删除")
        # if session.scalar(select(StyleProfileArticleModel.profile_id).where(StyleProfileArticleModel.sample_id == sample_id).limit(1)): raise HTTPException(status_code=409, detail="文章已被风格画像引用，请改为将复核状态设为“已排除”")  # 2026-10-24：原引用阻止删除规则留作对照。
        # if any(sample_id in json.loads(strategy.sample_ids_json or "[]") for strategy in session.scalars(select(ContentStrategyModel)).all()): raise HTTPException(status_code=409, detail="文章已被内容策略引用，请改为将复核状态设为“已排除”")  # 2026-10-24：原策略引用阻止删除规则留作对照。
        # 2026-10-24：本次修改原因：用户删除样本优先；画像保留历史统计但记录被删除的来源并禁止再次用于策略。
        links = session.scalars(select(StyleProfileArticleModel).where(
            StyleProfileArticleModel.sample_id == sample_id)).all()
        affected_profiles = {link.profile_id for link in links}
        for profile_id in affected_profiles:
            profile = session.get(StyleProfileModel, profile_id)
            if profile is None:
                continue
            profile_data = json.loads(profile.profile_json)
            deleted_ids = set(profile_data.get("deleted_sample_ids", []))
            deleted_ids.add(sample_id)
            profile_data["deleted_sample_ids"] = sorted(deleted_ids)
            profile.profile_json = json.dumps(profile_data, ensure_ascii=False)
        # 2026-10-24：本次修改原因：依赖已删除样本或失效画像的策略立即停用，生成页只选已发布策略。
        linked_strategy_ids = set(session.scalars(select(StrategyProfileLinkModel.strategy_id).where(
            StrategyProfileLinkModel.profile_id.in_(affected_profiles))).all()) if affected_profiles else set()
        for strategy in session.scalars(select(ContentStrategyModel)).all():
            if (sample_id in json.loads(strategy.sample_ids_json or "[]") or
                    strategy.id in linked_strategy_ids) and strategy.status in {"draft", "published"}:
                strategy.status = "archived"
        session.execute(delete(StyleProfileArticleModel).where(StyleProfileArticleModel.sample_id == sample_id))
        session.execute(delete(ArticleMetricModel).where(ArticleMetricModel.sample_id == sample_id))
        session.execute(delete(ArticleFeatureModel).where(ArticleFeatureModel.sample_id == sample_id))
        session.execute(delete(ArticleMetadataModel).where(ArticleMetadataModel.sample_id == sample_id))
        session.delete(row)
        session.commit()


# 2026-10-23：本次修改原因：文章修改后保留旧分析快照并标记过期，重新分析时不必重新采集来源。
@router.patch("/articles/{sample_id}")
def update_article(sample_id: str, request: ArticlePatch) -> dict:
    fields = request.model_dump(exclude_unset=True)
    with SessionLocal() as session:
        row = session.get(ContentSampleModel, sample_id)
        if row is None:
            raise HTTPException(status_code=404, detail="文章不存在")
        meta = session.get(ArticleMetadataModel, sample_id)
        if meta is None:
            meta = metadata_for(session, row)
            session.add(meta)
        for field in ("title", "body_text", "platform_id", "category_id", "format_id",
                      "source_url", "quality_score", "rights_confirmed"):
            if field in fields:
                setattr(row, field, fields[field])
        # 2026-10-23：本次修改原因：必填字段不接受显式空值，链接在查重前统一去除首尾空格。
        if not row.platform_id or not row.category_id or row.quality_score is None or row.rights_confirmed is None:
            raise HTTPException(status_code=422, detail="平台、类目、质量和权限状态不能为空")
        row.title = row.title.strip() if row.title else row.title
        row.body_text = row.body_text.strip() if row.body_text else row.body_text
        row.source_url = row.source_url.strip() if row.source_url else None
        if not row.title or not row.title.strip() or not row.body_text or len(row.body_text.strip()) < 50:
            raise HTTPException(status_code=422, detail="标题不能为空，正文至少 50 字")
        if row.source_url and not row.source_url.startswith(("https://", "http://")):
            raise HTTPException(status_code=422, detail="来源链接应以 http:// 或 https:// 开头")
        for kind, option_id in (("platform", row.platform_id), ("category", row.category_id),
                                ("format", row.format_id), ("audience", fields.get("audience_id", meta.audience_id))):
            if option_id:
                try:
                    require_option(session, option_id, kind, active=False)
                except ValueError as error:
                    raise HTTPException(status_code=422, detail=str(error)) from error
        digest = content_hash(row.body_text)
        duplicate_url = session.scalar(select(ContentSampleModel.id).where(
            ContentSampleModel.source_url == row.source_url, ContentSampleModel.id != sample_id
        )) if row.source_url else None
        duplicate_hash = session.scalar(select(ArticleMetadataModel.sample_id).where(
            ArticleMetadataModel.content_hash == digest, ArticleMetadataModel.sample_id != sample_id
        ))
        # 2026-10-23：本次修改原因：旧文章可能尚未建立元数据，仍参与正文查重。
        if not duplicate_hash:
            old_rows = session.scalars(select(ContentSampleModel).outerjoin(
                ArticleMetadataModel, ArticleMetadataModel.sample_id == ContentSampleModel.id
            ).where(ArticleMetadataModel.sample_id.is_(None), ContentSampleModel.id != sample_id)).all()
            duplicate_hash = next((item.id for item in old_rows if content_hash(item.body_text) == digest), None)
        if duplicate_url or duplicate_hash:
            raise HTTPException(status_code=409, detail="来源链接或正文已存在于文章库")
        meta.content_hash = digest
        for field in ("author_id", "account_followers", "published_at", "audience_id", "topic", "usage_rights_note", "review_status"):
            if field in fields:
                setattr(meta, field, fields[field])
        if "tags" in fields:
            meta.tags_json = json.dumps([tag.strip() for tag in (fields["tags"] or []) if tag.strip()], ensure_ascii=False)
        if meta.review_status not in ("pending", "ready", "excluded"):
            raise HTTPException(status_code=422, detail="复核状态无效")
        if meta.review_status == "ready" and not row.rights_confirmed:
            raise HTTPException(status_code=422, detail="确认使用权限后才能标记为可分析")
        session.commit()
        return article_read(session, row, detail=True)


# 2026-10-23：本次修改原因：指标以新增快照写入，不覆盖任何一次采集的原始读数。
@router.post("/articles/{sample_id}/metrics", status_code=201)
def add_metric(sample_id: str, request: MetricCreate) -> dict:
    with SessionLocal() as session:
        if session.get(ContentSampleModel, sample_id) is None:
            raise HTTPException(status_code=404, detail="文章不存在")
        row = ArticleMetricModel(id=str(uuid4()), sample_id=sample_id,
                                 captured_at=request.captured_at or datetime.now(timezone.utc),
                                 source=request.source.strip(),
                                 # 2026-10-24：本次修改原因：人工补录也沿用同一指标结构。
                                 raw_counts_json=json.dumps(request.raw_counts, ensure_ascii=False),
                                 **request.model_dump(exclude={"captured_at", "source", "raw_counts"}))
        session.add(row)
        session.commit()
        return metric_read(row)


# 2026-10-23：本次修改原因：风格画像保留样本集和方法版本，模型语义分析仅作可选补充。
@router.post("/profiles/analyze", status_code=201)
def analyze_profile(request: ProfileAnalyze) -> dict:
    with SessionLocal() as session:
        for kind, option_id in (("platform", request.platform_id), ("category", request.category_id),
                                ("format", request.format_id), ("audience", request.audience_id)):
            if option_id:
                try:
                    require_option(session, option_id, kind)
                except ValueError as error:
                    raise HTTPException(status_code=422, detail=str(error)) from error
        statement = select(ContentSampleModel).outerjoin(
            ArticleMetadataModel, ArticleMetadataModel.sample_id == ContentSampleModel.id
        ).where(ContentSampleModel.platform_id == request.platform_id,
                ContentSampleModel.category_id == request.category_id,
                ContentSampleModel.rights_confirmed.is_(True),
                ContentSampleModel.quality_score >= 4,
                or_(ArticleMetadataModel.review_status == "ready", ArticleMetadataModel.sample_id.is_(None)))
        if request.format_id:
            statement = statement.where(ContentSampleModel.format_id == request.format_id)
        if request.audience_id:
            statement = statement.where(ArticleMetadataModel.audience_id == request.audience_id)
        samples = session.scalars(statement.order_by(ContentSampleModel.created_at.desc()).limit(501)).all()
        if not samples:
            raise HTTPException(status_code=422, detail="当前范围没有已核对、评分至少 4 分的文章")
        if len(samples) > 500:
            raise HTTPException(status_code=422, detail="当前范围超过 500 篇，请进一步细分后分析")
        now = datetime.now(timezone.utc)
        run = ArticleAnalysisRunModel(id=str(uuid4()), scope_json=request.model_dump_json(),
                                      status="running", method=FEATURE_VERSION, created_at=now)
        session.add(run)
        session.commit()
        try:
            feature_rows = [extract_features(row) for row in samples]
            aggregates = aggregate_features(feature_rows)
            authors = {row.id: metadata_for(session, row).author_id for row in samples}
            selected = representative_ids(samples, feature_rows, aggregates, authors)
            semantic, model_name = ({}, None)
            if request.include_ai:
                sample_by_id = {row.id: row for row in samples}
                semantic, model_name = semantic_profile(session, [sample_by_id[key] for key in selected], aggregates)
            scope_query = select(StyleProfileModel).where(
                StyleProfileModel.platform_id == request.platform_id,
                StyleProfileModel.category_id == request.category_id,
                StyleProfileModel.format_id == request.format_id,
                StyleProfileModel.audience_id == request.audience_id,
            )
            versions = session.scalars(scope_query).all()
            profile = StyleProfileModel(
                id=str(uuid4()), platform_id=request.platform_id, category_id=request.category_id,
                format_id=request.format_id, audience_id=request.audience_id,
                version=max((item.version for item in versions), default=0) + 1,
                sample_count=len(samples),
                profile_json=json.dumps({"statistics": aggregates, "semantic": semantic,
                                         "representative_ids": selected,
                                         "confidence_note": ("样本较少，仅供初步观察" if len(samples) < 30 else
                                                             "需结合人工审核与同类样本验证") +
                                                            ("；包含多种体裁，建议细分后再形成写作策略" if request.format_id is None else "")},
                                        ensure_ascii=False),
                method=FEATURE_VERSION + ("+llm" if request.include_ai else ""),
                model_name=model_name, run_id=run.id, created_at=datetime.now(timezone.utc),
            )
            session.add(profile)
            for sample, features in zip(samples, feature_rows):
                digest = content_hash(sample.body_text)
                existing = session.get(ArticleFeatureModel, sample.id)
                if existing is None:
                    existing = ArticleFeatureModel(sample_id=sample.id, algorithm_version=FEATURE_VERSION,
                                                   content_hash=digest, features_json=json.dumps(features, ensure_ascii=False),
                                                   analyzed_at=now)
                    session.add(existing)
                else:
                    existing.algorithm_version = FEATURE_VERSION
                    existing.content_hash = digest
                    existing.features_json = json.dumps(features, ensure_ascii=False)
                    existing.analyzed_at = now
                session.add(StyleProfileArticleModel(profile_id=profile.id, sample_id=sample.id,
                                                     content_hash=digest))
            run.status = "completed"
            run.completed_at = datetime.now(timezone.utc)
            session.commit()
            return profile_read(session, profile, detail=True)
        except Exception as error:
            session.rollback()
            failed = session.get(ArticleAnalysisRunModel, run.id)
            failed.status = "failed"
            failed.error = str(error)[:2000]
            failed.completed_at = datetime.now(timezone.utc)
            session.commit()
            raise HTTPException(status_code=502, detail=f"画像分析失败：{error}") from error


# 2026-10-23：本次修改原因：画像来源的正文、权限和分层范围都必须与创建时一致。
def profile_source_current(session, profile: StyleProfileModel, link: StyleProfileArticleModel) -> bool:
    sample = session.get(ContentSampleModel, link.sample_id)
    if sample is None or content_hash(sample.body_text) != link.content_hash:
        return False
    meta = metadata_for(session, sample)
    return bool(sample.rights_confirmed and sample.quality_score >= 4 and meta.review_status == "ready" and
                sample.platform_id == profile.platform_id and sample.category_id == profile.category_id and
                (profile.format_id is None or sample.format_id == profile.format_id) and
                (profile.audience_id is None or meta.audience_id == profile.audience_id))


def profile_read(session, row: StyleProfileModel, detail: bool = False) -> dict:
    # 2026-10-24：本次修改原因：历史画像保留统计值，已删除的代表文章不再提供无效跳转。
    profile_data = json.loads(row.profile_json)
    deleted_ids = set(profile_data.get("deleted_sample_ids", []))
    profile_data["representative_ids"] = [sample_id for sample_id in profile_data.get("representative_ids", [])
                                          if sample_id not in deleted_ids]
    result = {"id": row.id, "platform_id": row.platform_id, "category_id": row.category_id,
              "format_id": row.format_id, "audience_id": row.audience_id,
              "version": row.version, "sample_count": row.sample_count,
              # "profile": json.loads(row.profile_json), "method": row.method,  # 2026-10-24：原未过滤已删除代表文章的响应留作对照。
              "profile": profile_data, "method": row.method,
              "model_name": row.model_name, "created_at": row.created_at}
    if detail:
        links = session.scalars(select(StyleProfileArticleModel).where(
            StyleProfileArticleModel.profile_id == row.id)).all()
        result["sample_ids"] = [link.sample_id for link in links]
        # 2026-10-23：本次修改原因：画像详情指出哪些来源文章已变化，提醒重新分析再用于策略。
        # result["stale_sample_count"] = sum(not profile_source_current(session, row, link) for link in links)  # 2026-10-24：原未计入已删除来源的逻辑留作对照。
        # 2026-10-24：本次修改原因：删除的来源计入失效数，前端据此禁止从旧画像创建策略。
        result["stale_sample_count"] = len(deleted_ids) + sum(not profile_source_current(session, row, link)
                                                               for link in links)
        strategy_links = session.scalars(select(StrategyProfileLinkModel).where(
            StrategyProfileLinkModel.profile_id == row.id)).all()
        result["strategy_ids"] = [link.strategy_id for link in strategy_links]
    return result


# 2026-10-23：本次修改原因：分析失败和重分析的运行记录可查询，便于定位模型或样本问题。
@router.get("/analysis-runs")
def list_analysis_runs(limit: int = Query(default=10, ge=1, le=50)) -> list[dict]:
    with SessionLocal() as session:
        rows = session.scalars(select(ArticleAnalysisRunModel).order_by(
            ArticleAnalysisRunModel.created_at.desc()).limit(limit)).all()
        return [{"id": row.id, "scope": json.loads(row.scope_json), "status": row.status,
                 "method": row.method, "error": row.error, "created_at": row.created_at,
                 "completed_at": row.completed_at} for row in rows]


@router.get("/profiles")
def list_profiles(platform_id: str | None = None) -> list[dict]:
    with SessionLocal() as session:
        statement = select(StyleProfileModel)
        if platform_id:
            statement = statement.where(StyleProfileModel.platform_id == platform_id)
        rows = session.scalars(statement.order_by(StyleProfileModel.created_at.desc())).all()
        return [profile_read(session, row) for row in rows]


@router.get("/profiles/{profile_id}")
def get_profile(profile_id: str) -> dict:
    with SessionLocal() as session:
        row = session.get(StyleProfileModel, profile_id)
        if row is None:
            raise HTTPException(status_code=404, detail="风格画像不存在")
        return profile_read(session, row, detail=True)


# 2026-10-23：本次修改原因：策略草稿同时引用画像版本和代表文章，发布审核继续由内容策略页负责。
@router.post("/profiles/{profile_id}/strategy-draft", status_code=201)
def create_profile_strategy(profile_id: str) -> dict:
    with SessionLocal() as session:
        profile = session.get(StyleProfileModel, profile_id)
        if profile is None:
            raise HTTPException(status_code=404, detail="风格画像不存在")
        data = json.loads(profile.profile_json)
        # 2026-10-24：本次修改原因：来源文章被删除后旧画像只供查看，不能再生成新策略。
        if data.get("deleted_sample_ids"):
            raise HTTPException(status_code=409, detail="画像包含已删除的来源文章，请重新分析后创建策略")
        ids = data.get("representative_ids", [])[:6]
        samples = [session.get(ContentSampleModel, key) for key in ids]
        if not samples or any(row is None for row in samples):
            raise HTTPException(status_code=409, detail="画像的代表文章已不可用")
        # 2026-10-23：本次修改原因：画像建立后若代表文章变更、权限撤回或被排除，须重分析后再提炼策略。
        links = {link.sample_id: link for link in session.scalars(select(StyleProfileArticleModel).where(
            StyleProfileArticleModel.profile_id == profile.id)).all()}
        if any(not profile_source_current(session, profile, link) for link in links.values()) or any(
                sample.id not in links for sample in samples):
            raise HTTPException(status_code=409, detail="画像来源文章已变更或不再可用，请重新分析后创建策略")
        try:
            platform = require_option(session, profile.platform_id, "platform").label
            category = require_option(session, profile.category_id, "category").label
            content_format = require_option(session, profile.format_id, "format").label if profile.format_id else "通用"
            guide = extract_guide(session, samples, platform, category, content_format,
                                  profile_summary=data)
        except ValueError as error:
            raise HTTPException(status_code=422, detail=str(error)) from error
        except Exception as error:
            raise HTTPException(status_code=502, detail=f"策略草稿创建失败：{type(error).__name__}") from error
        draft = create_draft(session, f"{platform} · {category} · {content_format} · 画像 V{profile.version}",
                             profile.platform_id, profile.category_id, profile.format_id, guide, ids)
        session.add(StrategyProfileLinkModel(strategy_id=draft.id, profile_id=profile.id))
        session.commit()
        return {"strategy_id": draft.id, "profile_id": profile.id, "version": draft.version}
