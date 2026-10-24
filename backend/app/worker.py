# 2026-10-23：使用独立的 Windows Python 进程处理 SQLite 中的待生成任务。
import time

from sqlalchemy import select, update

# 2026-10-24：本次修改原因：Worker 不再通过旧 Base 在启动时自动改动 Schema。
# from app.db import Base, SessionLocal, TaskModel, TaskResultModel, engine
from app.db import SessionLocal, TaskModel, TaskResultModel
from app.llm import generate_article
from app.schemas.task import TaskCreate


def claim_task() -> str | None:
    with SessionLocal() as session:
        task = session.scalar(
            select(TaskModel).where(TaskModel.status == "pending").order_by(TaskModel.created_at).limit(1)
        )
        if task is None:
            return None
        task.status = "running"
        session.commit()
        return task.id


def process_task(task_id: str) -> None:
    with SessionLocal() as session:
        task = session.get(TaskModel, task_id)
        if task is None:
            return
        request = TaskCreate.model_validate_json(task.request_json)

    try:
        generation = generate_article(request)
        result = TaskResultModel(
            task_id=task_id,
            provider=request.llm_provider or "",
            model=request.llm_model or "",
            title=generation.article.title,
            summary=generation.article.summary,
            body_markdown=generation.article.body_markdown,
            input_tokens=generation.input_tokens,
            output_tokens=generation.output_tokens,
        )
        new_status = "completed"
    except Exception as exc:
        # 2026-10-23：仅保存异常类型，避免把外部接口返回的敏感文本写入结果表。
        result = TaskResultModel(
            task_id=task_id,
            provider=request.llm_provider or "",
            model=request.llm_model or "",
            error=f"模型调用失败：{type(exc).__name__}",
        )
        new_status = "failed"

    with SessionLocal() as session:
        session.add(result)
        task = session.get(TaskModel, task_id)
        if task is not None:
            task.status = new_status
        session.commit()


def main() -> None:
    # Base.metadata.create_all(bind=engine)  # 2026-10-24：目标库只通过 Alembic 迁移。
    # 2026-10-23：首期仅运行一个 Worker；重启后重新领取中断的任务。
    with SessionLocal() as session:
        # session.execute(update(TaskModel).where(TaskModel.status == "running").values(status="pending"))  # 2026-10-24：旧自动重试可能重复付费。
        # 2026-10-24：本次修改原因：旧任务结果未知时先停为 outcome_unknown，由维护者确认后再决定是否重试。
        session.execute(update(TaskModel).where(TaskModel.status == "running").values(status="outcome_unknown"))
        session.commit()
    print("任务 Worker 已启动；按 Ctrl+C 停止。")
    try:
        while True:
            task_id = claim_task()
            if task_id:
                process_task(task_id)
            else:
                time.sleep(2)
    except KeyboardInterrupt:
        print("任务 Worker 已停止。")


if __name__ == "__main__":
    main()
