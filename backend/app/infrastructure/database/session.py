# 2026-10-24：本次修改原因：Stage 2A 新库使用独立连接与短事务，并在每个 SQLite 连接启用完整性和并发设置。
"""Target database access; importing this module does not open or migrate a database."""

from contextlib import contextmanager
from pathlib import Path
from typing import Iterator
from sqlalchemy import Engine, create_engine, event, text
from sqlalchemy.engine import make_url
from sqlalchemy.orm import Session, sessionmaker


LEGACY_DATABASE = Path(__file__).resolve().parents[3] / "data" / "tasks.db"


def sqlite_file_from_url(url: str) -> Path | None:
    parsed = make_url(url)
    if parsed.get_backend_name() != "sqlite" or parsed.database in (None, ":memory:"):
        return None
    database = parsed.database.removeprefix("file:")
    return Path(database).resolve()


def reject_legacy_database(url: str) -> None:
    target = sqlite_file_from_url(url)
    if target is not None and (target == LEGACY_DATABASE.resolve() or
                               (target.exists() and LEGACY_DATABASE.exists() and target.samefile(LEGACY_DATABASE))):
        raise ValueError("Stage 2A target connection cannot point to the legacy tasks.db")


def make_target_engine(url: str) -> Engine:
    if not url or "://" not in url:
        raise ValueError("An explicit AI4GEO_V2_DATABASE_URL is required")
    reject_legacy_database(url)
    sqlite = make_url(url).get_backend_name() == "sqlite"
    engine = create_engine(url, connect_args={"timeout": 10} if sqlite else {})
    if sqlite:
        @event.listens_for(engine, "connect")
        def configure_sqlite(dbapi_connection, _record) -> None:
            cursor = dbapi_connection.cursor()
            cursor.execute("PRAGMA foreign_keys=ON")
            cursor.execute("PRAGMA journal_mode=WAL")
            cursor.execute("PRAGMA busy_timeout=10000")
            cursor.close()
    return engine


def session_factory(engine: Engine) -> sessionmaker[Session]:
    return sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)


@contextmanager
def short_transaction(factory: sessionmaker[Session]) -> Iterator[Session]:
    """Perform only local validation/writes inside; no HTTP or LLM waits."""
    with factory.begin() as session:
        yield session


def read_database_revision(engine: Engine) -> str | None:
    target_path = sqlite_file_from_url(str(engine.url))
    if target_path is not None and not target_path.exists():
        return None
    with engine.connect() as connection:
        table = connection.execute(text("SELECT name FROM sqlite_master WHERE type='table' AND name='alembic_version'")) if engine.dialect.name == "sqlite" else None
        if table is not None and table.scalar_one_or_none() is None:
            return None
        if engine.dialect.name != "sqlite":
            from sqlalchemy import inspect
            if not inspect(connection).has_table("alembic_version"):
                return None
        return connection.execute(text("SELECT version_num FROM alembic_version")).scalar_one_or_none()


def require_database_revision(engine: Engine, expected: str) -> None:
    actual = read_database_revision(engine)
    if actual != expected:
        raise RuntimeError(f"Target database revision {actual!r} does not match {expected!r}")
