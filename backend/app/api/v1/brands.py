# 2026-10-23：本次修改原因：提供品牌草稿、事实编辑、审核启用与停用接口。
import json
from datetime import datetime
from uuid import uuid4

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field, field_validator
from sqlalchemy import select

from app.db import BrandModel, SessionLocal


router = APIRouter(prefix="/brands", tags=["brands"])


class BrandFact(BaseModel):
    label: str = Field(min_length=1, max_length=100)
    value: str = Field(min_length=1, max_length=500)
    source: str = Field(min_length=1, max_length=500)

    @field_validator("label", "value", "source")
    @classmethod
    def nonblank(cls, value: str) -> str:
        if not value.strip():
            raise ValueError("事实字段不能为空")
        return value.strip()


class BrandInput(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    description: str = Field(min_length=1, max_length=3000)
    facts: list[BrandFact] = Field(default_factory=list, max_length=20)

    @field_validator("name", "description")
    @classmethod
    def nonblank(cls, value: str) -> str:
        if not value.strip():
            raise ValueError("品牌名称和介绍不能为空")
        return value.strip()


class BrandRead(BrandInput):
    id: str
    active: bool
    version: int
    created_at: datetime


def brand_read(row: BrandModel) -> BrandRead:
    return BrandRead(id=row.id, name=row.name, description=row.description,
                     facts=json.loads(row.facts_json), active=row.active,
                     version=row.version, created_at=row.created_at)


@router.get("", response_model=list[BrandRead])
def list_brands(include_inactive: bool = True) -> list[BrandRead]:
    with SessionLocal() as session:
        rows = session.scalars(select(BrandModel).order_by(BrandModel.created_at.desc())).all()
        return [brand_read(row) for row in rows if include_inactive or row.active]


@router.post("", response_model=BrandRead, status_code=201)
def create_brand(request: BrandInput) -> BrandRead:
    with SessionLocal() as session:
        rows = session.scalars(select(BrandModel)).all()
        if any(row.name.casefold() == request.name.casefold() for row in rows):
            raise HTTPException(status_code=409, detail="品牌名称已存在")
        row = BrandModel(id=str(uuid4()), name=request.name,
                         description=request.description,
                         facts_json=json.dumps([fact.model_dump() for fact in request.facts], ensure_ascii=False),
                         active=False, version=1)
        session.add(row)
        session.commit()
        session.refresh(row)
        return brand_read(row)


@router.put("/{brand_id}", response_model=BrandRead)
def update_brand(brand_id: str, request: BrandInput) -> BrandRead:
    with SessionLocal() as session:
        row = session.get(BrandModel, brand_id)
        if row is None:
            raise HTTPException(status_code=404, detail="品牌不存在")
        siblings = session.scalars(select(BrandModel).where(BrandModel.id != brand_id)).all()
        if any(item.name.casefold() == request.name.casefold() for item in siblings):
            raise HTTPException(status_code=409, detail="品牌名称已存在")
        # 2026-10-23：本次修改原因：品牌事实编辑后先回到草稿，避免未经复核的新版本直接用于生成。
        row.name = request.name
        row.description = request.description
        row.facts_json = json.dumps([fact.model_dump() for fact in request.facts], ensure_ascii=False)
        row.version += 1
        row.active = False
        session.commit()
        return brand_read(row)


@router.post("/{brand_id}/activate", response_model=BrandRead)
def activate_brand(brand_id: str) -> BrandRead:
    with SessionLocal() as session:
        row = session.get(BrandModel, brand_id)
        if row is None:
            raise HTTPException(status_code=404, detail="品牌不存在")
        row.active = True
        session.commit()
        return brand_read(row)


@router.post("/{brand_id}/archive", response_model=BrandRead)
def archive_brand(brand_id: str) -> BrandRead:
    with SessionLocal() as session:
        row = session.get(BrandModel, brand_id)
        if row is None:
            raise HTTPException(status_code=404, detail="品牌不存在")
        row.active = False
        session.commit()
        return brand_read(row)
