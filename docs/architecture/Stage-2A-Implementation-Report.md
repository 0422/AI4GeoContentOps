<!-- 2026-10-24：本次修改原因：如实记录 Stage 2A 已落地代码、用户首轮测试结果及旧库切换门槛。 -->
# AI4Geo Stage 2A 实施报告

## 实施边界与现状

本轮建立独立的目标数据库模型、首个 Alembic 版本、数据契约、修订与冻结集合的事务原语，以及旧 SQLite 库的**副本迁移演练程序**。没有接通 API v2、RedFox Adapter、前端或后续 AI 服务。现有 v1 仍读取 `backend/data/tasks.db`；目标库不与旧库双写。Codex 没有修改真实业务数据库、调用付费接口或自行运行编译/构建/测试/迁移。维护者已运行 9 项自动化测试和一次旧库副本迁移演练，全部通过。

只读检查过 `backend/data/tasks.db` 的 16 张旧表及 `article_metrics.raw_counts_json`、`article_metadata.source_data_json` 示例；旧数据确有 `10w+` 原始读数与空的精确读数。也核对了 `backend/app/db.py`、`backend/app/main.py`、`backend/app/worker.py`、`backend/requirements.txt`、两份架构文档和 `docs/article-library/01` 至 `06` 文档。

## 修改文件

| 文件 | 实际作用 |
|---|---|
| `backend/app/infrastructure/database/target_models.py` | 34 张目标表的独立 SQLAlchemy ORM；不复用旧 `Base` |
| `backend/app/infrastructure/database/session.py` | 显式目标库连接、旧库路径防护、SQLite 外键/WAL/busy_timeout、短事务和版本检查 |
| `backend/alembic.ini`、`backend/alembic/env.py` | 只有显式指定目标 URL 才可执行的 Alembic 环境 |
| `backend/alembic/versions/20261024_01_stage2a.py`、同名 `.sql` | 冻结的首版 34 表 DDL、索引与 SQLite 冻结快照写保护触发器 |
| `backend/scripts/generate_stage2a_schema.py` | 从蓝图 DDL 生成首版 ORM/迁移快照的代码生成器；仅在内存 SQLite 解析结构 |
| `backend/scripts/__init__.py` | 固定本地脚本包导入，避免与 Anaconda 的同名包冲突 |
| `backend/app/domains/articles/contracts.py` | 统一文章、来源、指标、权限、指纹、字段溯源及清理范围契约 |
| `backend/app/domains/articles/revisions.py` | 文章创建/编辑、不可覆盖修订与当前指针的同事务原语及乐观锁 |
| `backend/app/domains/intelligence/collection_state.py` | 选样冻结、分析关联、输入封存的状态转换原语 |
| `backend/scripts/rehearse_stage2a_migration.py` | 旧库只读备份、独立新库迁移、归档和一致性报告的演练程序 |
| `backend/tests/test_stage2a_contracts.py`、`backend/tests/test_stage2a_rehearsal.py` | 契约语义、首版 Alembic 表/列、修订指针、字段回读及虚构旧库副本映射测试；维护者运行 9 项全部通过 |
| `backend/app/main.py`、`backend/app/worker.py` | 注释旧启动期 `create_all`/临时补列；显式配置 v2 时核对版本；旧 Worker 重启时把结果未知任务停为 `outcome_unknown`，不自动重复付费调用 |
| `backend/requirements.txt` | 加入 Alembic 依赖 |
| `docs/architecture/AI4Geo-Refactor-Blueprint.md` | 同步当前修订指针、同文章 FK 与冻结集合状态列 |

## 数据模型与三个补强点

目标 ORM/DDL 包含蓝图列出的 34 张表。`articles.current_revision_id` 与 `(id,current_revision_id) → article_revisions(article_id,id)` 组合外键保证指针属于同一文章；`article_revisions` 另有 `(article_id,revision_number)` 唯一键。首次创建先插入文章、修订，再设指针；编辑先计算新快照，再以 `row_version` 比对更新，调用者必须在同一事务提交或回滚。普通编辑不会改写 `article_sources` 或 `article_source_payloads`。

集合状态是 `selection_building → selection_frozen → analyzing → inputs_sealed`。选样项只在构建阶段可增改，特征关联只在分析阶段可增改；封存后不能改变输入。SQLite 迁移额外创建触发器保护这些关联。旧画像迁移为 `legacy_unverified`，不会被冒认为已封存且可用的画像证据。PostgreSQL 部署前需要实现等效数据库约束/触发器。

`SENSITIVE_DATA_LOCATIONS` 列出候选响应、正式来源载荷、当前正文、修订、Prepared、特征证据、画像/表现、任务输入/输出/错误、生成稿、评估证据、旧库归档、缓存、日志和备份。`data_disposition_events` 可按文章、候选、任务等目标记录清理事件；旧库归档带保留/脱敏时间列。它们是后续清理服务的扫描契约，本阶段**没有**实现清理执行、备份重放拦截或权限撤回后任务取消。

## 旧库映射与演练设计

演练命令打开旧库只读，用 SQLite backup API 在全新输出目录创建备份，输出只读预检报告，然后由 Alembic 建立独立目标库。不会覆盖已存在输出目录或把目标 URL 指向旧 `tasks.db`；Alembic 也拒绝在含旧 `content_samples` 表的数据库上建目标 Schema。每条旧记录先存 `legacy_payload_archive`，并写 `legacy_id_map`；具有明确目标语义的记录再建立活动映射。报告包含旧表数量、归档数量、活动映射数量/缺口、新表数量、正文 Hash 比对和外键检查。

| 旧数据 | 目标及处理 |
|---|---|
| `content_samples` + `article_metadata` | `articles`、首修订、来源及受控载荷、权限决定；保留旧文章 ID；仅当旧响应确有 `content` 时填原始来源正文，不把当前编辑正文冒充原始抓取；旧布尔授权只作未核实历史证据 |
| `article_metrics` | 指标快照；`10w+` 保留原值，精确值为空，下界为 100000 |
| `article_features` | `legacy_unverified` Prepared/Feature，保留原特征 JSON，但不可当作新分析有效版本 |
| `style_profiles` + 成员 | 画像、冻结集合及旧输入关联；标记 `legacy_unverified` |
| `content_strategies` + 参考 + 画像链接 | 策略/版本/引用；缺失的旧策略建立明确的孤儿占位版本，不伪造规则 |
| `tasks` + 结果 + 人工草稿 | 处理任务、生成文档及修订；尽可能恢复旧策略版本和品牌引用，未知版本标为未核实 |
| `candidate_drafts` | 固定的旧发现会话及候选草稿 |
| `brands`、`content_options`、`llm_settings` | 原值迁移 |
| 其他旧记录 | 完整归档与 ID 映射；活动映射缺口在报告单列 |

旧 `rights_confirmed` 无法证明第三方 LLM 处理授权；原文完整性、旧特征配置、旧生成调用权限也无法恢复。旧 ORM 以 UTC 写系统时间，但 SQLite 丢失时区偏移；演练按旧代码约定补 UTC，并把旧原值保留在归档中，这项推断须复核。文章原始发布时间若只有日期，仍保持日期精度，不补造时分秒。演练后应审查 `active_mapping_gaps`、孤儿引用和敏感归档保留策略，再考虑真实库切换。

## 已核对、未核对与风险

首版快照含 34 个目标表、索引、修订组合外键和冻结状态列。维护者重跑后，9 项自动化测试全部通过。旧库副本演练的 Alembic 版本为 `20261024_01`；11 篇文章、11 条指标、3 条策略和 5 个生成任务均已迁移，生成 5 个稿件及 10 条策略文章引用。归档 87 条旧记录，建立 174 条旧 ID 映射；活动映射缺口、归档数量差异、正文 Hash 差异、外键错误均为零，预检孤儿指标和孤儿策略引用也为空。第一次演练的版本未提交问题已修复，第二次演练完整通过。类型检查和构建未执行。

已知风险与范围：

1. 当前 v1 API/Worker 已停止启动期建表/补列；使用空旧库直接启动 v1 将失败。现有旧库保持原状，正式切换需 Stage 2B 后安排。
2. 迁移程序可能碰到历史 JSON、孤儿记录或旧任务字段的其他形状；副本演练报告是判断依据，不得以归档成功代替活动关联成功。
3. 首版 SQL 快照以现阶段 SQLite 为执行目标。模型保留通用 SQLAlchemy 契约，但 PostgreSQL 上的循环外键建立顺序、快照触发器需单独方言迁移。
4. `legacy_payload_archive` 和独立备份可能包含第三方原文，尚需在清理服务与部署策略中纳入保留期限和权限撤回处理。
5. RedFox 三接口真实 Fixture 和权限证据仍未验证；本阶段没有调用这些接口，也未声明字段映射已通过真实契约测试。
6. 目前仅建数据层及事务原语，目标 ORM 尚未被 v1/新 API 正式使用；不能把 Stage 2A 当作采集、清洗、分析功能已上线。
7. 旧 Worker 的 `outcome_unknown` 状态需要 Stage 2B 接入明确的人工核对/重试流程；现有 v1 页面可能只会显示原始状态文本。

## 验收结果与剩余门槛

测试输出为 `Ran 9 tests ... OK`。副本演练报告位于 `backend/data/stage2a-rehearsal-20261024-02/`：预检无孤儿记录，迁移版本正确，归档与活动映射完整，正文 Hash 和外键检查均通过。该副本包含完整旧库备份和迁移后的目标库，便于维护者抽查字段及引用。

真实 `backend/data/tasks.db` 尚未迁移或切换。旧授权范围、原文完整性、旧特征配置、旧生成调用权限及 SQLite 系统时间原有时区无法从历史数据完全恢复；它们已在迁移中保守标记或保留归档。Stage 2A 的 ORM/DDL 自动化测试和离线迁移演练通过，可以进入代码审查及 Stage 2B；生产库切换仍需独立备份、预检和明确确认。

## Stage 2B 建议

Stage 2A 验收通过。建议先审查本报告及副本目标库，再启动 Stage 2B；其真实 RedFox Fixture/授权证据仍需单独核实，真实库切换另需明确确认。
