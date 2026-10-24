# 2026-10-24：本次修改原因：Alembic 仅在显式传入独立目标库 URL 时运行，并加载 Stage 2A 元数据供版本比对。
from logging.config import fileConfig
import os

from alembic import context
from sqlalchemy import inspect

from app.infrastructure.database.session import make_target_engine, reject_legacy_database
from app.infrastructure.database.target_models import TargetBase

config = context.config
if config.config_file_name:
    fileConfig(config.config_file_name)
target_metadata = TargetBase.metadata


def target_url() -> str:
    url = context.get_x_argument(as_dictionary=True).get("db_url") or os.getenv("AI4GEO_V2_DATABASE_URL")
    if not url:
        raise RuntimeError("Pass -x db_url=... or set AI4GEO_V2_DATABASE_URL explicitly")
    reject_legacy_database(url)
    return url


if context.is_offline_mode():
    context.configure(url=target_url(), target_metadata=target_metadata, literal_binds=True)
    with context.begin_transaction():
        context.run_migrations()
else:
    engine = make_target_engine(target_url())
    try:
        with engine.connect() as connection:
            # 2026-10-24：本次修改原因：即使 URL 指向旧库副本，也拒绝在包含旧文章主表的库上执行目标 DDL。
            if inspect(connection).has_table("content_samples"):
                raise RuntimeError("Refusing to migrate a database containing the legacy content_samples table")
            context.configure(connection=connection, target_metadata=target_metadata, compare_type=True)
            with context.begin_transaction():
                context.run_migrations()
            # 2026-10-24：本次修改原因：SQLite 将 DDL 视为非事务操作时，显式提交 Alembic 版本记录，防止关闭连接后回滚版本号。
            connection.commit()
    finally:
        # 2026-10-24：本次修改原因：关闭 Alembic 连接池，避免 Windows 临时目录删除 SQLite 文件时遇到共享锁。
        engine.dispose()
