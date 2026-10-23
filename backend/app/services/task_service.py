# 2026-10-23：集中处理任务的创建与查询，避免 API 路由直接操作数据库。
from uuid import uuid4

from sqlalchemy.orm import Session

from app.db import TaskModel
from app.schemas.task import TaskCreate, TaskRead


def to_task_read(task: TaskModel) -> TaskRead:
    return TaskRead(
        task_id=task.id,
        status=task.status,
        request=TaskCreate.model_validate_json(task.request_json),
        created_at=task.created_at,
    )


def create_task(session: Session, request: TaskCreate) -> TaskRead:
    task = TaskModel(
        id=str(uuid4()),
        status="pending",
        request_json=request.model_dump_json(),
    )
    session.add(task)
    session.commit()
    session.refresh(task)
    return to_task_read(task)


def get_task(session: Session, task_id: str) -> TaskRead | None:
    task = session.get(TaskModel, task_id)
    return to_task_read(task) if task else None
