<!-- 2026-10-24：本次修改原因：在任何结构性写库操作前明确增量迁移、旧样本回填、验收及回滚边界。 -->
# 文章样本库增量迁移方案（待确认）

## 当前基线

数据库是 `backend/data/tasks.db`（SQLite）。现有 11 篇 `content_samples` 均有同 ID 的 `article_metadata` 和一条 `article_metrics`；其中 9 篇 10W+、2 篇原创榜。0 条 `article_features`、0 个风格画像，库内另有 3 个已标记 `deleted` 的内容策略，仍保存合计 10 项历史样本引用。既有数据库没有版本化迁移框架；启动时 `create_all` 及 `ensure_article_metric_columns/ensure_article_source_columns` 负责建表和补个别列。

迁移不删除、不改写 `content_samples.id/title/body_text` 或现有指标历史。现存 `source_data_json` 是被白名单过滤后的响应，不是原始完整 RedFox 返回；不能倒推出旧样本未知字段和原始 HTML。

## 目标 DDL

| 变更 | 字段与约束 | 原因 |
|---|---|---|
| `article_metadata` 增列 | `summary_text TEXT NULL` | 摘要成为可编辑、可独立回读的标准字段 |
| 新建 `article_sources` | `id` PK、`sample_id` 可空 FK、`provider`、`endpoint`、`external_id`、`candidate_key`、`source_category`、`request_params_json`、`raw_item_json`、`raw_content`、`content_format`、`raw_complete`、`fetched_at`、`parser_version`、`warnings_json` | 一篇文章多来源，保留完整原始返回与正文；未正式收录的候选可暂存 |
| `article_metrics` 增列 | `source_id TEXT NULL`、`read_lower_bound INTEGER NULL` | 指标追溯至采集来源，近似阅读量不伪装成精确值 |
| 新建 `prepared_articles` | `id` PK、`sample_id` FK、`source_id` 可空、输入哈希、`input_origin`、`cleaner_version`、`clean_title`、`clean_text`、`blocks_json`、`keywords_json`、`quality_flags_json`、`content_status`、`status`、起止时间和错误摘要 | 可重复、非破坏性清洗及状态追踪 |
| 新建 `schema_migrations` | 版本号 PK、应用时间、校验和 | 替代无版本记录的临时补列方式，支持幂等检查 |

索引至少覆盖 `article_sources(sample_id)`、`(provider, endpoint, external_id)`、`(provider, candidate_key)`、`article_metrics(source_id)`、`prepared_articles(sample_id, cleaner_version, input_hash)`。外部 ID 可空；相同 ID 的去重只在 provider + endpoint 的命名空间内判断。新增来源的原始 JSON 不设静默截断；超过明确安全上限时返回可读错误并保留待重试记录。

## 执行顺序

1. 停止 API/Worker 的写入；使用 SQLite `backup` API 生成带时间戳的数据库备份。记录各表行数、既有样本 ID 集合、主表正文哈希、来源 JSON 哈希和策略引用。
2. 在版本化迁移脚本中检查当前 schema 与迁移版本；单事务增列、建表、建索引。旧库及全新空库均应得到同一最终结构。避免启动 `create_all` 与迁移脚本并发。
3. 对现有 11 条 `source_data_json` 各建立一条来源记录：从 `method`、`request`、`response` 回填，`raw_complete=false`，`raw_content=null`，warning 标明“历史记录只有白名单字段、原始正文不可恢复”。提取 `summary` 到 `summary_text`，不覆盖已有人工摘要。
4. 仅当旧文章对应唯一来源且快照来源可确定时，将旧 `article_metrics.source_id` 关联到该来源；对 `10w+` 等可安全解析的原始阅读值计算下界，无法识别的值保持 null 并记录 warning。
5. 为每篇已有文章建立 `prepared_articles.pending`，**不**把现有清理后的 `body_text` 冒称原始 HTML；首次清洗输入来源标为 `legacy_curated_body`。旧单篇特征/画像不因迁移被删除。
6. 新收录先写不可变来源项目，再在同一事务中关联或创建文章与指标；适配层解析值写标准字段，未知字段留在原始 JSON。过渡期同时维护旧 `source_data_json` 的最新来源摘要供旧界面读取；稳定后才考虑退役旧列。
7. 执行只读一致性查询：样本 ID/正文哈希/策略引用不变；11 篇摘要可回读；11 条旧快照未覆盖；来源回填数匹配；缺失、0、近似值分开；再用新旧 API 读取同一批文章比较关键字段。

## 回滚与限制

在重新开放写入前若迁移失败，事务回滚并从迁移前备份恢复。若新版本已写入新文章/来源，直接恢复旧备份会丢失这段新数据；此时先导出新增行，停写、核对兼容性后再执行受控回滚，不能直接覆盖数据库。所有迁移步骤需要幂等检查和明确版本号，不能以“列似乎存在”推断数据回填已完成。

旧库无法恢复已被旧解析器丢弃的未知字段、原始 HTML、超出旧 30000 字限制的尾部内容。不能调用付费接口偷偷重抓来填补；需要重新抓取时应由用户明确发起。

## 兼容验证与批准点

保存/编辑仍使用原有文章 ID；内容策略的样本 ID、已发布生成匹配、删除关联处理保持可用。前端应先读统一 DTO，后端迁移完成后才切换新保存事务。需要用真实脱敏 Fixture 检查 K/T/O 的字段契约；榜单官方页面本次不可读，不能把未知字段当作已验证。

**批准点：**上述 DDL、11 篇旧数据回填范围、备份路径和“旧原始响应无法恢复”的标记获得确认后，再编写并运行迁移脚本。按项目维护者的既有规则，Codex 修改完代码后不自行编译；测试与构建验收由维护者执行或另行授权。
