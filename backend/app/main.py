# 2026-10-23：创建 FastAPI 入口并在启动时初始化本地任务表。
from contextlib import asynccontextmanager

from fastapi import FastAPI

from app.api.v1.tasks import router as tasks_router
# 2026-10-23：注册可选择默认 LLM 的设置接口。
from app.api.v1.settings import router as settings_router
from app.db import Base, engine
# 2026-10-23：本次修改原因：注册选项、样本与策略接口，并在启动时建立初始选项。
from app.api.v1.content import router as content_router
from app.content_config import seed_options
from app.db import SessionLocal
# 2026-10-23：本次修改原因：注册 RedFox 公众号小规模验证接口。
from app.api.v1.redfox import router as redfox_router
# 2026-10-23：本次修改原因：注册品牌资料的维护和审核接口。
from app.api.v1.brands import router as brands_router


@asynccontextmanager
async def lifespan(_: FastAPI):
    Base.metadata.create_all(bind=engine)
    # 2026-10-23：本次修改原因：首次启动写入用户指定的四组选项。
    with SessionLocal() as session:
        seed_options(session)
    yield


app = FastAPI(title="AI4GeoContentOps", version="0.1.0", lifespan=lifespan)
app.include_router(tasks_router, prefix="/api/v1")
# 2026-10-23：让前端获取可用模型并保存默认选择。
app.include_router(settings_router, prefix="/api/v1")
# 2026-10-23：本次修改原因：将多页面共享的内容配置和样本策略接口集中提供给前端。
app.include_router(content_router, prefix="/api/v1")
# 2026-10-23：本次修改原因：让样本库页面通过后端受控调用 RedFox，避免向浏览器暴露密钥。
app.include_router(redfox_router, prefix="/api/v1")
# 2026-10-23：本次修改原因：让生成页读取已启用品牌，提交时由后端固定事实快照。
app.include_router(brands_router, prefix="/api/v1")


@app.get("/health", tags=["system"])
def health() -> dict[str, str]:
    return {"status": "ok"}
