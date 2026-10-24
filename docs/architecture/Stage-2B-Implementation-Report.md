<!-- 2026-10-24：本次修改原因：记录 Stage 2B 已实现的目标文章库后端闭环及真实接口验证边界。 -->
# AI4Geo Stage 2B 实施报告

## 范围

本阶段增加目标库 v2 后端的公众号发现、候选留存、候选编辑、单篇/批量收录、手动录入、文章列表/详情和乐观锁编辑接口。v1 API 仍使用旧库并保留过渡，v2 不双写旧库。没有调用 RedFox 或 LLM 接口，没有修改实际业务数据库，没有运行测试、类型检查或构建。

## 新增和修改

| 文件 | 作用 |
|---|---|
| `backend/app/domains/articles/adapters/redfox_wechat.py` | 三个公众号端点的候选映射、读数转换、字段 provenance、原始字段保留；榜单响应待真实 Fixture 验证 |
| `backend/app/domains/articles/service.py` | 候选会话/抓取/候选写入，单篇及批量收录，重复来源关联，手动录入、指标快照及权限决定 |
| `backend/app/infrastructure/database/target_sessions.py` | 延迟建立目标库 Session，校验版本并拒绝旧库 URL |
| `backend/app/api/v2/article_library.py` | v2 发现、类别、候选会话读取/编辑、收录、手动新增、样本列表/详情、文章 PATCH API |
| `backend/app/main.py` | 注册 `/api/v2/article-library` 路由；旧 v1 路由保持原样 |
| `backend/app/domains/articles/revisions.py` | 初次创建文章时允许传入 Provider provenance；默认手动来源规则不变 |
| `backend/tests/test_stage2b_redfox_adapter.py` | 解析、原始未知字段、0/null/10w+ 和关键词请求参数契约测试；未运行 |
| `backend/tests/test_stage2b_article_collection.py` | 收录后文章、原始来源、指标及 provenance 回读契约测试；未运行 |
| `docs/article-library/02-redfox-api-field-mapping.md` | 记录 Stage 2B 映射实现及仍未验证的接口契约 |

## 数据流

1. `POST /api/v2/article-library/discover/wechat` 调用现有受密钥保护的 RedFox 请求函数；外部请求完成后才写本地事务。
2. 目标库保存 `discovery_sessions`、`discovery_fetches` 和 `discovery_candidates`。Fetch 保存接口 `data` 响应，Candidate 保存未过滤的原始文章项目、标准值、字段来源、解析警告与行版本。会话默认 7 天到期；清理执行器尚未实现。
3. `PATCH /discovery-candidates/{id}` 保存用户补充草稿并检查 `row_version`。
4. 单篇和批量收录要求 `scope.store=true`；权限未知不收录。文章、初始修订、正式来源、来源载荷、权限决定、指标快照和候选关联通过一个数据库事务提交。批量收录为全有或全无。
5. 手动新增使用相同 `ArticleEditable`、文章修订、来源载荷与权限表。PATCH 编辑通过当前 `row_version` 生成不可变修订。
6. 文章详情 API 汇总当前文章、字段 provenance、来源原始值和传播快照。当前未实现前端 Stage 2C。

## 接口

| 方法 | 路径 | 用途 |
|---|---|---|
| GET | `/api/v2/article-library/discover/wechat/categories` | 返回文档列出的 20 个公众号榜单分类 |
| POST | `/api/v2/article-library/discover/wechat` | `keyword_search`、`ten_w_rank`、`original_rank` 查询并持久化候选会话 |
| GET | `/api/v2/article-library/discovery-sessions/{session_id}` | 恢复候选会话和本地收录状态 |
| PATCH | `/api/v2/article-library/discovery-candidates/{candidate_id}` | 修改候选草稿，需 `expected_row_version` |
| POST | `/api/v2/article-library/discovery-candidates/collect` | 单篇收录，要求保存权限 |
| POST | `/api/v2/article-library/discovery-candidates/collect-batch` | 最多 100 篇原子批量收录 |
| POST | `/api/v2/article-library/articles` | 手动录入 |
| GET | `/api/v2/article-library/articles` | 分页列出正式文章 |
| GET | `/api/v2/article-library/articles/{article_id}` | 读取文章、来源和传播快照 |
| PATCH | `/api/v2/article-library/articles/{article_id}` | 乐观锁编辑并生成新修订 |

## 字段、权限和保留语义

- 查询参数只保存接口实际使用的白名单字段；API Key 不进入请求参数、来源字段或响应日志。
- `workUuid` 与 `photoId` 保持候选原始 ID，不互相推断；来源 ID 连同端点保存。
- 未知 API 字段留在原始 JSON；`0`、`null`、缺失分开保存；`10w+` 保存 raw 和下界，精确值为 null。
- 正文原始项目留在 `article_source_payloads`。候选展示值上限为 30000 字符；当前文章只在此时保存标准 DTO 值，原始正文不被覆盖。来源正文格式未验证时不自动清洗。
- 采集候选作为有期限的暂存，会在明确收录时转成正式来源资产。用户需显式确认 `store=true`。本地清洗、第三方 LLM、生成引用权限在 `RightsScope` 中独立记录；本阶段没有执行清洗或 LLM。
- 正式载荷 `retain_until` 当前为空，须在清理/保留服务实施时根据许可策略补充；候选过期自动删除服务也未实现。

## 未实现及验证边界

1. 前端仍使用 v1 接口；Stage 2C 才切换到本 API，当前后端路由先独立可用。
2. 当前只实现公众号三个端点。其他平台的候选状态恢复和正式收录契约尚未接入 v2。
3. 关键词端点字段按公开文档；榜单字段与响应容器沿用现有代码探索，映射警告标明待脱敏真实 Fixture 核实。没有付费接口调用。
4. 没有处理跨请求付费调用幂等键；用户再次提交查询会再次请求 Provider。服务端不会自动重试未知结果。
5. 未实现候选清理、权限撤回扫描、文章删除、Prepared Article 和特征失效任务。Stage 3/后续清理服务负责。
6. `body_text` 来自接口 `content` 原值；并未运行 HTML 清洗。正文完整性是 unknown/partial/missing，不根据字数推定 complete。
7. 还没有接入真实脱敏 Fixture、自动化测试未执行、没有编译或构建验证。

## 验证入口

配置 `AI4GEO_V2_DATABASE_URL` 为独立目标库，并先将目标库迁移至 `20261024_01`。v2 Session 会验证该版本并拒绝连接真实旧 `tasks.db`。适配器和收录测试文件已经新增，须由维护者在 `learner` 环境运行；测试通过前不建议把 v2 页面切换作为已验收功能。

Stage 2B 的后端核心闭环已经实现到源码，但需维护者运行契约测试并核对 OpenAPI 请求/响应后，才建议进入 Stage 2C 前端切换。生产旧库迁移/切换依然需要单独备份、预检和确认。
