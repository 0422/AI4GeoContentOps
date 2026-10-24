<!-- 2026-10-24：本次修改原因：记录 Stage 2 前对蓝图的七项架构修订、数据模型影响、验证边界与尚待解决的问题。 -->
# AI4Geo 架构决策复核

> 2026-10-24；仅文档修订。对应正式蓝图：[AI4Geo-Refactor-Blueprint.md](AI4Geo-Refactor-Blueprint.md)。没有修改业务代码、执行迁移、构建或调用付费接口。

## 本轮依据与范围

复核了 `AI4Geo-Refactor-Blueprint.md`、前次审计 `docs/article-library/01-current-implementation-audit.md`、接口映射 `02-redfox-api-field-mapping.md`、旧数据模型 `03-article-data-model.md`、清洗设计 `04-cleaning-pipeline.md`、迁移设计 `05-database-migration.md` 和验收记录 `06-test-and-acceptance-report.md`。本轮沿用已审计的 React/TypeScript + FastAPI/SQLAlchemy + SQLite 实际架构；不把旧文档中的永久保留 `content_samples` 方案当作目标。

## 决策与原因

| 决策 | 蓝图中落实的位置 | 原因与可验证结果 |
|---|---|---|
| D1：三层文章权威关系 | §3.1、ERD、DDL、§5 | 来源元数据与可删除的原始载荷记录 API 事实；`articles` 是当前编辑值；`article_revisions` 保存人工确认快照。每个标准字段有 provenance，人工覆盖不改原始来源。候选→收录→DB→详情→编辑逐字段测试能定位丢失层。 |
| D2：权限按行为判断 | §3.3、§3.5、DDL、§5 | 数据保存、本地确定性清洗、第三方 LLM、生成引用、再分发各有独立门禁。没有第三方全文授权不阻止已获许可的本地清洗；权限未知不外传。撤回时阻止新任务并清理受限派生。 |
| D3：依赖指纹和并发检查 | §3.2、DDL、§4 | Prepared 加 `preparation_config_hash`，组级 Feature 加输入/配置 Hash。修改只影响真正依赖它的结果；任务开始和提交时核对版本。旧结果保留但不能成为当前有效结果。 |
| D4：冻结研究样本 | §3.4、ERD、DDL、§5 | 动态集合供日常筛选；冻结快照锁定规则、种子、文章修订、Prepared/Feature 版本、分组和剔除理由，画像输入可复现。 |
| D5：风格与传播分离 | §3.4、ERD、DDL、§5 | `style_profile_versions` 记录有效样本、分布、异常值、证据覆盖和审核；独立 `performance_analyses` 处理指标。`10w+` 只可作为下界/删失观测，不能当精确均值。策略可分别引用经审核的两类结果。 |
| D6：来源载荷可清理 | §3.5、ERD、DDL、§7 | `article_sources` 保留可审计元数据和 Hash，`article_source_payloads` 保存受限原始正文/JSON。删除或撤回后清理载荷、当前/修订/准备正文、缓存及敏感证据，留非内容审计和清理事件。备份恢复也需重放删除事件。 |
| D7：SQLite 双写入方协调 | §1、§4、DDL | FastAPI 和单后台 Worker 均写 SQLite；WAL、外键、`busy_timeout`、短事务、行版本和租约共同协调。不在写事务中等待外部 HTTP/LLM，付费请求结果未知时不自动重试。 |

## 结构变更范围

| 类别 | 决定 |
|---|---|
| 新表 | `article_source_payloads`、`rights_decisions`、`data_disposition_events`、`article_collection_snapshots`、`article_collection_snapshot_items`、`article_collection_snapshot_features`、`performance_analyses`、`performance_analysis_samples`。其余原蓝图目标实体保持。 |
| 新字段/约束 | 候选/文章/修订/指标的 `field_provenance_json`，来源字段映射及载荷 Hash；文章/候选/集合/任务 `row_version`；Prepared 的输入引用与 `preparation_config_hash`；Feature 的组别、`analysis_input_hash`、`analysis_config_hash`；Job 的输入版本/配置指纹；画像的有效数、剔除、覆盖和审核字段；策略的可选表现分析引用。Prepared/Feature UNIQUE 键仅由非空字段构成。 |
| 服务层实现 | JSON Schema 校验、原始路径映射、权限范围计算、乐观锁、跨表“同一文章/同一快照”验证、输入 Hash 计算、局部失效、任务两次版本复核、载荷清理与备份恢复重放。外键本身不能证明这些跨表业务关系。 |
| API/页面 | v2 增来源载荷、权限决定、冻结集合和表现分析入口；详情输出字段 provenance 与行版本；前端字段来源按需展示，统一编辑器保持相同字段语义。 |

## 数据模型一致性核对

1. `article_source_payloads.source_id` 指向正式来源；候选清理时只有 `article_sources.discovery_candidate_id` 置空，不删正式来源及载荷。来源撤回/文章删除时另按清理事件删除载荷。原始采集内容平时不可编辑；受审计清理是例外。
2. `prepared_articles` 的唯一键含非空输入来源身份、输入 Hash、配置 Hash、Cleaner 版本；`article_features` 的唯一键含非空 Prepared ID、特征组、输入/配置 Hash、分析器版本。不同源身份即使正文相同也建新血缘记录，计算结果可从旧结果复制并标 `reused_from_*_id`。
3. `style_profile_versions` 引用冻结快照；画像输入 Feature、冻结项 Feature 和 Performance 使用的指标必须与该快照/文章一致。现有 DDL 中的独立外键无法表达全部“属于同一篇/同一快照”约束，服务事务和迁移校验必须检查。
4. `rights_decisions` 是权限证据；`articles.rights_status/rights_scope_json` 只是投影。旧库 `rights_confirmed` 不自动扩张为第三方 LLM 全文许可。
5. `processing_jobs` 只保存引用和指纹，不保存全文。任务领取、运行前和结果提交时比较当前版本；已过期结果保存为历史但不推进当前指针。API 与 Worker 都用短事务。

## 未解决问题与实施门槛

| 问题 | 当前状态 | 对 Stage 2 的影响 |
|---|---|---|
| RedFox 三端点的完整真实脱敏响应 Fixture | 关键词文档与示例对正文不一致；榜单官方页此前不可读取；旧库响应又被白名单处理 | **不阻塞 2A** 的数据库/契约实现；2B 可按已证实字段离线开发，但三端点“字段完整性已验证”验收必须等真实 Fixture，不能用虚构响应替代。 |
| Provider 的原始正文保存期限与使用范围 | 尚无经核对的条款/用户证据可填入具体来源许可 | 2A 可实现分级门禁；2B 的**真实全文持久化和第三方传输**只能在相应范围确认后开启，未知时保守拒绝。默认 7 天候选、24 小时清理和最长 30 天备份为产品设计目标，需与实际许可再核对。 |
| 现有业务库真实迁移 | 尚未做本轮预检/备份/演练 | 可先开发 2A 并在**副本**演练；对真实业务库切换须另行完成预检、验证备份并取得明确确认。 |
| 清理后历史画像/生成稿中的引用或相似表达 | 需实现内容扫描与人工判定；无法只靠外键判断是否包含受限表达 | 不阻塞 2A/2B 的基础模型；Stage 4–6 发布前须完成派生清理与复核流程。 |
| 编译、类型检查、自动化测试实际结果 | 本轮未运行 | 文档完成不等于代码通过；维护者按项目规则在各批次运行并记录结果。 |

**结论：具备启动 Stage 2A 的架构条件**，可在不访问付费接口、不碰真实业务库的前提下实现 ORM、Alembic、统一 Schema 和副本迁移演练。Stage 2B/2C 依赖 2A 的契约审查；三接口契约的最终验收依赖真实脱敏响应，真实全文保存依赖许可确认。生产迁移始终有独立的备份、预检和确认门槛。本轮只完成蓝图修订，未开始 Stage 2。
