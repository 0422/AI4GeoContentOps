# 2026-10-23：本次修改原因：集中管理用户指定的四组可编辑内容选项和历史任务快照。
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db import ContentOptionModel
from app.schemas.task import TaskCreate


OPTION_KINDS = {"category", "audience", "format", "platform"}
DEFAULT_OPTIONS = {
    "category": [
        "人文资讯", "知识百科", "健康养生", "时尚潮流", "美食餐饮", "乐活生活", "旅游出行",
        "搞笑幽默", "情感心理", "体育娱乐", "美容美体", "文摘精选", "财富理财", "科技数码",
        "创投商业", "汽车交通", "房产楼市", "职场发展", "教育考试", "学术研究", "企业品牌",
    ],
    "audience": ["学生", "职场新人", "资深从业者", "管理者", "家庭决策者", "泛兴趣人群"],
    "format": ["资讯", "科普", "评论", "故事", "清单", "测评", "访谈"],
    "platform": ["微信公众号", "小红书", "百家号", "头条", "视频号"],
}


def seed_options(session: Session) -> None:
    for kind, labels in DEFAULT_OPTIONS.items():
        exists = session.scalar(select(ContentOptionModel.id).where(ContentOptionModel.kind == kind).limit(1))
        if exists is None:
            for position, label in enumerate(labels, 1):
                session.add(ContentOptionModel(
                    id=f"{kind}_{position:02d}", kind=kind, label=label, position=position, active=True
                ))
    session.commit()


def require_option(session: Session, option_id: str, kind: str, *, active: bool = True) -> ContentOptionModel:
    option = session.get(ContentOptionModel, option_id)
    if option is None or option.kind != kind or (active and not option.active):
        raise ValueError(f"所选{kind}选项不存在或已停用")
    return option


def normalize_task_options(session: Session, request: TaskCreate) -> TaskCreate:
    ids = (request.category_id, request.audience_id, request.format_id, request.platform_id)
    if not any(ids):
        return request
    if not all(ids):
        raise ValueError("内容类目、目标读者、内容形式和目标平台必须同时选择")
    category = require_option(session, request.category_id or "", "category")
    audience = require_option(session, request.audience_id or "", "audience")
    content_format = require_option(session, request.format_id or "", "format")
    platform = require_option(session, request.platform_id or "", "platform")
    return request.model_copy(update={
        "category_label": category.label,
        "audience": audience.label,
        "content_type": content_format.label,
        "channel": platform.label,
    })
