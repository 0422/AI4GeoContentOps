# 2026-10-23：本次修改原因：从已启用品牌记录构造可追溯、可冻结的生成事实快照。
import json

from sqlalchemy.orm import Session

from app.db import BrandModel
from app.schemas.task import TaskCreate


def attach_brand_snapshot(session: Session, request: TaskCreate) -> TaskCreate:
    if not request.brand_id:
        return request.model_copy(update={"brand_snapshot": None})
    brand = session.get(BrandModel, request.brand_id)
    if brand is None or not brand.active:
        raise ValueError("所选品牌不存在或尚未启用")
    return request.model_copy(update={"brand_snapshot": {
        "name": brand.name,
        "description": brand.description,
        "facts": json.loads(brand.facts_json),
        "version": brand.version,
    }})
