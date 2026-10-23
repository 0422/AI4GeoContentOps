# 2026-10-23：提供默认模型设置和已配置状态，不向浏览器返回 API 密钥。
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from app.db import SessionLocal
from app.llm import model_options
from app.settings_service import get_settings, set_default_model


router = APIRouter(prefix="/settings/llm", tags=["llm-settings"])


class ModelOptionRead(BaseModel):
    provider: str
    model: str
    label: str
    configured: bool


class LLMSettingsRead(BaseModel):
    default_provider: str
    default_model: str
    options: list[ModelOptionRead]


class LLMSettingsUpdate(BaseModel):
    provider: str
    model: str


def settings_response(provider: str, model: str) -> LLMSettingsRead:
    return LLMSettingsRead(
        default_provider=provider,
        default_model=model,
        options=[
            ModelOptionRead(provider=item.provider, model=item.model, label=item.label, configured=item.configured)
            for item in model_options()
        ],
    )


@router.get("", response_model=LLMSettingsRead)
def read_settings() -> LLMSettingsRead:
    with SessionLocal() as session:
        settings = get_settings(session)
        return settings_response(settings.provider, settings.model)


@router.put("", response_model=LLMSettingsRead)
def update_settings(request: LLMSettingsUpdate) -> LLMSettingsRead:
    with SessionLocal() as session:
        try:
            settings = set_default_model(session, request.provider, request.model)
        except ValueError as exc:
            raise HTTPException(status_code=422, detail=str(exc)) from exc
        return settings_response(settings.provider, settings.model)
