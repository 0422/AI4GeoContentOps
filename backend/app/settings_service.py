# 2026-10-23：保存全局默认模型，并在创建任务时固定本次模型选择。
from sqlalchemy.orm import Session

from app.db import LLMSettingModel
from app.llm import find_model
from app.schemas.task import TaskCreate


DEFAULT_PROVIDER = "deepseek"
DEFAULT_MODEL = "deepseek-flash"


def get_settings(session: Session) -> LLMSettingModel:
    settings = session.get(LLMSettingModel, 1)
    if settings is None:
        settings = LLMSettingModel(id=1, provider=DEFAULT_PROVIDER, model=DEFAULT_MODEL)
        session.add(settings)
        session.commit()
        session.refresh(settings)
    return settings


def set_default_model(session: Session, provider: str, model: str) -> LLMSettingModel:
    option = find_model(provider, model)
    if option is None:
        raise ValueError("所选模型不在可用列表中")
    if not option.configured:
        raise ValueError(f"未配置 {option.api_key_env}")
    settings = get_settings(session)
    settings.provider = provider
    settings.model = model
    session.commit()
    session.refresh(settings)
    return settings


def resolve_task_model(session: Session, request: TaskCreate) -> TaskCreate:
    if bool(request.llm_provider) != bool(request.llm_model):
        raise ValueError("任务需同时指定供应商和模型")
    settings = get_settings(session)
    provider = request.llm_provider or settings.provider
    model = request.llm_model or settings.model
    option = find_model(provider, model)
    if option is None:
        raise ValueError("所选模型不在可用列表中")
    if not option.configured:
        raise ValueError(f"未配置 {option.api_key_env}")
    return request.model_copy(update={"llm_provider": provider, "llm_model": model})
