# 2026-10-23：创建 FastAPI 入口并在启动时初始化本地任务表。
from contextlib import asynccontextmanager

from fastapi import FastAPI

from app.api.v1.tasks import router as tasks_router
# 2026-10-23：注册可选择默认 LLM 的设置接口。
from app.api.v1.settings import router as settings_router
# from app.db import Base, engine  # 2026-10-24：原导入保留供对照。
# 2026-10-24：本次修改原因：启动时兼容升级旧文章指标表。
# from app.db import Base, engine, ensure_article_metric_columns  # 2026-10-24：原导入留作对照。
# 2026-10-24：本次修改原因：启动时迁移来源元数据列，保持旧样本可读。
# 2026-10-24：本次修改原因：正式 Schema 只由 Alembic 演进，旧启动期建表/补列入口保留注释供迁移核对。
# from app.db import Base, engine, ensure_article_metric_columns, ensure_article_source_columns
import os
from app.infrastructure.database.session import make_target_engine, require_database_revision
# 2026-10-23：本次修改原因：注册选项、样本与策略接口，并在启动时建立初始选项。
from app.api.v1.content import router as content_router
from app.content_config import seed_options
from app.db import SessionLocal
# 2026-10-23：本次修改原因：注册 RedFox 公众号小规模验证接口。
from app.api.v1.redfox import router as redfox_router
# 2026-10-23：本次修改原因：注册品牌资料的维护和审核接口。
from app.api.v1.brands import router as brands_router
# 2026-10-23：本次修改原因：注册可分页复核、保存指标和建立风格画像的文章库接口。
from app.api.v1.article_library import router as article_library_router
# 2026-10-24：本次修改原因：Stage 2B 新版文章库 API 只依赖独立目标库，旧版 v1 暂保留供迁移过渡。
from app.api.v2.article_library import router as article_library_v2_router


@asynccontextmanager
async def lifespan(_: FastAPI):
    # Base.metadata.create_all(bind=engine)  # 2026-10-24：改由 Alembic 管理目标库。
    # 2026-10-24：本次修改原因：为既有数据库补上来源文章的在看数和原始读数列。
    # ensure_article_metric_columns()  # 2026-10-24：禁止启动时临时 ALTER TABLE。
    # 2026-10-24：本次修改原因：为旧元数据表补上 RedFox 来源响应字段存储列。
    # ensure_article_source_columns()  # 2026-10-24：禁止启动时临时 ALTER TABLE。
    # 2026-10-24：本次修改原因：显式配置目标库时只读检查版本；未配置时保持旧 API 过渡运行。
    target_url = os.getenv("AI4GEO_V2_DATABASE_URL")
    if target_url:
        target_engine = make_target_engine(target_url)
        try:
            require_database_revision(target_engine, "20261024_01")
        finally:
            target_engine.dispose()
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
# 2026-10-23：本次修改原因：文章库关联表由现有 create_all 在启动时创建，旧文章表保持原状。
app.include_router(article_library_router, prefix="/api/v1")
# 2026-10-24：本次修改原因：使目标数据模型具备发现候选、统一收录和编辑的 v2 后端闭环。
app.include_router(article_library_v2_router, prefix="/api/v2")


@app.get("/health", tags=["system"])
def health() -> dict[str, str]:
    return {"status": "ok"}
