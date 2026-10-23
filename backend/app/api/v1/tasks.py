# 2026-10-23：开放任务创建和查询接口，形成首个可调用的业务闭环。
from fastapi import APIRouter, HTTPException, status
# 2026-10-23：本次修改原因：保存人工修订时间并与 AI 原稿分开记录。
from datetime import datetime, timezone

# 2026-10-23：读取生成结果并校验任务选择的模型。
# from app.db import SessionLocal  # 2026-10-23：原导入暂保留供对照。
# from app.schemas.task import TaskCreate, TaskRead  # 2026-10-23：原导入暂保留供对照。
# from app.db import SessionLocal, TaskResultModel  # 2026-10-23：原导入保留供对照。
# 2026-10-23：本次修改原因：读取和保存独立的人工修订稿。
from app.db import SessionLocal, TaskResultModel, TaskDraftModel
# 2026-10-23：本次修改原因：创建任务时固定分类名称与已发布策略快照。
from app.content_config import normalize_task_options
from app.strategy_service import attach_published_strategy
# from app.schemas.task import TaskCreate, TaskRead, TaskResultRead  # 2026-10-23：原导入保留供对照。
# 2026-10-23：本次修改原因：增加修订稿写入校验。
from app.schemas.task import TaskCreate, TaskRead, TaskResultRead, TaskDraftWrite
from app.settings_service import resolve_task_model
from app.services.task_service import create_task, get_task
# 2026-10-23：本次修改原因：生成任务使用已启用的品牌库资料快照。
from app.brand_service import attach_brand_snapshot


router = APIRouter(prefix="/tasks", tags=["tasks"])


@router.post("", response_model=TaskRead, status_code=status.HTTP_201_CREATED)
def post_task(request: TaskCreate) -> TaskRead:
    with SessionLocal() as session:
        # return create_task(session, request)  # 2026-10-23：原路径未固定实际模型，暂保留供对照。
        # 2026-10-23：创建时记录当前选定模型，保证后续默认设置变化不影响已提交任务。
        try:
            selected_request = resolve_task_model(session, request)
            # 2026-10-23：本次修改原因：生成端按已发布策略工作，任务提交后不受后续编辑影响。
            selected_request = normalize_task_options(session, selected_request)
            selected_request = attach_published_strategy(session, selected_request)
            # 2026-10-23：本次修改原因：品牌信息与策略一样在任务创建时冻结。
            selected_request = attach_brand_snapshot(session, selected_request)
        except ValueError as exc:
            raise HTTPException(status_code=422, detail=str(exc)) from exc
        return create_task(session, selected_request)


@router.get("/{task_id}", response_model=TaskRead)
def read_task(task_id: str) -> TaskRead:
    with SessionLocal() as session:
        task = get_task(session, task_id)
    if task is None:
        raise HTTPException(status_code=404, detail="任务不存在")
    return task


# 2026-10-23：完成后提供正文、模型和 Token 用量；生成前返回明确状态。
@router.get("/{task_id}/result", response_model=TaskResultRead)
def read_task_result(task_id: str) -> TaskResultRead:
    with SessionLocal() as session:
        task = get_task(session, task_id)
        if task is None:
            raise HTTPException(status_code=404, detail="任务不存在")
        result = session.get(TaskResultModel, task_id)
        if result is None:
            raise HTTPException(status_code=409, detail=f"任务尚未完成：{task.status}")
        # 2026-10-23：本次修改原因：结果查询同时返回独立保存的人工修订稿。
        draft = session.get(TaskDraftModel, task_id)
        return TaskResultRead(
            task_id=task_id,
            status=task.status,
            provider=result.provider,
            model=result.model,
            title=result.title,
            summary=result.summary,
            body_markdown=result.body_markdown,
            error=result.error,
            input_tokens=result.input_tokens,
            output_tokens=result.output_tokens,
            completed_at=result.completed_at,
            edited_title=draft.title if draft else None,
            edited_summary=draft.summary if draft else None,
            edited_body_markdown=draft.body_markdown if draft else None,
            # 2026-10-23：本次修改原因：SQLite 读取时区字段可能变为无时区，按写入时的 UTC 展示。
            edited_at=(draft.updated_at if draft.updated_at.tzinfo else
                       draft.updated_at.replace(tzinfo=timezone.utc)) if draft else None,
        )


# 2026-10-23：本次修改原因：仅允许已完成任务保存人工修订稿，AI 原结果不被覆盖。
@router.put("/{task_id}/draft", response_model=TaskResultRead)
def save_task_draft(task_id: str, request: TaskDraftWrite) -> TaskResultRead:
    title = request.title.strip()
    body = request.body_markdown.strip()
    if not title or not body:
        raise HTTPException(status_code=422, detail="标题和正文不能为空")
    with SessionLocal() as session:
        task = get_task(session, task_id)
        if task is None:
            raise HTTPException(status_code=404, detail="任务不存在")
        result = session.get(TaskResultModel, task_id)
        if task.status != "completed" or result is None or result.error:
            raise HTTPException(status_code=409, detail="任务尚未成功生成，不能保存修订稿")
        draft = session.get(TaskDraftModel, task_id)
        if draft is None:
            draft = TaskDraftModel(task_id=task_id, title=title,
                                   summary=request.summary.strip(), body_markdown=body,
                                   updated_at=datetime.now(timezone.utc))
            session.add(draft)
        else:
            draft.title = title
            draft.summary = request.summary.strip()
            draft.body_markdown = body
            draft.updated_at = datetime.now(timezone.utc)
        session.commit()
    return read_task_result(task_id)
