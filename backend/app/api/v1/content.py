# 2026-10-23：本次修改原因：让多页面工作台共享选项、授权样本和人工发布的内容策略。
import json
from datetime import datetime
from typing import Literal
from uuid import uuid4

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel, Field
# from sqlalchemy import select  # 2026-10-23：原导入保留供对照。
# 2026-10-23：本次修改原因：重新提炼草稿时清除已不适用的候选文章引用。
# from sqlalchemy import delete, select  # 2026-10-23：原导入保留供对照。
# 2026-10-23：本次修改原因：旧样本接口排除待核对文章，并供策略页读取完整的试用样本组。
from sqlalchemy import delete, or_, select

from app.content_config import OPTION_KINDS, require_option
from app.db import ContentOptionModel, ContentSampleModel, ContentStrategyModel, SessionLocal
# 2026-10-23：本次修改原因：策略列表展示自动分析的原文来源。
from app.db import ContentStrategyReferenceModel
# 2026-10-23：本次修改原因：新入库样本同步记录正文指纹和复核状态，旧接口继续可用。
from app.article_library_service import content_hash
from app.db import ArticleMetadataModel, StrategyProfileLinkModel, StyleProfileArticleModel, StyleProfileModel
from app.strategy_service import StrategyGuide, create_draft, extract_guide, match_strategy
# 2026-10-23：本次修改原因：候选文章的写法分析归内容策略模块负责，RedFox 服务只负责获取正文。
from app.redfox_service import RedFoxError, get_wechat_article


router = APIRouter(tags=["content-workspace"])


class OptionRead(BaseModel):
    id: str
    kind: str
    label: str
    active: bool
    position: int


class OptionCreate(BaseModel):
    kind: Literal["category", "audience", "format", "platform"]
    label: str = Field(min_length=1, max_length=100)


class OptionPatch(BaseModel):
    label: str | None = Field(default=None, min_length=1, max_length=100)
    active: bool | None = None


def option_read(row: ContentOptionModel) -> OptionRead:
    return OptionRead(id=row.id, kind=row.kind, label=row.label, active=row.active, position=row.position)


@router.get("/options", response_model=list[OptionRead])
def list_options(include_inactive: bool = False) -> list[OptionRead]:
    with SessionLocal() as session:
        rows = session.scalars(select(ContentOptionModel).order_by(
            ContentOptionModel.kind, ContentOptionModel.position
        )).all()
        return [option_read(row) for row in rows if include_inactive or row.active]


@router.post("/options", response_model=OptionRead, status_code=201)
def create_option(request: OptionCreate) -> OptionRead:
    label = request.label.strip()
    if not label:
        raise HTTPException(status_code=422, detail="名称不能为空")
    with SessionLocal() as session:
        rows = session.scalars(select(ContentOptionModel).where(ContentOptionModel.kind == request.kind)).all()
        if any(row.label.casefold() == label.casefold() for row in rows):
            raise HTTPException(status_code=409, detail="同组中已有这个名称，可重新启用已停用项")
        row = ContentOptionModel(
            id=str(uuid4()), kind=request.kind, label=label,
            position=max((item.position for item in rows), default=0) + 1, active=True,
        )
        session.add(row)
        session.commit()
        return option_read(row)


@router.patch("/options/{option_id}", response_model=OptionRead)
def update_option(option_id: str, request: OptionPatch) -> OptionRead:
    with SessionLocal() as session:
        row = session.get(ContentOptionModel, option_id)
        if row is None:
            raise HTTPException(status_code=404, detail="选项不存在")
        if row.kind not in OPTION_KINDS:
            raise HTTPException(status_code=422, detail="选项类型无效")
        if request.label is not None:
            label = request.label.strip()
            if not label:
                raise HTTPException(status_code=422, detail="名称不能为空")
            siblings = session.scalars(select(ContentOptionModel).where(
                ContentOptionModel.kind == row.kind, ContentOptionModel.id != row.id
            )).all()
            if any(item.label.casefold() == label.casefold() for item in siblings):
                raise HTTPException(status_code=409, detail="同组中已有这个名称")
            row.label = label
        if request.active is not None:
            if not request.active and row.active:
                remaining = session.scalars(select(ContentOptionModel).where(
                    ContentOptionModel.kind == row.kind,
                    ContentOptionModel.active.is_(True),
                    ContentOptionModel.id != row.id,
                )).all()
                if not remaining:
                    raise HTTPException(status_code=409, detail="每组至少保留一个可用选项")
            row.active = request.active
        session.commit()
        return option_read(row)


@router.delete("/options/{option_id}", response_model=OptionRead)
def disable_option(option_id: str) -> OptionRead:
    return update_option(option_id, OptionPatch(active=False))


class SampleCreate(BaseModel):
    title: str = Field(min_length=1, max_length=300)
    body_text: str = Field(min_length=50, max_length=30000)
    platform_id: str
    category_id: str
    format_id: str | None = None
    source_url: str | None = Field(default=None, max_length=1000)
    quality_score: int = Field(ge=1, le=5)
    rights_confirmed: bool


class SampleRead(SampleCreate):
    id: str
    created_at: datetime


def sample_read(row: ContentSampleModel) -> SampleRead:
    return SampleRead(
        id=row.id, title=row.title, body_text=row.body_text, platform_id=row.platform_id,
        category_id=row.category_id, format_id=row.format_id, source_url=row.source_url,
        quality_score=row.quality_score, rights_confirmed=row.rights_confirmed, created_at=row.created_at,
    )


@router.get("/samples", response_model=list[SampleRead])
# def list_samples(limit: int = Query(default=100, ge=1, le=200)) -> list[SampleRead]:  # 2026-10-23：旧上限保留供对照。
# 2026-10-23：本次修改原因：策略选样可覆盖首阶段 100–300 篇，并跳过待核对或已排除文章。
def list_samples(limit: int = Query(default=500, ge=1, le=1000)) -> list[SampleRead]:
    with SessionLocal() as session:
        # rows = session.scalars(select(ContentSampleModel).order_by(ContentSampleModel.created_at.desc()).limit(limit)).all()  # 2026-10-23：原查询保留供对照。
        # 2026-10-23：本次修改原因：复核状态与使用权限同步决定旧策略页可见的参考文章。
        rows = session.scalars(select(ContentSampleModel).outerjoin(
            ArticleMetadataModel, ArticleMetadataModel.sample_id == ContentSampleModel.id
        ).where(ContentSampleModel.rights_confirmed.is_(True),
                or_(ArticleMetadataModel.review_status == "ready", ArticleMetadataModel.sample_id.is_(None)))
            .order_by(ContentSampleModel.created_at.desc()).limit(limit)).all()
        return [sample_read(row) for row in rows]


@router.post("/samples", response_model=SampleRead, status_code=201)
def create_sample(request: SampleCreate) -> SampleRead:
    if not request.rights_confirmed:
        raise HTTPException(status_code=422, detail="请先确认拥有该样本的使用权限")
    title, body = request.title.strip(), request.body_text.strip()
    if not title or len(body) < 50:
        raise HTTPException(status_code=422, detail="请填写标题和不少于 50 字的样本正文")
    with SessionLocal() as session:
        for kind, option_id in (
            ("platform", request.platform_id), ("category", request.category_id),
        ):
            try:
                require_option(session, option_id, kind)
            except ValueError as error:
                raise HTTPException(status_code=422, detail=str(error)) from error
        if request.format_id:
            try:
                require_option(session, request.format_id, "format")
            except ValueError as error:
                raise HTTPException(status_code=422, detail=str(error)) from error
        source_url = request.source_url.strip() if request.source_url else None
        if source_url:
            if not source_url.startswith(("https://", "http://")):
                raise HTTPException(status_code=422, detail="来源链接应以 http:// 或 https:// 开头")
            if session.scalar(select(ContentSampleModel.id).where(ContentSampleModel.source_url == source_url)):
                raise HTTPException(status_code=409, detail="该来源链接已录入")
        # 2026-10-23：本次修改原因：正文换行差异不应绕过查重，已有旧记录也参与检查。
        digest = content_hash(body)
        if any(content_hash(item.body_text) == digest for item in session.scalars(select(ContentSampleModel)).all()):
            raise HTTPException(status_code=409, detail="相同正文已录入文章库")
        row = ContentSampleModel(
            id=str(uuid4()), title=title, body_text=body,
            platform_id=request.platform_id, category_id=request.category_id,
            format_id=request.format_id, source_url=source_url,
            quality_score=request.quality_score, rights_confirmed=True,
        )
        session.add(row)
        # 2026-10-23：本次修改原因：先生成原文章的数据库默认采集时间，再复制到关联元数据。
        session.flush()
        # 2026-10-23：本次修改原因：手动保存的文章先以已核对状态进入统一文章库。
        session.add(ArticleMetadataModel(sample_id=row.id, tags_json="[]", review_status="ready",
                                         content_hash=digest, collected_at=row.created_at))
        session.commit()
        session.refresh(row)
        return sample_read(row)


class StrategyCreate(BaseModel):
    title: str = Field(min_length=1, max_length=200)
    platform_id: str
    category_id: str | None = None
    format_id: str | None = None
    guide: StrategyGuide


class StrategyExtract(BaseModel):
    platform_id: str
    category_id: str | None = None
    format_id: str | None = None
    # 2026-10-23：本次修改原因：允许编辑明确选择一至六篇样本，单篇也能生成待审核策略。
    sample_ids: list[str] | None = Field(default=None, min_length=1, max_length=6)


# 2026-10-23：本次修改原因：调整草稿参考样本后，可在同一策略版本重新提炼。
class StrategyRegenerate(BaseModel):
    sample_ids: list[str] = Field(min_length=1, max_length=6)


# 2026-10-23：本次修改原因：样本库可将候选链接交给策略页，由策略页按需获取全文并创建待审核草稿。
class StrategyCandidateAnalyze(BaseModel):
    url: str = Field(min_length=25, max_length=1000)
    title: str = Field(min_length=1, max_length=300)
    category_id: str
    format_id: str | None = None


class StrategyPatch(BaseModel):
    title: str | None = Field(default=None, min_length=1, max_length=200)
    guide: StrategyGuide | None = None


class StrategyRead(StrategyCreate):
    id: str
    status: str
    version: int
    sample_ids: list[str]
    created_at: datetime
    # 2026-10-23：本次修改原因：自动提炼策略保留来源文章标题与链接，不持久化第三方正文。
    references: list[dict[str, str]] = Field(default_factory=list)
    # 2026-10-23：本次修改原因：从画像生成的策略可回溯其画像版本。
    profile_id: str | None = None
    profile_audience_id: str | None = None


def strategy_read(row: ContentStrategyModel) -> StrategyRead:
    # 2026-10-23：本次修改原因：在现有策略响应中附带可追溯的 RedFox 参考文章。
    with SessionLocal() as source_session:
        refs = source_session.scalars(select(ContentStrategyReferenceModel).where(
            ContentStrategyReferenceModel.strategy_id == row.id
        )).all()
        # 2026-10-23：本次修改原因：返回策略所依据的画像，供审核者打开来源。
        profile_link = source_session.get(StrategyProfileLinkModel, row.id)
        profile = source_session.get(StyleProfileModel, profile_link.profile_id) if profile_link else None
    return StrategyRead(
        id=row.id, title=row.title, platform_id=row.platform_id,
        category_id=row.category_id, format_id=row.format_id,
        guide=StrategyGuide.model_validate_json(row.guide_json),
        sample_ids=json.loads(row.sample_ids_json), status=row.status,
        version=row.version, created_at=row.created_at,
        references=[{"title": ref.title, "source_url": ref.source_url,
                     "provider": ref.provider} for ref in refs],
        profile_id=profile_link.profile_id if profile_link else None,
        profile_audience_id=profile.audience_id if profile else None,
    )


def strategy_labels(session, platform_id: str, category_id: str | None, format_id: str | None):
    platform = require_option(session, platform_id, "platform")
    category = require_option(session, category_id, "category") if category_id else None
    content_format = require_option(session, format_id, "format") if format_id else None
    return platform.label, category.label if category else "通用", content_format.label if content_format else "通用"


@router.get("/strategies", response_model=list[StrategyRead])
def list_strategies() -> list[StrategyRead]:
    with SessionLocal() as session:
        # rows = session.scalars(select(ContentStrategyModel).order_by(ContentStrategyModel.created_at.desc()).limit(100)).all()  # 2026-10-23：原列表查询保留供对照。
        # 2026-10-23：本次修改原因：删除的版本从列表隐藏，数据库保留版本号和历史任务依据。
        rows = session.scalars(select(ContentStrategyModel).where(
            ContentStrategyModel.status != "deleted"
        ).order_by(ContentStrategyModel.created_at.desc()).limit(100)).all()
        return [strategy_read(row) for row in rows]


@router.get("/strategies/match", response_model=StrategyRead | None)
def read_matching_strategy(
    platform_id: str, category_id: str | None = None, format_id: str | None = None,
    # 2026-10-23：本次修改原因：策略预览与创建任务采用相同的受众筛选规则。
    audience_id: str | None = None,
) -> StrategyRead | None:
    with SessionLocal() as session:
        # row = match_strategy(session, platform_id, category_id, format_id)  # 2026-10-23：原匹配调用保留供对照。
        row = match_strategy(session, platform_id, category_id, format_id, audience_id)
        return strategy_read(row) if row else None


@router.post("/strategies", response_model=StrategyRead, status_code=201)
def create_strategy(request: StrategyCreate) -> StrategyRead:
    # 2026-10-23：本次修改原因：避免保存无法识别的空白策略名称。
    if not request.title.strip():
        raise HTTPException(status_code=422, detail="策略名称不能为空")
    with SessionLocal() as session:
        try:
            strategy_labels(session, request.platform_id, request.category_id, request.format_id)
        except ValueError as error:
            raise HTTPException(status_code=422, detail=str(error)) from error
        row = create_draft(
            session, request.title.strip(), request.platform_id, request.category_id,
            request.format_id, request.guide, [],
        )
        return strategy_read(row)


@router.post("/strategies/extract", response_model=StrategyRead, status_code=201)
def extract_strategy(request: StrategyExtract) -> StrategyRead:
    with SessionLocal() as session:
        try:
            platform, category, content_format = strategy_labels(
                session, request.platform_id, request.category_id, request.format_id
            )
        except ValueError as error:
            raise HTTPException(status_code=422, detail=str(error)) from error
        # rows = session.scalars(select(ContentSampleModel).where(ContentSampleModel.platform_id == request.platform_id, ContentSampleModel.rights_confirmed.is_(True), ContentSampleModel.quality_score >= 4).order_by(ContentSampleModel.quality_score.desc(), ContentSampleModel.created_at.desc())).all()  # 2026-10-23：原自动选样逻辑暂留供对照。
        # samples = [row for row in rows if (request.category_id is None or row.category_id == request.category_id) and (request.format_id is None or row.format_id in (None, request.format_id))][:6]  # 2026-10-23：原范围筛选暂留供对照。
        # if len(samples) < 2: raise HTTPException(status_code=422, detail="至少录入两篇匹配、评分不低于 4 分且已确认使用权的样本")  # 2026-10-23：原两篇门槛暂留供对照。
        # 2026-10-23：本次修改原因：按用户勾选的样本提炼，并在后端核对存在性、权限、评分及范围。
        if not request.sample_ids:
            # raise HTTPException(status_code=422, detail="请先从样本库中选择 1–6 篇样本")  # 2026-10-23：原跨模块提示暂留供对照。
            # 2026-10-23：本次修改原因：选样和提炼均发生在策略页，错误提示指向实际操作位置。
            raise HTTPException(status_code=422, detail="请在内容策略页选择 1–6 篇样本")
        if len(set(request.sample_ids)) != len(request.sample_ids):
            raise HTTPException(status_code=422, detail="所选样本不能重复")
        rows = session.scalars(select(ContentSampleModel).where(
            ContentSampleModel.id.in_(request.sample_ids)
        )).all()
        by_id = {row.id: row for row in rows}
        if len(by_id) != len(request.sample_ids):
            raise HTTPException(status_code=422, detail="部分所选样本不存在，请刷新样本列表")
        samples = [by_id[sample_id] for sample_id in request.sample_ids]
        for sample in samples:
            # 2026-10-23：本次修改原因：已排除或待核对文章不可通过旧策略接口继续参与提炼。
            metadata = session.get(ArticleMetadataModel, sample.id)
            if metadata and metadata.review_status != "ready":
                raise HTTPException(status_code=422, detail="所选样本尚未核对或已排除")
            if not sample.rights_confirmed or sample.quality_score < 4:
                raise HTTPException(status_code=422, detail="只能选择已确认使用权且评分不低于 4 分的样本")
            if sample.platform_id != request.platform_id:
                raise HTTPException(status_code=422, detail="所选样本必须属于当前目标平台")
            if request.category_id and sample.category_id != request.category_id:
                raise HTTPException(status_code=422, detail="所选样本与策略内容类目不一致")
            if request.format_id and sample.format_id not in (None, request.format_id):
                raise HTTPException(status_code=422, detail="所选样本与策略内容形式不一致")
        try:
            guide = extract_guide(session, samples, platform, category, content_format)
        except ValueError as error:
            raise HTTPException(status_code=422, detail=str(error)) from error
        except Exception as error:
            raise HTTPException(status_code=502, detail=f"策略提炼失败：{type(error).__name__}") from error
        row = create_draft(
            session, f"{platform} · {category} · {content_format}", request.platform_id,
            request.category_id, request.format_id, guide, [sample.id for sample in samples],
        )
        return strategy_read(row)


# 2026-10-23：本次修改原因：候选全文分析统一收口到策略模块；只保存提炼结果与原文出处。
@router.post("/strategies/analyze-candidate", response_model=StrategyRead, status_code=201)
def analyze_candidate(request: StrategyCandidateAnalyze) -> StrategyRead:
    # 2026-10-23：本次修改原因：候选文章须先核对权限并入库，禁止绕过统一样本链直接发布策略。
    raise HTTPException(status_code=410, detail="请先在参考文章库核对并保存文章，再从样本或画像创建策略草稿")
    # 2026-10-23：旧候选直提炼实现暂留供对照，当前入口不再执行。
    if not request.title.strip():
        raise HTTPException(status_code=422, detail="候选文章标题不能为空")
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
        sample = ContentSampleModel(
            id=str(uuid4()), title=request.title.strip(), body_text=body,
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


@router.patch("/strategies/{strategy_id}", response_model=StrategyRead)
def update_strategy(strategy_id: str, request: StrategyPatch) -> StrategyRead:
    with SessionLocal() as session:
        row = session.get(ContentStrategyModel, strategy_id)
        if row is None:
            raise HTTPException(status_code=404, detail="策略不存在")
        if row.status != "draft":
            raise HTTPException(status_code=409, detail="仅草稿可编辑；修改已发布规则请创建新版本")
        if request.title is not None:
            # 2026-10-23：本次修改原因：审核时不允许把策略名称改为空白。
            if not request.title.strip():
                raise HTTPException(status_code=422, detail="策略名称不能为空")
            row.title = request.title.strip()
        if request.guide is not None:
            row.guide_json = request.guide.model_dump_json()
        session.commit()
        return strategy_read(row)


@router.post("/strategies/{strategy_id}/publish", response_model=StrategyRead)
def publish_strategy(strategy_id: str) -> StrategyRead:
    with SessionLocal() as session:
        row = session.get(ContentStrategyModel, strategy_id)
        if row is None:
            raise HTTPException(status_code=404, detail="策略不存在")
        if row.status != "draft":
            raise HTTPException(status_code=409, detail="只有草稿可以发布")
        # 2026-10-23：本次修改原因：画像来源若在草稿审核期间变更或失去权限，不允许沿用旧画像发布。
        profile_link = session.get(StrategyProfileLinkModel, row.id)
        if profile_link:
            profile = session.get(StyleProfileModel, profile_link.profile_id)
            if profile is None:
                raise HTTPException(status_code=409, detail="策略来源画像已不可用")
            # 2026-10-24：本次修改原因：来源样本被优先删除后，旧画像不能继续支持草稿发布。
            if json.loads(profile.profile_json).get("deleted_sample_ids"):
                raise HTTPException(status_code=409, detail="画像包含已删除的来源文章，请重新分析后发布策略")
            # for sample_id in json.loads(row.sample_ids_json):  # 2026-10-23：原仅检查代表文章的逻辑保留供对照。
            # 2026-10-23：本次修改原因：发布策略前校验画像的完整样本集，而非只校验五篇代表文章。
            sources = session.scalars(select(StyleProfileArticleModel).where(
                StyleProfileArticleModel.profile_id == profile.id)).all()
            if not set(json.loads(row.sample_ids_json)).issubset({item.sample_id for item in sources}):
                raise HTTPException(status_code=409, detail="策略来源与画像版本不一致")
            for source in sources:
                sample_id = source.sample_id
                sample = session.get(ContentSampleModel, sample_id)
                metadata = session.get(ArticleMetadataModel, sample_id)
                if (sample is None or not sample.rights_confirmed or sample.quality_score < 4 or
                        content_hash(sample.body_text) != source.content_hash or
                        (metadata and metadata.review_status != "ready") or
                        sample.platform_id != profile.platform_id or sample.category_id != profile.category_id or
                        (profile.format_id and sample.format_id != profile.format_id) or
                        (profile.audience_id and (metadata is None or metadata.audience_id != profile.audience_id))):
                    raise HTTPException(status_code=409, detail="画像来源文章已变更或不再可用，请重新分析")
        row.status = "published"
        session.commit()
        return strategy_read(row)


@router.post("/strategies/{strategy_id}/archive", response_model=StrategyRead)
def archive_strategy(strategy_id: str) -> StrategyRead:
    with SessionLocal() as session:
        row = session.get(ContentStrategyModel, strategy_id)
        if row is None:
            raise HTTPException(status_code=404, detail="策略不存在")
        if row.status != "published":
            raise HTTPException(status_code=409, detail="只有已发布策略可以停用")
        row.status = "archived"
        session.commit()
        return strategy_read(row)


# 2026-10-23：本次修改原因：草稿可调整一至六篇参考样本并重新提炼，已发布版本不被覆盖。
@router.post("/strategies/{strategy_id}/regenerate", response_model=StrategyRead)
def regenerate_strategy(strategy_id: str, request: StrategyRegenerate) -> StrategyRead:
    if len(set(request.sample_ids)) != len(request.sample_ids):
        raise HTTPException(status_code=422, detail="所选样本不能重复")
    with SessionLocal() as session:
        row = session.get(ContentStrategyModel, strategy_id)
        if row is None or row.status == "deleted":
            raise HTTPException(status_code=404, detail="策略不存在")
        if row.status != "draft":
            raise HTTPException(status_code=409, detail="只有草稿可重新提炼；已发布版本请创建新草稿")
        try:
            platform, category, content_format = strategy_labels(
                session, row.platform_id, row.category_id, row.format_id
            )
        except ValueError as error:
            raise HTTPException(status_code=422, detail=str(error)) from error
        rows = session.scalars(select(ContentSampleModel).where(
            ContentSampleModel.id.in_(request.sample_ids)
        )).all()
        by_id = {sample.id: sample for sample in rows}
        if len(by_id) != len(request.sample_ids):
            raise HTTPException(status_code=422, detail="部分所选样本不存在，请刷新样本列表")
        samples = [by_id[sample_id] for sample_id in request.sample_ids]
        for sample in samples:
            # 2026-10-23：本次修改原因：重新选样提炼也须遵守文章库的核对状态。
            metadata = session.get(ArticleMetadataModel, sample.id)
            if metadata and metadata.review_status != "ready":
                raise HTTPException(status_code=422, detail="所选样本尚未核对或已排除")
            if not sample.rights_confirmed or sample.quality_score < 4:
                raise HTTPException(status_code=422, detail="只能选择已确认使用权且评分不低于 4 分的样本")
            if sample.platform_id != row.platform_id:
                raise HTTPException(status_code=422, detail="所选样本必须属于当前目标平台")
            if row.category_id and sample.category_id != row.category_id:
                raise HTTPException(status_code=422, detail="所选样本与策略内容类目不一致")
            if row.format_id and sample.format_id not in (None, row.format_id):
                raise HTTPException(status_code=422, detail="所选样本与策略内容形式不一致")
        try:
            guide = extract_guide(session, samples, platform, category, content_format)
        except ValueError as error:
            raise HTTPException(status_code=422, detail=str(error)) from error
        except Exception as error:
            raise HTTPException(status_code=502, detail=f"策略重新提炼失败：{type(error).__name__}") from error
        row.guide_json = guide.model_dump_json()
        row.sample_ids_json = json.dumps(request.sample_ids, ensure_ascii=False)
        # 2026-10-23：本次修改原因：当前规则已改由库内样本生成，旧候选文章引用不再作为依据展示。
        session.execute(delete(ContentStrategyReferenceModel).where(
            ContentStrategyReferenceModel.strategy_id == row.id
        ))
        # 2026-10-23：本次修改原因：草稿改用新的样本重新提炼后，不再声称仍依据原风格画像。
        session.execute(delete(StrategyProfileLinkModel).where(
            StrategyProfileLinkModel.strategy_id == row.id
        ))
        session.commit()
        return strategy_read(row)


# 2026-10-23：本次修改原因：删除策略仅从工作列表移除，保留版本记录供历史任务追溯。
@router.delete("/strategies/{strategy_id}", status_code=204)
def delete_strategy(strategy_id: str) -> None:
    with SessionLocal() as session:
        row = session.get(ContentStrategyModel, strategy_id)
        if row is None or row.status == "deleted":
            raise HTTPException(status_code=404, detail="策略不存在")
        row.status = "deleted"
        session.commit()
