<!-- 2026-10-24：本次修改原因：先记录现有字段链路和已证实的数据缺口，再决定增量迁移范围。 -->
# 文章样本库现状审计

## 范围和证据

本报告依据工作区代码、根目录 `README.md`、`docs/article-library.md`、规划目录的 `README.md`、`文章库模块.md`、`Skills以及操作链规划.md`，以及本地 SQLite 数据库的只读统计。规划目录可访问。三个 RedFox 页面中，关键词接口页面本次可读取；10W+ 和原创榜页面本次无法通过浏览工具读取，其接口细节仍以现有代码及已入库字段为线索，标为待验证。未调用付费接口，也未读取或输出 API Key。

项目实际是 React 19 + TypeScript 6 + Vite 前端、FastAPI + SQLAlchemy 后端、SQLite 数据库，并非单一 Node.js 服务。前端 `package.json` 只有 dev/build/preview 脚本；工作区的后端和前端源码中未发现现成的文章库测试或真实完整响应 Fixture。后端依赖列于 `backend/requirements.txt`，SQLite 路径为 `backend/data/tasks.db`。启动时通过 `Base.metadata.create_all` 和两段定向 `ALTER TABLE` 补列，没有版本化迁移框架。API 错误多由 HTTP 状态和业务异常转换为可读文本；尚无贯穿采集、解析、入库、清洗的结构化事件日志。

## 当前结构和真实数据

| 层 | 当前实现 |
|---|---|
采集请求 | `backend/app/redfox_service.py` 调用关键词、10W+、原创榜；`backend/app/redfox_discovery_service.py` 统一分页；`backend/app/api/v1/redfox.py` 提供发现接口 |
候选展示 | `frontend/src/pages/SamplesPage.tsx` 接收 `RedFoxCandidate`，展示标题、摘要、读数，映射为 `ArticleEditorValue` |
单篇/批量收录 | `ArticleEditorDialog.tsx` 或 `SamplesPage.tsx` 的批量流程调用 `POST /api/v1/library/articles` |
正式存储 | `content_samples` 保存标题、当前纯文本正文、平台、类目、链接、质量和权限；`article_metadata` 保存作者、日期、状态及 `source_data_json`；`article_metrics` 保存读数快照 |
查询与编辑 | `GET /library/articles` 返回精简列表；`GET /library/articles/{id}` 返回正文、来源 JSON、指标及分析；`PATCH` 修改主表与元数据，新增指标走独立 POST |
下游 | `article_features` / `style_profiles` 从 `content_samples.body_text` 计算；内容策略引用样本 ID，生成模块读取已发布策略 |

本地库只读核对：现有 11 篇样本、11 条元数据、11 个读数快照、0 条单篇特征、0 个风格画像、3 个内容策略；11 篇均有链接、至少 50 字正文和 `source_data_json`。来源方式为 9 篇 10W+、2 篇原创榜；11 条来源响应都含 `summary`，11 个读数快照的精确 `reads` 均为空，原始近似阅读值保存在 `raw_counts_json`。3 个策略当前均为 `deleted`，其历史样本引用合计 10 项。这些数字只描述本机当前库，不能证明三个接口所有真实返回形状。

## 字段流转图

```text
RedFox JSON data.list / 榜单数组
  → redfox_service._rank_candidate / search_wechat_quality_articles
  → RedFoxCandidate + source_data.response 白名单
  → SamplesPage.candidateEditorValue
  → ArticleEditorDialog.editorPayload
  → POST /library/articles (ArticleCreate)
  → content_samples + article_metadata + article_metrics
  → article_read(detail=True)
  → ArticlesPage 详情 / ArticleEditorDialog 编辑
  → PATCH /library/articles/{id} + 可选新增指标快照
```

| 字段/语义 | 接口/候选 | 表单/请求 | 数据库存放 | 详情/再编辑 | 结论 |
|---|---|---|---|---|---|
标题 | `title: string`，缺失时有占位文本 | `title: string`，必填 | `content_samples.title` | 完整回读与编辑 | 已打通 |
摘要 | `summary: string`，候选截到 500 字 | 无独立编辑字段；仅 `source_data.response.summary` | 来源 JSON 中的白名单值 | 来源折叠区可读，不可独立修订 | **确认缺口：没有标准摘要字段，候选展示可能已截断** |
正文 | `content` 经 HTMLParser 转为纯文本并截到 30000 字 | `body_text: string`，至少 50 字 | `content_samples.body_text` | 可编辑；画像直接读此字段 | **确认缺口：原始正文格式与超长尾部不可恢复** |
平台/类目 | 候选平台、榜单 `type` | 平台/内容类目 ID；类目按标签匹配预填 | `content_samples.platform_id/category_id` | 完整回读 | 榜单分类与项目类目混用风险；不匹配时需手填 |
原文链接 | 仅接受合法公众号 `workUrl/oriUrl` | `source_url: string` | `content_samples.source_url` | 完整回读 | `sourceUrl` 仅在来源 JSON，不等于可打开文章链接 |
作者/发布日期 | `author/userName`；`publishTime/publicTime` | 作者字符串；日期仅取前 10 位 | `article_metadata.author_id/published_at` | 完整回读 | 完整发布时间只依赖来源 JSON |
阅读/点赞/在看/评论/转发 | 候选为 `number|string|null` | 精确整数用字符串输入；近似值放 `raw_counts` | `article_metrics` 整数列和 `raw_counts_json` | 详情只在来源读数位置或编辑历史展开显示 | 缺失与 0 已区分；近似阅读尚无独立下界 |
收藏/打赏/综合互动/粉丝 | 候选可选值 | 部分映射到指标或账号粉丝数 | `article_metrics` / `article_metadata` | 部分只在折叠区显示 | 不是用户要求的五项主读数，但应保留 |
封面、原创标识、账号 ID 等 | 仅白名单 `_WECHAT_FIELDS` 进入 `source_data.response` | 来源区只读 | `article_metadata.source_data_json` | 折叠区回读 | **确认缺口：白名单外未知字段静默丢弃** |
接口来源/查询参数 | `provider/method/request` | `source_data` | 元数据的一份 JSON | 详情回读；PATCH 不接受此字段 | **确认缺口：一篇文章多次采集会被链接/正文查重拒绝，不能关联多来源** |
授权/复核 | 手动确认 | `rights_confirmed`、`review_status` | 主表/元数据分列 | 编辑、画像过滤 | 当前入库路径可用；历史字段语义需保留 |

## 已确认问题与待验证项

1. **已确认：摘要没有独立存储和编辑契约。** `summary` 只进入来源 JSON，候选预览最多 500 字；手动录入无摘要栏，编辑表单无摘要栏。已有 11 条来源 JSON 中均能回读摘要，但不能据此证明未来所有摘要都能完整保存。
2. **已确认：原始响应不完整。** `_wechat_source_data` 只保留 `_WECHAT_FIELDS`，跳过未知字段及 `content`。当前 SQLite 中不存在原始完整响应或原始正文；旧数据无法离线还原丢失部分。
3. **已确认：采集即清洗。** `_article_text` 在候选生成时将 HTML 转纯文本，丢失标题层级、图片位置、引用/列表类型；`body_text` 同时充当“采集结果”和“分析输入”，没有 Prepared Article、清洗版本或重试状态。
4. **已确认：多入口字段不一致。** 新单篇弹窗复用 `ArticleEditorDialog`，但 `ArticlesPage` 仍保留另一套内嵌编辑表单；候选简表、完整表单、详情和列表显示的字段组不同。后端 PATCH 使用 `exclude_unset=True`，因此当前编辑请求本身不会把未提交字段置空；问题主要是字段没有进入可编辑契约，而非已证实的 PATCH 全量覆盖。
5. **已确认：精确阅读为 null、近似原文可用。** 本机 11 个读数快照的精确阅读均为空；这符合“10W+”不伪装为精确 100000 的现有规则，不是阅读值丢失。但还没有 `read_count_lower_bound` 供后续比较。
6. **已确认：单源查重阻止多来源关联。** 创建时相同链接或去空白正文返回 409；来源信息嵌在文章元数据的一份 JSON 内。重复发现不能追加来源记录。
7. **待验证：榜单文档中的完整请求/返回契约。** 两个指定页面本次无法读取；现有代码提交 `type/startDate/endDate`，本机存储了部分实际返回字段，但没有完整原始响应 Fixture。
8. **待验证：关键词接口真实 `content`、分页与原始类型。** 可访问的官方页面示例含 `content`，字段表未列该项，示例列表排版也不构成可解析 JSON；本机没有关键词来源样本。
9. **已确认：历史策略仍引用样本 ID。** 3 个策略当前均为 `deleted`，历史样本引用合计 10 项；迁移仍不得改变文章 ID 或绕过引用处理。

## 最小侵入式方案与风险

保留 `content_samples` 作为文章主记录及现有 ID；给 `article_metadata` 增加可编辑摘要；新增多来源原始采集表和版本化 Prepared Article 表；`article_metrics` 只增量加来源关联及近似阅读下界。发现接口仍可按现有方式返回候选，但正式收录时经统一 Adapter、同一保存服务写入文章、来源、指标和首版准备状态。现有策略与生成读取旧样本 ID 的接口保持兼容；后续分析逐步改读 Prepared Article。

迁移前必须做 SQLite 在线备份和计数/哈希快照。旧 11 篇可从 `source_data_json` 回填“历史来源记录”和摘要，但要明确标记原始正文与未知响应字段不可恢复。未经真实响应验证，不调整两个榜单的解析键名或猜测未见字段。

预计修改：`backend/app/db.py`、`backend/app/main.py`、`backend/app/redfox_service.py`、`backend/app/api/v1/article_library.py`、`backend/app/article_library_service.py`、`frontend/src/workspaceApi.ts`、`frontend/src/articleLibraryApi.ts`、`frontend/src/pages/SamplesPage.tsx`、`frontend/src/pages/ArticlesPage.tsx`、`frontend/src/components/ArticleEditorDialog.tsx`、`frontend/src/article-library.css`、增量迁移脚本及文章库测试/Fixture。新增测试须覆盖三接口映射、null/0/近似值、重复来源、旧数据迁移、编辑后未显示字段保留、清洗重试和下游兼容。

## 阶段状态

本文件完成 Phase 1 代码与现存数据审计；没有运行编译、测试或付费接口。下一步先审阅 `02-redfox-api-field-mapping.md` 和 `05-database-migration.md` 的契约及迁移方案，再实施会写入真实数据库的改动。
